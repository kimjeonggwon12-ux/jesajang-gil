// 센터 보내기 (2026-11-02, 사용자)
//   "섭외부터 복음방까지는 개인의 전도 활동 기록이지만, 지역장 승인 요청부터는 지역장에게 보고하는 체계이고,
//    지역장과 교관이 자기 지역 요청 건을 보고 승인하면, 선택하여 ○○센터로 보내기 하는 체계. 센터 생성은 전도부에서."
//
//   ① 교사      requestCenterApproval  — 내 섭외자 한 명을 지역장에게 승인 요청(기록 전부를 서류로 묶어 둠)
//   ② 지역장·교관 decideCenterReferral   — 자기 부서·지역 요청 건 승인/반려
//   ③ 지역장·교관 sendToCenter           — 승인 건을 골라 전도부가 만든 센터(기수)로 보내기
//   ④ 센터 강사·전도사 getCenterReferral — 받은 서류(그 사람 기록 전부)를 보고 관리 정보로 삼는다
//   전도부(교육·전도 담당 관리자)는 saveCenter 로 센터를 만들고, 전체 건을 본다.
import { db, run, isDuplicate } from '../lib/db.js';
// 11/4(사용자·개인정보): 센터 보내기 서류는 섭외자가 수강카드를 작성(센터 수강 동의)한 뒤에만 센터로 넘긴다 — 승인·보내기 때 확인 체크 필수, 메모에 표시
const CARD_FIRST = '수강카드를 작성(센터 수강 동의)한 분만 센터로 서류를 보낼 수 있어요. 화면의 「수강카드 작성」을 확인해 체크해 주세요.';
const CARD_MARK = '[수강카드 작성 확인] ';
import { normId, str, kstDateTime, fmtTs } from '../lib/util.js';
import { findTeacher, isApprover, isOwner } from './roster.js';
import { ownedTarget, targetDossier } from './targets.js';

const OPEN = ['요청', '승인'];
const DEPT_WIDE = ['회장', '총무', '총교관', '전도부장', '교육부장', '전도과장', '전도 과장', '전도팀장', '서기'];
const STAFF_ROLES = ['강사', '전도사', '담당'];
const MONTH_RE = /^\d{4}-\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── 누가 무엇을 볼 수 있나 ──

/**
 * 한 사람의 센터 보내기 권한.
 *   hq      = 전도부·교육부 담당(또는 앱 관리자): 전체 건 보기·처리, 센터 만들기
 *   scopes  = [{ dept, region|'' , role }] — 지역장·교관은 자기 부서·지역, 회장·총무·총교관 등은 자기 부서 전체
 *   centers = 내가 강사·전도사로 등록된 센터 id
 */
async function accessOf(memberId) {
  const nid = normId(memberId);
  const [teacher, admins, hq, centers] = await Promise.all([
    findTeacher(memberId),
    run(db().from('admins').select('dept, region, position, name').eq('nid', nid).order('id')),
    isApprover(memberId),
    run(db().from('centers').select('id, staff').order('id')),
  ]);
  const scopes = [];
  const add = (dept, region, position) => {
    const p = str(position);
    if (!dept || !p) return;
    if (DEPT_WIDE.some((w) => p.includes(w))) scopes.push({ dept, region: '', role: p });
    else if (p.includes('지역장') || p.includes('교관')) { if (region) scopes.push({ dept, region, role: p }); }
  };
  if (teacher) add(str(teacher.dept), str(teacher.region), teacher.position);
  for (const a of admins) add(str(a.dept) || str(teacher?.dept), str(a.region) || str(teacher?.region), a.position);
  const mine = centers.filter((c) => (c.staff || []).some((s) => normId(s.memberId) === nid)).map((c) => c.id);
  return {
    nid, teacher, hq: hq || isOwner(memberId), scopes, centers: mine,
    name: str(teacher?.name || admins[0]?.name),
    position: str(admins.find((a) => a.position)?.position || teacher?.position),
  };
}

const inScope = (acc, r) => acc.hq || acc.scopes.some((s) => s.dept === r.dept && (!s.region || s.region === r.region));
const canSee = (acc, r) => inScope(acc, r) || r.teacher_nid === acc.nid || (r.center_id && acc.centers.includes(r.center_id));
const signer = (acc) => (acc.position ? `${acc.name}(${acc.position})` : acc.name);

// ── 서류(그 사람 기록 전부) ──

async function buildSnapshot(target, teacherId) {
  const [d, teacher, master] = await Promise.all([
    targetDossier(target, teacherId),
    findTeacher(teacherId),
    run(db().from('target_ai_notes').select('text, created_at').eq('target_id', target.target_id).eq('kind', 'AI 종합 피드백').order('id', { ascending: false }).limit(1)).catch(() => []),
  ]);
  const p = target.report_profile || {};
  return {
    builtAt: kstDateTime(),
    target: {
      name: target.target_name.trim(), gender: target.gender, ageGroup: target.age_group, stage: target.stage,
      createdAt: fmtTs(target.created_at), goalCohort: target.goal_cohort || '',
      profile: {
        age: p.age || '', faith: p.faith || '', recruitType: p.recruitType || '', phone4: p.phone4 || '',
        center: p.center || '', enroll: p.enroll || '', cohortNo: p.cohortNo || '', course: p.course || '',
        lessons: (p.lessons || []).map((l) => (l && l.title) || l).filter(Boolean),
      },
      swot: target.swot || null, goalPlan: target.goal_plan || '',
    },
    teacher: teacher ? { name: teacher.name, dept: teacher.dept, region: teacher.region, affiliation: teacher.affiliation, tier: teacher.tier } : null,
    master: master[0] ? { at: fmtTs(master[0].created_at), text: master[0].text } : null,
    sections: { info: d.info, acts: d.acts, history: d.history, coaching: d.coaching, notes: d.notes },
    basis: d.basis,
  };
}

const centerLabel = (c) => (c ? [c.name, c.cohort_no].filter(Boolean).join(' ') + (c.open_month ? ` · ${Number(c.open_month.slice(5))}월 개강` : '') : '');

function toRow(r, centersById) {
  const c = r.center_id ? centersById.get(r.center_id) : null;
  return {
    id: r.id, targetId: r.target_id, targetName: r.target_name, teacherId: r.teacher_id, teacherName: r.teacher_name,
    dept: r.dept, region: r.region, stage: r.stage, status: r.status,
    requestNote: r.request_note, hopeCenter: r.hope_center, requestedAt: fmtTs(r.requested_at),
    decidedBy: r.decided_by, decidedAt: fmtTs(r.decided_at), decideNote: r.decide_note,
    sentBy: r.sent_by, sentAt: fmtTs(r.sent_at), sendNote: r.send_note,
    centerId: r.center_id, centerLabel: centerLabel(c), centerReadAt: fmtTs(r.center_read_at), assigneeId: r.assignee_id || '', assigneeName: r.assignee_name || '',
  };
}

function toCenter(c, counts) {
  return {
    id: c.id, name: c.name, cohortNo: c.cohort_no, openMonth: c.open_month, openDate: c.open_date,
    staff: (c.staff || []).map((s) => ({ ...s, key: staffKey(s) })), memo: c.memo, active: c.active, label: centerLabel(c),
    received: counts ? (counts.get(c.id) || 0) : undefined,
  };
}

const LIGHT = 'id, target_id, target_name, teacher_id, teacher_nid, teacher_name, dept, region, stage, status, request_note, hope_center, requested_at, decided_by, decided_at, decide_note, sent_by, sent_at, send_note, center_id, center_read_at, assignee_id, assignee_name';

// ── ① 교사 ──

/** 사람 화면 '센터 보내기' 칸: 이 섭외자의 최근 요청 건. */
async function getCenterSendState(body) {
  const mid = str(body.memberId);
  const target = await ownedTarget(mid, body.targetId);
  if (!target) return { error: '본인 담당의 섭외자가 아닙니다.' };
  const rows = await run(db().from('center_referrals').select(LIGHT).eq('target_id', target.target_id).neq('status', '취소').order('id', { ascending: false }).limit(5));
  const centers = await run(db().from('centers').select('*').order('id'));
  const byId = new Map(centers.map((c) => [c.id, c]));
  return { referral: rows[0] ? toRow(rows[0], byId) : null, past: rows.slice(1).map((r) => toRow(r, byId)) };
}

async function requestCenterApproval(body) {
  const mid = str(body.memberId);
  const target = await ownedTarget(mid, body.targetId);
  if (!target) return { error: '본인 담당의 섭외자만 요청할 수 있어요.' };
  // 11/2(사용자): 지역장 승인 요청은 복음방 단계인 분만(센터수강 등 이미 넘어간 분·그 전 단계는 안 됨)
  if (str(target.stage) !== '복음방') return { error: `복음방이 아닙니다. 센터로 보낼 수가 없습니다. (지금 단계: ${str(target.stage) || '없음'})` };
  const teacher = await findTeacher(mid);
  if (!teacher) return { error: '교사 명단에서 내 고유번호를 찾을 수 없어요.' };
  if (!str(teacher.region)) return { error: '내 지역이 명단에 없어 지역장을 찾을 수 없어요. 명단 담당자에게 지역을 넣어 달라고 해 주세요.' };
  const open = await run(db().from('center_referrals').select('id, status').eq('target_id', target.target_id).in('status', OPEN).limit(1));
  if (open.length) return { error: open[0].status === '요청' ? '이미 지역장 승인을 기다리는 중이에요.' : '이미 지역장 승인을 받았어요. 센터로 보내는 중이에요.' };
  const snapshot = await buildSnapshot(target, mid);
  try {
    const [row] = await run(db().from('center_referrals').insert({
      target_id: target.target_id, target_name: target.target_name.trim(), teacher_id: teacher.member_id, teacher_name: teacher.name,
      dept: str(teacher.dept), region: str(teacher.region), stage: target.stage || '',
      status: '요청', request_note: String(body.note || '').slice(0, 1000), hope_center: String(body.hopeCenter || '').slice(0, 100),
      requested_at: kstDateTime(), snapshot,
    }).select(LIGHT));
    return { ok: true, referral: toRow(row, new Map()) };
  } catch (e) {
    if (isDuplicate(e)) return { error: '이미 진행 중인 요청이 있어요.' };
    throw e;
  }
}

async function cancelCenterRequest(body) {
  const acc = { nid: normId(body.memberId) };
  const [r] = await run(db().from('center_referrals').select('id, teacher_nid, status').eq('id', Number(body.id)).limit(1));
  if (!r || r.teacher_nid !== acc.nid) return { error: '내 요청 건이 아니에요.' };
  if (r.status !== '요청') return { error: '지역장이 이미 처리한 건은 취소할 수 없어요.' };
  await run(db().from('center_referrals').update({ status: '취소' }).eq('id', r.id));
  return { ok: true };
}

// ── ②③ 지역장·교관(·전도부) ──

/** 센터 보내기 화면: 내 범위의 요청·승인·전달 건 + 센터 목록 + (센터 강사·전도사면) 받은 서류. */
async function getCenterDesk(body) {
  const acc = await accessOf(body.memberId);
  const [centers, all] = await Promise.all([
    run(db().from('centers').select('*').order('open_month', { ascending: false }).order('id')),
    run(db().from('center_referrals').select(LIGHT).neq('status', '취소').order('id', { ascending: false }).limit(3000)),
  ]);
  const byId = new Map(centers.map((c) => [c.id, c]));
  const counts = new Map();
  for (const r of all) if (r.status === '전달' && r.center_id) counts.set(r.center_id, (counts.get(r.center_id) || 0) + 1);
  const desk = all.filter((r) => inScope(acc, r)).map((r) => toRow(r, byId));
  // 11/2: 전도부는 모든 센터·기수의 받은 서류를 기수별로 본다(센터·기수 관리)
  const inbox = all.filter((r) => r.status === '전달' && (acc.hq || acc.centers.includes(r.center_id))).map((r) => toRow(r, byId));
  return {
    me: { name: acc.name, position: acc.position, hq: acc.hq, scopes: acc.scopes, centers: acc.centers, canDecide: acc.hq || acc.scopes.length > 0 },
    rows: desk, inbox,
    centers: centers.filter((c) => acc.hq || c.active || acc.centers.includes(c.id)).map((c) => toCenter(c, counts)),
    staffRoles: STAFF_ROLES,
  };
}

/** 홈 화면 알림 띠용 숫자(가볍게). */
async function getCenterSendBadge(body) {
  const acc = await accessOf(body.memberId);
  if (!acc.hq && !acc.scopes.length && !acc.centers.length) return { toDecide: 0, toSend: 0, unread: 0 };
  const rows = await run(db().from('center_referrals').select('id, dept, region, status, center_id, center_read_at, teacher_nid').in('status', ['요청', '승인', '전달']).limit(3000));
  const mine = rows.filter((r) => (acc.hq ? false : inScope(acc, r)));   // 전도부는 띠를 안 띄운다(전체 건이라 너무 많음)
  return {
    toDecide: mine.filter((r) => r.status === '요청').length,
    toSend: mine.filter((r) => r.status === '승인').length,
    unread: rows.filter((r) => r.status === '전달' && acc.centers.includes(r.center_id) && !r.center_read_at).length,
  };
}

/** 서류 한 건(그 사람 기록 전부). 센터 강사·전도사가 처음 열면 읽은 시각을 남긴다. */
async function getCenterReferral(body) {
  const acc = await accessOf(body.memberId);
  const [r] = await run(db().from('center_referrals').select('*').eq('id', Number(body.id)).limit(1));
  if (!r || !canSee(acc, r)) return { error: '볼 수 있는 건이 아니에요.' };
  if (r.status === '전달' && r.center_id && acc.centers.includes(r.center_id) && !r.center_read_at) {
    r.center_read_at = kstDateTime();
    await run(db().from('center_referrals').update({ center_read_at: r.center_read_at }).eq('id', r.id));
  }
  const centers = r.center_id ? await run(db().from('centers').select('*').eq('id', r.center_id)) : [];
  return { row: toRow(r, new Map(centers.map((c) => [c.id, c]))), snapshot: r.snapshot || null };
}

async function pickRows(acc, ids, status) {
  const list = [...new Set((ids || []).map(Number).filter(Boolean))].slice(0, 200);
  if (!list.length) return { error: '고른 건이 없어요.' };
  const rows = await run(db().from('center_referrals').select('*').in('id', list));
  const ok = rows.filter((r) => inScope(acc, r) && r.status === status);
  return { ok, skipped: list.length - ok.length };
}

/** 최신 기록으로 서류를 다시 묶는다(대상자가 지워졌으면 이전 서류 그대로). */
async function refreshSnapshot(r) {
  try {
    const [t] = await run(db().from('targets').select('*').eq('target_id', r.target_id).limit(1));
    return t ? await buildSnapshot(t, r.teacher_id) : r.snapshot;
  } catch { return r.snapshot; }
}

async function decideCenterReferral(body) {
  const acc = await accessOf(body.memberId);
  if (!acc.hq && !acc.scopes.length) return { error: '지역장·교관만 승인할 수 있어요.' };
  const decision = str(body.decision);
  if (!['승인', '반려'].includes(decision)) return { error: 'decision 은 승인 또는 반려' };
  const note = String(body.note || '').slice(0, 1000);
  if (decision === '반려' && !note.trim()) return { error: '반려 사유를 적어 주세요(교사에게 보여요).' };
  const { ok, skipped, error } = await pickRows(acc, body.ids, '요청');
  if (error) return { error };
  const now = kstDateTime();
  for (const r of ok) {
    const patch = { status: decision, decided_by: signer(acc), decided_by_id: str(body.memberId), decided_at: now, decide_note: note };
    if (decision === '승인') patch.snapshot = await refreshSnapshot(r);
    await run(db().from('center_referrals').update(patch).eq('id', r.id).eq('status', '요청'));
  }
  return { ok: true, done: ok.length, skipped };
}

async function sendToCenter(body) {
  const acc = await accessOf(body.memberId);
  if (!acc.hq && !acc.scopes.length) return { error: '지역장·교관만 센터로 보낼 수 있어요.' };
  if (body.cardDone !== true) return { error: CARD_FIRST };
  const [center] = await run(db().from('centers').select('*').eq('id', Number(body.centerId)).limit(1));
  if (!center || !center.active) return { error: '보낼 센터를 골라 주세요(닫힌 센터는 안 돼요).' };
  const { ok, skipped, error } = await pickRows(acc, body.ids, '승인');
  if (error) return { error };
  const now = kstDateTime();
  for (const r of ok) {
    await run(db().from('center_referrals').update({
      status: '전달', sent_by: signer(acc), sent_by_id: str(body.memberId), sent_at: now, center_id: center.id,
      send_note: (CARD_MARK + String(body.note || '')).slice(0, 1000), snapshot: await refreshSnapshot(r), center_read_at: null,
    }).eq('id', r.id).eq('status', '승인'));
  }
  return { ok: true, done: ok.length, skipped, center: centerLabel(center) };
}

/** 승인 건을 잘못 보냈거나 다시 판단할 때: 전달·승인 → 요청으로 되돌림(전도부·같은 범위 지역장·교관). */
async function reopenCenterReferral(body) {
  const acc = await accessOf(body.memberId);
  const [r] = await run(db().from('center_referrals').select('id, dept, region, status, target_id, center_id').eq('id', Number(body.id)).limit(1));
  // 11/2(사용자): 센터에 담긴 건도 빼서(반려) 지역장 승인 전 대기로 — 그 기수의 강사·전도사도 뺄 수 있다
  const centerStaff = r && r.status === '전달' && acc.centers.includes(r.center_id);
  if (!r || !(inScope(acc, r) || centerStaff)) return { error: '처리할 수 있는 건이 아니에요.' };
  if (!['승인', '전달', '반려'].includes(r.status)) return { error: '되돌릴 수 없는 상태예요.' };
  const open = await run(db().from('center_referrals').select('id').eq('target_id', r.target_id).in('status', OPEN).neq('id', r.id).limit(1));
  if (open.length) return { error: '이 섭외자에 진행 중인 다른 요청이 있어요.' };
  const note = str(body.note).slice(0, 300);
  const why = r.status === '전달' ? `센터에서 뺌 — ${signer(acc)}${note ? ': ' + note : ''}` : note ? `되돌림 — ${signer(acc)}: ${note}` : '';
  await run(db().from('center_referrals').update({ status: '요청', center_id: null, sent_at: null, sent_by: '', sent_by_id: '', center_read_at: null, assignee_id: '', assignee_name: '', ...(why ? { decide_note: why } : {}) }).eq('id', r.id));
  return { ok: true };
}

// ── 전도부: 센터(기수) 만들기 ──

function cleanStaff(list) {
  return (Array.isArray(list) ? list : []).slice(0, 20).map((s) => ({
    memberId: str(s && s.memberId), name: str(s && s.name).slice(0, 30), role: STAFF_ROLES.includes(str(s && s.role)) ? str(s.role) : '담당',
  })).filter((s) => s.memberId && s.name);
}

async function saveCenter(body) {
  const acc = await accessOf(body.memberId);
  if (!acc.hq) return { error: '센터 만들기는 전도부(교육·전도 담당 관리자)만 할 수 있어요.' };
  const name = str(body.centerName ?? body.name).slice(0, 40);   // 11/2: 화면은 centerName — 'name'은 앱이 로그인 이름으로 덮어씀
  const openMonth = str(body.openMonth);
  const openDate = str(body.openDate);
  if (!name) return { error: '센터 이름을 적어 주세요.' };
  if (!MONTH_RE.test(openMonth)) return { error: '개강 월을 골라 주세요.' };
  if (openDate && !DATE_RE.test(openDate)) return { error: '개강일 형식이 맞지 않아요.' };
  const row = {
    name, cohort_no: str(body.cohortNo).slice(0, 20), open_month: openMonth, open_date: openDate,
    staff: cleanStaff(body.staff), memo: String(body.memo || '').slice(0, 500),
    active: body.active !== false, updated_at: kstDateTime(),
  };
  if (body.id) {
    await run(db().from('centers').update(row).eq('id', Number(body.id)));
    return { ok: true, id: Number(body.id) };
  }
  const [c] = await run(db().from('centers').insert({ ...row, created_by: signer(acc), created_at: kstDateTime() }).select('id'));
  return { ok: true, id: c.id };
}

/** 기수 지우기(전도부). 이미 받은 서류는 지우지 않고 '승인'(센터 보내기 대기)으로 돌려 다른 기수로 다시 보낼 수 있게 한다. */
async function deleteCenter(body) {
  const acc = await accessOf(body.memberId);
  if (!acc.hq) return { error: '기수 삭제는 전도부(교육·전도 담당 관리자)만 할 수 있어요.' };
  const id = Number(body.id);
  const [c] = await run(db().from('centers').select('id').eq('id', id).limit(1));
  if (!c) return { error: '이미 지워진 기수예요.' };
  const moved = await run(db().from('center_referrals')
    .update({ status: '승인', center_id: null, sent_at: null, sent_by: '', sent_by_id: '', send_note: '', center_read_at: null, assignee_id: '', assignee_name: '' })
    .eq('center_id', id).select('id'));
  await run(db().from('centers').delete().eq('id', id));
  return { ok: true, moved: moved.length };
}

/** 강사·전도사 지정용: 이름(또는 번호)으로 명단에서 찾기. */
async function findCenterStaff(body) {
  const acc = await accessOf(body.memberId);
  if (!acc.hq && !acc.centers.length) return { error: '전도부·센터 담당만 쓸 수 있어요.' };
  const q = str(body.q);
  if (q.length < 2) return { rows: [] };
  const digits = q.replace(/\D/g, '');
  const rows = digits.length >= 6
    ? await run(db().from('teachers').select('member_id, name, dept, region, position').like('nid', `%${normId(q)}%`).limit(20))
    : await run(db().from('teachers').select('member_id, name, dept, region, position').like('name', `%${q}%`).limit(20));
  return { rows: rows.map((t) => ({ memberId: t.member_id, name: t.name, dept: t.dept, region: t.region, position: t.position })) };
}

/**
 * 11/2(사용자): 지역장 승인 = 센터 기수를 먼저 고르고 대기자를 체크해 [지역장 승인] → 승인과 동시에 그 기수로 보낸다.
 * 요청 건은 승인 기록을 남기고, 예전에 승인만 해 둔 건은 그대로 보낸다.
 */
async function approveAndSend(body) {
  const acc = await accessOf(body.memberId);
  if (!acc.hq && !acc.scopes.length) return { error: '지역장·교관만 승인할 수 있어요.' };
  if (body.cardDone !== true) return { error: CARD_FIRST };
  const cid = Number(body.centerId);
  const [center] = cid ? await run(db().from('centers').select('*').eq('id', cid).limit(1)) : [];
  if (!center || !center.active) return { error: '보낼 센터 기수를 먼저 골라 주세요(닫힌 기수는 안 돼요).' };
  const list = [...new Set((body.ids || []).map(Number).filter(Boolean))].slice(0, 200);
  if (!list.length) return { error: '승인할 대기자를 체크해 주세요.' };
  const rows = await run(db().from('center_referrals').select('*').in('id', list));
  const mine = rows.filter((r) => inScope(acc, r) && OPEN.includes(r.status));
  // 11/2(사용자): 지금 복음방 단계인 분만 승인·보내기(센터수강 등으로 넘어갔거나 그 전 단계면 안 됨 — 반려로 돌려보내기)
  const tids = mine.map((r) => r.target_id);
  const stages = new Map((tids.length ? await run(db().from('targets').select('target_id, stage').in('target_id', tids)) : []).map((t) => [t.target_id, str(t.stage)]));
  const ok = mine.filter((r) => (stages.get(r.target_id) ?? str(r.stage)) === '복음방');
  const notGospel = mine.filter((r) => !ok.includes(r)).map((r) => `${r.target_name}(${stages.get(r.target_id) ?? r.stage ?? '-'})`);
  if (!ok.length && notGospel.length) return { error: `복음방 단계인 분만 승인할 수 있어요: ${notGospel.join(', ')} — 반려로 돌려보내 주세요.` };
  const now = kstDateTime(), note = (CARD_MARK + String(body.note || '')).slice(0, 1000);
  for (const r of ok) {
    const snapshot = await refreshSnapshot(r);
    const patch = {
      status: '전달', sent_by: signer(acc), sent_by_id: str(body.memberId), sent_at: now, center_id: center.id, send_note: note, snapshot, center_read_at: null,
      ...(r.status === '요청' ? { decided_by: signer(acc), decided_by_id: str(body.memberId), decided_at: now, decide_note: note } : {}),
    };
    await run(db().from('center_referrals').update(patch).eq('id', r.id).eq('status', r.status));
  }
  return { ok: true, done: ok.length, skipped: list.length - ok.length, notGospel, center: centerLabel(center) };
}

/** 센터 기수 관리: 받은 수강생을 그 기수 전도사에게 배정(빈 값이면 배정 해제). 전도부·그 기수 강사·전도사. */
async function assignCenterReferral(body) {
  const acc = await accessOf(body.memberId);
  const [r] = await run(db().from('center_referrals').select('id, status, center_id').eq('id', Number(body.id)).limit(1));
  if (!r || r.status !== '전달' || !(acc.hq || acc.centers.includes(r.center_id))) return { error: '배정할 수 있는 건이 아니에요.' };
  const [c] = await run(db().from('centers').select('staff').eq('id', r.center_id).limit(1));
  const key = str(body.assignee);   // 전도사 열쇠 = 고유번호(없으면 'name:이름')
  const s = key ? (c.staff || []).find((x) => staffKey(x) === key) : null;
  if (key && !s) return { error: '이 기수의 전도사가 아니에요.' };
  await run(db().from('center_referrals').update({ assignee_id: s ? staffKey(s) : '', assignee_name: s ? s.name : '' }).eq('id', r.id));
  return { ok: true };
}
const staffKey = (s) => (s.memberId ? normId(s.memberId) : 'name:' + s.name);

/** 센터 기수 관리: 이 기수에 전도사(또는 강사) 넣기 — 명단에 없으면 이름만으로도. 전도부·그 기수 강사·전도사. */
async function addCenterStaff(body) {
  const acc = await accessOf(body.memberId);
  const id = Number(body.centerId);
  if (!(acc.hq || acc.centers.includes(id))) return { error: '이 기수를 관리할 수 있는 분이 아니에요.' };
  const [c] = await run(db().from('centers').select('staff').eq('id', id).limit(1));
  if (!c) return { error: '기수를 찾을 수 없어요.' };
  const add = { memberId: str(body.staffId), name: str(body.staffName).slice(0, 30), role: STAFF_ROLES.includes(str(body.role)) ? str(body.role) : '전도사' };
  if (!add.name) return { error: '이름을 적어 주세요.' };
  const staff = c.staff || [];
  if (staff.some((x) => staffKey(x) === staffKey(add))) return { error: '이미 들어 있는 분이에요.' };
  await run(db().from('centers').update({ staff: [...staff, add], updated_at: kstDateTime() }).eq('id', id));
  return { ok: true };
}

export default {
  getCenterSendState, requestCenterApproval, cancelCenterRequest,
  getCenterDesk, getCenterSendBadge, getCenterReferral, decideCenterReferral, sendToCenter, reopenCenterReferral,
  saveCenter, deleteCenter, findCenterStaff, approveAndSend, assignCenterReferral, addCenterStaff,
};
