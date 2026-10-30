// 전도 대상자 — 활동 등록의 부산물로 자동 생성·갱신되고, 단계가 바뀔 때마다 이력이 남는다.
import { randomUUID } from 'node:crypto';
import { db, run, selectAll, isDuplicate } from '../lib/db.js';
import { normId, str, kstDate, kstDateTime, fmtTs } from '../lib/util.js';
import { notifyActivityChannel } from '../lib/telegram.js';
import { onStageReached } from '../lib/events.js';
import { findTeacher, findCoaches } from './roster.js';
import { askAiModels } from '../lib/gemini.js';

export const TARGET_STAGES = ['섭외', '친분', '만남1', '만남2', '상담1', '상담2', '복음방', '센터소개', '센터수강'];

/** 내가 담당(최초 등록·인도자·섬김이 중 하나)인 대상자만 고르는 조건. */
const ownedBy = (nid) => `creator_nid.eq.${nid},leader_nid.eq.${nid},helper_nid.eq.${nid}`;
const owns = (t, nid) => t.creator_nid === nid || t.leader_nid === nid || t.helper_nid === nid;

async function findTarget(targetId) {
  const rows = await run(db().from('targets').select('*').eq('target_id', targetId).limit(1));
  return rows[0] || null;
}

async function appendHistory(memberId, targetId, fromStage, toStage, memo) {
  await run(db().from('target_history').insert({
    member_id: memberId, target_id: targetId, changed_at: kstDateTime(),
    from_stage: fromStage || '', to_stage: toStage || '', memo: memo || '',
  }));
  await onStageReached(memberId, targetId, fromStage, toStage);
}

/** 복음방 단계에 도달하면 담당 교관에게 알린다. */
async function notifyGospelRoom(memberId, teacherName, targetName) {
  try {
    const teacher = await findTeacher(memberId);
    const region = teacher?.region || '';
    const coaches = teacher ? await findCoaches(teacher.dept, region) : [];
    const names = coaches.map((c) => c.name).join(', ') || '(담당 교관 미등록)';
    await notifyActivityChannel(`🌱 [복음방 도달] ${region} 지역 담당 교관님(${names}) — ` +
      `${teacherName || memberId}교사님의 전도 대상자 ${targetName}님이 복음방 단계에 도달했습니다.`);
  } catch { /* 알림 실패는 무시 */ }
}

/** 활동에 적힌 역할대로 담당 인도자·섬김이를 이 교사로 배정한다(바뀌면 변경 이력에 한 줄). */
function roleAssignment(target, roles, memberId) {
  const patch = {};
  const log = [];
  const today = kstDate();
  const assign = (role, column, label) => {
    if (!roles.includes(role)) return;
    const old = str(target[column]);
    if (normId(old) === normId(memberId)) return;
    patch[column] = memberId;
    if (old) log.push(`${today} ${label} 변경: ${old} → ${memberId}`);
  };
  assign('인도자', 'leader_id', '담당인도자');
  assign('섬김이', 'helper_id', '담당섬김이');
  if (log.length) patch.teacher_change_log = [target.teacher_change_log, ...log].filter(Boolean).join('; ');
  return patch;
}

/** 활동 등록 때: 같은 이름의 내 담당 대상자가 있으면 갱신, 없으면 새로 만든다. */
export async function upsertTargetFromActivity(activity) {
  try {
    await upsertTargetOnce(activity);
  } catch (e) {
    // 같은 활동 등록이 동시에 두 번 들어와 둘 다 "새 대상자"로 만들려 한 경우: 두 번째는 방금 생긴 대상자를 고친다.
    if (!isDuplicate(e)) throw e;
    await upsertTargetOnce(activity);
  }
}

// 10/30(사용자): "센터수강을 기록했는데 단계 게이지는 그대로 만남" — 단계는 고른 단계·기록한 활동·지금 단계 중 가장 높은 것(자동으로 내리지 않음)
const stageRank = (s) => TARGET_STAGES.indexOf(String(s || '').trim());
export const highestStage = (...list) => list.flat().reduce((best, s) => (stageRank(s) > stageRank(best) ? String(s).trim() : best), '');

async function upsertTargetOnce({ memberId, name, roles, targetName, gender, ageGroup, stage: picked, activities, note, report, date }) {
  const mid = str(memberId);
  if (!mid || !targetName) return;
  const now = kstDateTime();
  const mine = await run(db().from('targets').select('*').or(ownedBy(normId(mid))).order('id'));
  const existing = mine.find((t) => t.target_name.trim() === targetName);
  const stage = highestStage(picked, activities || [], existing ? existing.stage : '') || picked;

  if (existing) {
    const patch = { ...roleAssignment(existing, roles, mid), updated_at: now };
    const stageChanged = stage && stage !== existing.stage;
    if (stageChanged) patch.stage = stage;
    if (gender) patch.gender = gender;
    if (ageGroup) patch.age_group = ageGroup;
    if (report) patch.report_profile = mergeProfile(existing.report_profile, report, date);
    await run(db().from('targets').update(patch).eq('id', existing.id));
    if (stageChanged) {
      await appendHistory(mid, existing.target_id, existing.stage, stage, note);
      if (stage === '복음방') await notifyGospelRoom(mid, name, targetName);
    }
    return;
  }

  const firstStage = stage || TARGET_STAGES[0];
  const fresh = {
    target_id: randomUUID(), creator_id: mid, teacher_name: String(name || ''), target_name: targetName,
    stage: firstStage, memo: note || '', created_at: now, updated_at: now, gender: gender || '', age_group: ageGroup || '',
    leader_id: '', helper_id: '', teacher_change_log: '',
    report_profile: report ? mergeProfile(null, report, date) : null,
  };
  await run(db().from('targets').insert({ ...fresh, ...roleAssignment(fresh, roles, mid) }));
  await appendHistory(mid, fresh.target_id, '', firstStage, '활동 등록으로 자동 생성');
  if (stage === '복음방') await notifyGospelRoom(mid, name, targetName);
}

async function addTarget(body) {
  const mid = str(body.memberId);
  const targetName = str(body.targetName);
  if (!mid || !targetName) return { error: 'memberId, targetName 이 필요합니다.' };
  const stage = TARGET_STAGES.includes(str(body.stage)) ? str(body.stage) : TARGET_STAGES[0];
  const targetId = randomUUID();
  const now = kstDateTime();
  const name = String(body.name || '');
  try {
    await run(db().from('targets').insert({
      target_id: targetId, creator_id: mid, teacher_name: name, target_name: targetName, stage,
      next_meeting_date: String(body.nextMeetingDate || ''), memo: String(body.memo || ''), created_at: now, updated_at: now,
    }));
  } catch (e) {
    if (isDuplicate(e)) return { error: '이미 같은 이름으로 등록한 대상자가 있습니다.' };
    throw e;
  }
  await appendHistory(mid, targetId, '', stage, '대상자 등록');
  if (stage === '복음방') await notifyGospelRoom(mid, name, targetName);
  return { ok: true, targetId };
}

const toTarget = (t) => ({
  targetId: t.target_id, targetName: t.target_name, stage: t.stage,
  nextMeetingDate: t.next_meeting_date, memo: t.memo,
  createdAt: fmtTs(t.created_at), updatedAt: fmtTs(t.updated_at),
  completed: t.completed, gender: t.gender, ageGroup: t.age_group,
  leaderId: t.leader_id, helperId: t.helper_id, teacherChangeLog: t.teacher_change_log,
  goalCohort: t.goal_cohort || '', goalPlan: t.goal_plan || '', goalPlanAt: fmtTs(t.goal_plan_at), goalPlanBasis: t.goal_plan_basis || '',
  swot: t.swot || null, swotAt: fmtTs(t.swot_at), swotAi: t.swot_ai || '', swotAiAt: fmtTs(t.swot_ai_at),
  reportProfile: t.report_profile || null,
});

const toHistory = (h) => ({ changedAt: fmtTs(h.changed_at), fromStage: h.from_stage, toStage: h.to_stage, memo: h.memo });
const newestFirst = (a, b) => (a.changedAt < b.changedAt ? 1 : -1);

/** 내 담당 대상자 목록(다음 만남이 가까운 순, 날짜 없는 것은 뒤) + 내가 남긴 단계 이력. */
async function getTargets(body) {
  const mid = str(body.memberId);
  if (!mid) return { error: 'memberId 가 필요합니다.' };
  const nid = normId(mid);
  const targets = await selectAll(() => db().from('targets').select('*').or(ownedBy(nid)).order('id'));
  const rows = targets.map((t) => ({ ...toTarget(t), history: [] }));
  const byId = new Map(rows.map((t) => [t.targetId, t]));

  const history = await selectAll(() => db().from('target_history').select('*').eq('nid', nid).order('id'));
  for (const h of history) byId.get(h.target_id.trim())?.history.push(toHistory(h));
  for (const t of rows) t.history.sort(newestFirst);

  rows.sort((a, b) => {
    if (!a.nextMeetingDate && !b.nextMeetingDate) return 0;
    if (!a.nextMeetingDate) return 1;
    if (!b.nextMeetingDate) return -1;
    return a.nextMeetingDate < b.nextMeetingDate ? -1 : 1;
  });
  return { rows, stages: TARGET_STAGES };
}

// ── 활동 보고 틀 (2026-10-23) ── app.html rpPayload 와 같은 칸. 섭외자마다 잘 안 바뀌는 칸은 targets.report_profile 에 모은다.
// 10/30(사용자): 센터 수강생은 "○월 개강 ○○센터 ○○○기" + 수강 과정(course: 초등·중등·고등·수료)
const RP_TEXT = { tier: 10, title: 60, center: 60, enroll: 4, cohortNo: 12, course: 10, age: 3, faith: 30, recruitType: 30, phone4: 4, time: 30, nextDate: 10, request: 500, eduTotal: 3, eduWeekly: 10, lesson: 120, stageMark: 4 };
const RP_MAPS = { team: ['leader', 'mentor', 'teacher', 'counselor', 'helper', 'leaf', 'comm'], checks: ['affil', 'mapal', 'bible', 'record'], plan: ['mapal', 'teacherIntro', 'bibleRoom', 'centerIntro', 'interview'] };
const RP_PROFILE_KEYS = ['center', 'enroll', 'cohortNo', 'course', 'age', 'faith', 'recruitType', 'phone4', 'eduWeekly', 'stageMark', 'team', 'checks', 'plan'];
/** 앱이 보낸 보고 칸 → 정해진 칸만, 길이 제한. 보내지 않은 칸은 빠진다(프로필의 기존 값을 지우지 않게). */
export function cleanReport(v) {
  if (!v || typeof v !== 'object') return null;
  const o = {};
  for (const [k, n] of Object.entries(RP_TEXT)) if (v[k] !== undefined) o[k] = String(v[k] == null ? '' : v[k]).trim().slice(0, n);
  for (const [k, keys] of Object.entries(RP_MAPS)) {
    if (!v[k] || typeof v[k] !== 'object') continue;
    o[k] = Object.fromEntries(keys.map((x) => [x, str(v[k][x]).slice(0, 60)]));
  }
  if (Array.isArray(v.lessons)) o.lessons = v.lessons.slice(-60).map((l) => ({ date: str(l && l.date).slice(0, 10), title: str(l && l.title).slice(0, 120) })).filter((l) => l.title);
  return o;
}
function mergeProfile(prev, report, date) {
  const p = { ...(prev || {}) };
  for (const k of RP_PROFILE_KEYS) {
    if (report[k] === undefined) continue;
    p[k] = typeof report[k] === 'object' ? { ...(p[k] || {}), ...report[k] } : report[k];
  }
  // 10/30: 앱에서 누적 교육 제목을 한 줄씩 고쳤으면(report.lessons) 그 목록으로 바꾼 뒤 오늘 제목을 붙인다
  const lessons = Array.isArray(report.lessons) ? report.lessons.slice(-60) : Array.isArray(p.lessons) ? p.lessons.slice(-60) : [];
  const last = lessons[lessons.length - 1];
  if (report.lesson && !(last && last.title === report.lesson)) lessons.push({ date, title: report.lesson });
  p.lessons = lessons;
  return p;
}

/**
 * 10/30(사용자): 수정·재보고에서 섭외자 이름을 고치면 — 내 담당 섭외자 이름과, 내가 그 이름으로 남긴 다른 기록 이름도 함께 바꾼다.
 * 새 이름의 섭외자가 이미 따로 있으면 섭외자 행은 건드리지 않는다(둘이 섞이지 않게) — 이 기록 이름만 바뀐다.
 */
export async function renameTargetForOwner(memberId, oldName, newName) {
  const mid = str(memberId), from = str(oldName), to = str(newName);
  if (!mid || !from || !to || from === to) return;
  const mine = await run(db().from('targets').select('id, target_name').or(ownedBy(normId(mid))).order('id'));
  const src = mine.find((x) => x.target_name.trim() === from);
  if (!src || mine.some((x) => x.target_name.trim() === to)) return;
  await run(db().from('targets').update({ target_name: to, updated_at: kstDateTime() }).eq('id', src.id));
  await run(db().from('activities').update({ target_name: to }).eq('nid', normId(mid)).eq('target_name', from));
}

/** 고친 기록의 활동이 지금 단계보다 높으면 섭외자 단계를 올린다(10/30). */
export async function raiseStageFromActivity(memberId, targetName, activities, note) {
  const mid = str(memberId);
  const mine = await run(db().from('targets').select('id, target_id, stage, target_name').or(ownedBy(normId(mid))).order('id'));
  const t = mine.find((x) => x.target_name.trim() === String(targetName || '').trim());
  if (!t) return;
  const next = highestStage(activities || [], t.stage);
  if (!next || next === t.stage) return;
  await run(db().from('targets').update({ stage: next, updated_at: kstDateTime() }).eq('id', t.id));
  await appendHistory(mid, t.target_id, t.stage, next, note || '');
}

/** 고친 보고 기록 → 그 섭외자 프로필. 보낸 칸만 덮고, 누적 교육 제목은 이 기록(같은 날짜·옛 제목)의 제목만 바꾼다. */
export async function updateProfileFromEdit(memberId, targetName, report, date, oldLesson) {
  const mine = await run(db().from('targets').select('id, target_name, report_profile').or(ownedBy(normId(memberId))).order('id'));
  const target = mine.find((x) => x.target_name.trim() === targetName);
  if (!target) return;
  const { lesson, ...rest } = report;
  const p = mergeProfile(target.report_profile, rest, date);
  if (lesson !== undefined) {
    const same = p.lessons.findIndex((l) => l.date === date && l.title === oldLesson);
    const at = same >= 0 ? same : p.lessons.findIndex((l) => l.title === oldLesson);
    if (oldLesson && at >= 0) { if (lesson) p.lessons[at] = { ...p.lessons[at], date, title: lesson }; else p.lessons.splice(at, 1); }
    else if (lesson && !p.lessons.some((l) => l.title === lesson)) p.lessons.push({ date, title: lesson });
  }
  await run(db().from('targets').update({ report_profile: p }).eq('id', target.id));
}

const SWOT_TEXT = ['s', 'w', 'o', 't', 'so', 'st', 'wo', 'wt'];
const SWOT_CELLS = ['so', 'st', 'wo', 'wt'];
/** 앱이 보낸 SWOT → 정해진 칸만, 길이 제한. 내용이 하나도 없으면 null. */
function cleanSwot(v) {
  if (!v || typeof v !== 'object') return null;
  const o = {};
  for (const k of SWOT_TEXT) o[k] = String(v[k] == null ? '' : v[k]).trim().slice(0, 1500);
  const n = v.next && typeof v.next === 'object' ? v.next : {};
  o.next = {
    cell: SWOT_CELLS.includes(str(n.cell)) ? str(n.cell) : '',
    text: str(n.text).slice(0, 300),
    date: /^\d{4}-\d{2}-\d{2}$/.test(str(n.date)) ? str(n.date) : '',
  };
  return SWOT_TEXT.some((k) => o[k]) || o.next.text ? o : null;
}

async function updateTarget(body) {
  const mid = str(body.memberId);
  const targetId = str(body.targetId);
  if (!mid || !targetId) return { error: 'memberId, targetId 가 필요합니다.' };
  const target = await findTarget(targetId);
  if (!target) return { error: '해당 대상자를 찾을 수 없습니다.' };
  if (!owns(target, normId(mid))) return { error: '본인 소유의 전도 대상자가 아닙니다.' };

  const patch = { updated_at: kstDateTime() };
  const newStage = body.stage !== undefined && TARGET_STAGES.includes(String(body.stage)) && String(body.stage) !== target.stage
    ? String(body.stage) : null;
  if (newStage) patch.stage = newStage;
  if (body.nextMeetingDate !== undefined) patch.next_meeting_date = String(body.nextMeetingDate);
  if (body.memo !== undefined) patch.memo = String(body.memo);
  if (body.completed !== undefined) patch.completed = !!body.completed;
  // 2026-10-20: '○월 개강 인도 목표'('2026-11', 빈 값 = 목표 없음). 목표 달이 바뀌면 예전 AI 계획은 지운다.
  if (body.goalCohort !== undefined) {
    const goal = GOAL_RE.test(str(body.goalCohort)) ? str(body.goalCohort) : '';
    patch.goal_cohort = goal;
    if (goal !== (target.goal_cohort || '')) { patch.goal_plan = ''; patch.goal_plan_at = null; patch.goal_plan_basis = ''; }   // 지난 계획은 target_ai_notes에 남아 다음 설계 때 읽힌다
  }
  // 2026-10-22: SWOT 분석(섭외자 한 명당 한 장). 모두 비우면 지운다.
  if (body.swot !== undefined) {
    patch.swot = cleanSwot(body.swot);
    patch.swot_at = patch.swot ? patch.updated_at : null;
  }
  await run(db().from('targets').update(patch).eq('id', target.id));

  if (newStage) {
    await appendHistory(mid, targetId, target.stage, newStage, String(body.memo || ''));
    if (newStage === '복음방') await notifyGospelRoom(mid, target.teacher_name, target.target_name);
  }
  return { ok: true };
}

/** 대상자와 이름이 같고, 담당자(등록·인도·섬김) 중 한 명이 쓴 활동 기록. */
async function activitiesAbout(target) {
  const owners = new Set([target.creator_id, target.leader_id, target.helper_id].filter((id) => str(id)).map(normId));
  if (!target.target_name.trim() || !owners.size) return [];
  const rows = await selectAll(() => db().from('activities').select('*').in('nid', [...owners]).order('id'));
  return rows.filter((a) => a.target_name.trim() === target.target_name.trim());
}

/** 대상자 한 명의 누적 일지: 단계 이력 + 담당자들이 남긴 활동 기록. */
async function getTargetJournal(body) {
  const mid = str(body.memberId);
  const targetId = str(body.targetId);
  if (!mid || !targetId) return { error: 'memberId, targetId 가 필요합니다.' };
  const row = await findTarget(targetId);
  if (!row) return { error: '해당 대상자를 찾을 수 없습니다.' };
  if (!owns(row, normId(mid))) return { error: '본인 담당의 전도 대상자가 아닙니다.' };

  const [history, activities] = await Promise.all([
    run(db().from('target_history').select('*').eq('target_id', targetId).order('id')),
    activitiesAbout(row),
  ]);
  const journal = activities.map((a) => ({
    submittedAt: fmtTs(a.submitted_at), writerName: a.name, writerId: a.member_id,
    roles: a.roles, activityItem: a.activities.join(', '),
    stage: a.target_stage, note: a.special_note, todayWork: a.today_work, nextWork: a.next_work,
  })).sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));

  return {
    target: { ...toTarget(row), targetId, creatorId: row.creator_id },
    stageHistory: history.map(toHistory).sort(newestFirst),
    journal,
    stages: TARGET_STAGES,
  };
}

// ── 개강 인도 계획 (2026-10-20) ── 목표 개강 달까지 친분 → … → 센터 인도를 단계별 '흐름'으로.
// 구체적인 대화·상황 피드백은 AI 상담 코너, 최종 계획은 담당 교관과 상의하도록 화면이 안내한다.

const GOAL_RE = /^\d{4}-\d{2}$/;
const FLOW = '친분 → 만남(1·2) → 상담(1·2) → 복음방 → 센터 소개 → 센터 인도';

async function planCohortLead(body) {
  const mid = str(body.memberId);
  const targetId = str(body.targetId);
  if (!mid || !targetId) return { error: 'memberId, targetId 가 필요합니다.' };
  const target = await findTarget(targetId);
  if (!target) return { error: '해당 대상자를 찾을 수 없습니다.' };
  if (!owns(target, normId(mid))) return { error: '본인 담당의 전도 대상자가 아닙니다.' };
  const goal = str(target.goal_cohort);
  if (!GOAL_RE.test(goal)) return { error: '먼저 몇 월 개강으로 인도할지 체크해 주세요.' };

  const today = kstDate();
  const [gy, gm] = goal.split('-').map(Number);
  const weeks = Math.max(0, Math.round((Date.UTC(gy, gm - 1, 1) - Date.parse(today + 'T00:00:00Z')) / (7 * 864e5)));
  const d = await targetDossier(target, mid);

  const prompt = [
    `당신은 교회 전도 교사를 돕는 전도 코치입니다. 아래 대상자를 ${gm}월 개강 때 센터에 인도하도록 '흐름' 위주의 인도 계획을 설계하세요.`,
    '',
    `- 오늘: ${today} / 목표: ${gy}년 ${gm}월 개강(개강일은 그 달 초로 보고, 남은 기간 약 ${weeks}주)`,
    `- 대상자: ${[target.gender, target.age_group].filter(Boolean).join(' ') || '정보 없음'} / 지금 단계: ${target.stage || '섭외'} / 처음 등록: ${fmtTs(target.created_at).slice(0, 10) || '모름'}`,
    target.memo ? `- 대상자 메모: ${cut(target.memo, 1000)}` : '',
    `- 단계 순서: ${FLOW}`,
    '',
    '[지금까지의 기록 전부 — 오래된 것부터]',
    '■ 활동 기록', ...d.acts,
    '■ 교사가 파악한 정보(가족·직장·관심사·고민 등)', ...(d.info.length ? d.info : ['(없음)']),
    '■ 단계 변경 이력', ...d.history,
    '■ AI 상담·교관 답변', ...d.coaching,
    '■ 이전에 받은 AI 계획·피드백', ...d.notes,
    '',
    '규칙:',
    '1. 위 기록을 처음부터 끝까지 모두 종합하세요. 이 사람이 어떤 반응을 보였고 어디서 막혔는지, 교관·AI가 앞서 한 조언을 반영해 계획을 세우세요. 이전 계획이 있으면 무엇이 달라졌는지 "전체 흐름"에 한 줄로 쓰세요.',
    '2. 지금 단계부터 센터 인도까지 단계마다 "언제까지(날짜 또는 몇째 주)", "이 단계의 목표", "흐름 한두 줄"을 짧게 쓰세요. 이미 지난 단계는 쓰지 마세요.',
    '3. 구체적인 대화 멘트나 세부 전술은 쓰지 마세요(그건 따로 상담합니다). 전체 흐름과 시기 배분에 집중하세요.',
    '4. 남은 기간이 빠듯하면 솔직하게 말하고, 다음 개강으로 미루는 선택지도 한 줄로 알려 주세요.',
    '5. 한국어, 1000자 안팎. 반드시 아래 3개 마크다운 제목만 정확히 그대로 쓰세요:',
    '## 🗺️ 전체 흐름', '## 📅 단계별 계획', '## ⚠️ 놓치기 쉬운 점',
    '"단계별 계획" 안에서는 단계마다 "### 친분 — ~10/26" 처럼 소제목을 달고 그 아래 "- " 줄로 쓰세요.',
  ].filter((l) => l !== '').join('\n');

  const text = await askAiModels(prompt, PLAN_MODELS);
  const at = kstDateTime();
  if (!text.startsWith('⚠️')) {
    await run(db().from('targets').update({ goal_plan: text, goal_plan_at: at, goal_plan_basis: d.basis }).eq('id', target.id));
    await addTargetAiNote(target.target_id, mid, '개강 인도 계획', `${gm}월 개강 목표 · ${target.stage || '섭외'} 단계 · ${d.basis}`, text);
  }
  return { text, goalPlanAt: at, basis: d.basis };
}

// ── SWOT AI 전략 제안 (2026-10-22, SWOT 분석 2안) ── 교사가 쓴 SWOT(저장 안 한 것도) + 그 사람의 누적 기록 → 칸별 전략 제안.
// 받을 때 지금 SWOT도 같이 저장한다(제안과 SWOT이 어긋나지 않게). 무료 한도를 지키려고 교사 한 명 하루 SWOT_AI_DAILY번.

const SWOT_AI_DAILY = 10;
const SWOT_AI_KIND = 'SWOT AI 제안';
const SWOT_LABELS = { s: '강점(S, 내부)', w: '약점(W, 내부)', o: '기회(O, 외부)', t: '위협(T, 외부)', so: 'SO 전략(강점으로 기회 잡기)', st: 'ST 전략(강점으로 위협 막기)', wo: 'WO 전략(기회로 약점 채우기)', wt: 'WT 전략(약점·위협 피하거나 줄이기)' };
const swotCount = (v) => String(v || '').split('\n').filter((l) => l.trim()).length;

async function swotAdvice(body) {
  const mid = str(body.memberId);
  const targetId = str(body.targetId);
  if (!mid || !targetId) return { error: 'memberId, targetId 가 필요합니다.' };
  const target = await findTarget(targetId);
  if (!target) return { error: '해당 대상자를 찾을 수 없습니다.' };
  if (!owns(target, normId(mid))) return { error: '본인 담당의 전도 대상자가 아닙니다.' };
  const sw = body.swot !== undefined ? cleanSwot(body.swot) : target.swot;
  if (!sw || !['s', 'w', 'o', 't'].some((k) => str(sw[k]))) return { error: '먼저 강점·약점·기회·위협을 한 칸 이상 적어 주세요.' };

  const today = kstDate();
  const used = await run(db().from('target_ai_notes').select('id').eq('member_id', mid).eq('kind', SWOT_AI_KIND).gte('created_at', `${today} 00:00:00`));
  if (used.length >= SWOT_AI_DAILY) return { error: `SWOT AI 제안은 하루 ${SWOT_AI_DAILY}번까지예요. 내일 다시 받아 보세요.` };

  const n = { s: swotCount(sw.s), w: swotCount(sw.w), o: swotCount(sw.o), t: swotCount(sw.t) };
  const rec = (n.s >= n.w ? 'S' : 'W') + (n.o >= n.t ? 'O' : 'T');
  const d = await targetDossier(target, mid);
  const next = sw.next || {};
  const prompt = [
    '당신은 교회 전도 교사를 돕는 전도 코치입니다. 교사가 섭외자(전도 대상자) 한 명에 대해 쓴 SWOT 분석을 보고, 칸별 전략을 다듬어 제안하세요.',
    '',
    `- 오늘: ${today} / 대상자: ${[target.gender, target.age_group].filter(Boolean).join(' ') || '정보 없음'} / 지금 단계: ${target.stage || '섭외'}`,
    target.goal_cohort ? `- 목표: ${Number(target.goal_cohort.slice(5))}월 개강 센터 인도` : '',
    `- 단계 순서: ${FLOW}`,
    '',
    '[교사가 쓴 SWOT]',
    ...Object.entries(SWOT_LABELS).map(([k, l]) => `■ ${l}: ${str(sw[k]) ? cut(sw[k], 1500).replace(/\n/g, ' / ') : '(비어 있음)'}`),
    next.text ? `■ 교사가 정한 다음 행동: ${cut(next.text, 300)}${next.date ? ` (${next.date})` : ''}` : '',
    `■ 개수 비교로 앱이 고른 추천 칸: ${rec} (강점 ${n.s} : 약점 ${n.w}, 기회 ${n.o} : 위협 ${n.t})`,
    '',
    '[참고: 이 사람에 대한 지금까지의 기록 — 오래된 것부터]',
    '■ 활동 기록', ...d.acts,
    '■ 교사가 파악한 정보(가족·직장·관심사·고민 등)', ...(d.info.length ? d.info : ['(없음)']),
    '■ 단계 변경 이력', ...d.history,
    '■ AI 상담·교관 답변', ...d.coaching,
    '■ 이전에 받은 AI 계획·피드백', ...d.notes,
    '',
    '규칙:',
    '1. 교사가 쓴 SWOT과 기록을 함께 보세요. 기록에는 있는데 SWOT에 빠진 점, 서로 어긋나는 점이 있으면 "상황 진단"에서 짚으세요.',
    '2. 네 전략 칸마다 교사의 초안을 살려 실제로 해 볼 방법을 2~3줄로 쓰세요. 초안이 비어 있으면 새로 제안하세요.',
    '3. 가장 먼저 할 전략 하나를 고르고 이유를 쓰세요. 앱의 추천 칸과 다르게 고르면 왜 다른지 한 줄로 쓰세요.',
    '4. 상대를 속이거나 압박하는 방법은 쓰지 마세요. 상대의 뜻과 시간을 존중하고 관계와 신뢰를 지키는 방향으로 쓰세요.',
    '5. 한국어, 900자 안팎. 반드시 아래 4개 마크다운 제목만 정확히 그대로 쓰세요:',
    '## 🧭 상황 진단', '## 🎯 칸별 전략', '## ⭐ 먼저 할 것', '## 👣 이번 주 할 일',
    '"칸별 전략" 안에서는 "### SO 전략", "### ST 전략", "### WO 전략", "### WT 전략" 소제목을 이 순서대로 달고 그 아래 "- " 줄로 쓰세요. "이번 주 할 일"도 "- " 줄 2~3개로 쓰세요.',
  ].filter((l) => l !== '').join('\n');

  const text = await askAiModels(prompt, PLAN_MODELS);
  const at = kstDateTime();
  if (text.startsWith('⚠️')) return { text };
  await run(db().from('targets').update({ swot: sw, swot_at: at, swot_ai: text, swot_ai_at: at, updated_at: at }).eq('id', target.id));
  await addTargetAiNote(target.target_id, mid, SWOT_AI_KIND, `${target.stage || '섭외'} 단계 · 추천 ${rec} · ${d.basis}`, text);
  return { text, swotAiAt: at, swotAt: at, basis: d.basis };
}

// ── 섭외자 한 사람 화면(2026-10-25, 내 활동 보고) ── HEARTS(AI상담·교관 답) 누적 + 지금까지 받은 AI 개강 계획 누적. 새것부터.
async function getTargetFile(body) {
  const mid = str(body.memberId);
  const target = await ownedTarget(mid, body.targetId);
  if (!target) return { error: '본인 담당의 섭외자가 아닙니다.' };
  const [coach, plans] = await Promise.all([
    coachingAbout(target, mid),
    run(db().from('target_ai_notes').select('*').eq('target_id', target.target_id).eq('kind', '개강 인도 계획').order('id', { ascending: false })).catch(() => []),
  ]);
  return {
    hearts: coach.reverse().map((f) => ({ at: fmtTs(f.submitted_at), source: f.source, situation: f.situation, ai: f.ai_coach_text, handler: f.handler, answer: f.handler_answer, status: f.status })),
    plans: plans.map((n) => ({ at: fmtTs(n.created_at), input: n.input, text: n.text })),
  };
}

// ── 사례로 남기기 (2026-10-25) ── 사용자: "센터를 보내면 성공 사례를 써야 하는데 이것도 일이잖아 — 사례 서식에 맞추어 사례 글이 나오도록".
// 그 사람의 누적 기록 전부 → 사례 틀 7항목 초안. 앱은 이 초안으로 사례 글쓰기 화면을 열고, 교사가 다듬어 올린다(바로 올리지 않음).
// ⚠️ 항목 제목은 app.html CASE_SECTIONS 와 같아야 틀로 다시 열린다.
const CASE_SECTIONS = [
  ['마음 사기 · 친분', '첫 만남 · 공감 · 소망 심기'],
  ['단계 향상 방법', '섭외 → 친분 → 만남 → 상담 → 복음방'],
  ['경계 낮추기 · 방해 극복', '신뢰 쌓기 · 방해 요소와 이겨 낸 방법'],
  ['교사 연결', '연결 방법 · 교사 컨셉'],
  ['성경 띄우기', '기간 띄우기 · 동기 부여'],
  ['센터 소개', '시기 · 방법 · 소개 멘트'],
  ['깨달은 점', '감사 · 배운 점'],
];
const CASE_AI_DAILY = 5;
const CASE_AI_KIND = '사례 초안';

async function writeCaseDraft(body) {
  const mid = str(body.memberId);
  const target = await ownedTarget(mid, body.targetId);
  if (!target) return { error: '본인 담당의 섭외자가 아닙니다.' };
  const today = kstDate();
  const used = await run(db().from('target_ai_notes').select('id').eq('member_id', mid).eq('kind', CASE_AI_KIND).gte('created_at', `${today} 00:00:00`));
  if (used.length >= CASE_AI_DAILY) return { error: `사례 초안은 하루 ${CASE_AI_DAILY}번까지예요. 내일 다시 만들어 보세요.` };
  const d = await targetDossier(target, mid);
  const who = `${target.gender || ''}${target.age_group ? ' ' + target.age_group : ''}`.trim() || '섭외자';
  const prompt = [
    '당신은 교회 전도 교사의 "센터 등록 성공 사례" 글을 대신 정리해 주는 편집자입니다. 아래 기록만 근거로, 교사 본인이 1인칭으로 쓴 사례 글 초안을 만드세요.',
    '',
    `- 섭외자: ${who} / 지금 단계: ${target.stage || '섭외'} / 처음 등록: ${day(target.created_at) || '모름'}`,
    '',
    '[지금까지의 기록 전부 — 오래된 것부터]',
    '■ 활동 기록', ...d.acts,
    '■ 교사가 파악한 정보(가족·직장·관심사·고민 등)', ...(d.info.length ? d.info : ['(없음)']),
    '■ 단계 변경 이력', ...d.history,
    '■ AI 상담·교관 답변', ...d.coaching,
    '■ 이전에 받은 AI 계획·피드백', ...d.notes,
    '',
    '규칙:',
    '1. 기록에 있는 사실만 쓰세요. 기록에 없는 일(날짜·멘트·사건)을 지어내지 마세요. 그 항목에 쓸 기록이 없으면 "(기록 없음 — 직접 채워 주세요)" 한 줄만 쓰세요.',
    '2. 섭외자 실명은 쓰지 말고 "그분", "○○님"처럼 쓰세요. 함께한 교사·섬김이 이름도 역할로만 쓰세요.',
    '3. 다른 교사가 읽고 따라 할 수 있게, 단계마다 무엇을 했고 상대가 어떻게 반응했는지 구체적으로 쓰세요. 항목마다 2~5문장.',
    '4. 맨 첫 줄은 "제목: " 다음에 30자 안쪽 제목(예: 세 번 거절당한 분이 센터에 오시기까지).',
    '5. 그 다음부터 아래 7개 항목 머리줄을 글자 하나 바꾸지 말고 이 순서대로 쓰고, 머리줄 바로 아래에 내용을 쓰세요. 마크다운 기호(#, *, -)는 쓰지 마세요.',
    ...CASE_SECTIONS.map(([t, s], i) => `${i + 1}. ${t} (${s})`),
  ].join('\n');
  const text = await askAiModels(prompt, PLAN_MODELS);
  if (text.startsWith('⚠️')) return { error: text.replace(/^⚠️\s*/, '') };
  // 머리줄을 틀 제목 그대로 맞춰 다시 짓는다(AI가 번호·괄호를 조금 바꿔도 앱 틀로 열리게)
  const lines = text.replace(/\*\*/g, '').split('\n');
  const tl = lines.find((l) => /^\s*제목\s*[:：]/.test(l));
  const title = tl ? tl.replace(/^\s*제목\s*[:：]\s*/, '').trim().slice(0, 80) : '';
  const sec = CASE_SECTIONS.map(() => []);
  let cur = -1;
  for (const l of lines) {
    if (l === tl) continue;
    const m = l.match(/^\s*#*\s*(\d)\s*[.)]\s*(.+)$/);
    const idx = m ? CASE_SECTIONS.findIndex(([t]) => m[2].replace(/\s/g, '').startsWith(t.replace(/\s/g, ''))) : -1;
    if (idx >= 0) { cur = idx; continue; }
    if (cur >= 0) sec[cur].push(l);
  }
  const bodyText = CASE_SECTIONS.map(([t, s], i) => `${i + 1}. ${t} (${s})\n${sec[i].join('\n').trim()}`).join('\n\n');
  if (!sec.some((x) => x.join('').trim())) return { error: 'AI가 사례 틀대로 쓰지 못했어요. 한 번 더 눌러 주세요.' };
  await addTargetAiNote(target.target_id, mid, CASE_AI_KIND, `${target.stage || '섭외'} 단계 · ${d.basis}`, text);
  return { title, body: bodyText, basis: d.basis };
}


// ── 대상자 한 사람의 누적 기록 (2026-10-20) ──
// 사용자: "최근 한 건 말고, 지금까지 그 사람에 대한 기록을 총합하여 — 과거 AI 코칭 기록 등을 누적 또 누적하여".
// 활동 기록 전부 + 단계 이력 + 그 사람 이야기가 든 AI 상담·교관 답 + 이전 AI 계획·활동 AI 피드백(target_ai_notes).

// 무료 등급 gemini-3-flash-preview(AI상담 기본 모델)는 하루 20회라 여기서는 쓰지 않는다(AI상담 한도를 지키려고).
const PLAN_MODELS = ['gemini-3.5-flash', 'gemini-3.8-flash'];
const cut = (s, n) => { const t = String(s == null ? '' : s).trim(); return t.length > n ? t.slice(0, n) + '…' : t; };
const maskName = (s) => { const t = String(s || '').trim(); return t.length <= 1 ? t : t.length === 2 ? t[0] + '*' : t[0] + '*'.repeat(t.length - 2) + t.at(-1); };
const day = (v) => fmtTs(v).slice(0, 10);

/** 새것부터 budget 글자까지만 남기고(넘치면 오래된 것을 줄인다) 다시 오래된 순으로. */
function keepNewest(lines, budget) {
  const out = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    used += lines[i].length;
    if (used > budget) { out.unshift(`- (그 전 기록 ${i + 1}건은 길어서 생략)`); break; }
    out.unshift(lines[i]);
  }
  return out.length ? out : ['- 없음'];
}

export async function addTargetAiNote(targetId, memberId, kind, input, text) {
  try {
    await run(db().from('target_ai_notes').insert({ target_id: targetId, member_id: memberId, kind, input: cut(input, 2000), text, created_at: kstDateTime() }));
  } catch { /* 기록 실패가 AI 답을 막지는 않는다 */ }
}

/** 이 교사가 담당하는 대상자인지 확인한 뒤의 대상자 행(아니면 null). */
export async function ownedTarget(memberId, targetId) {
  if (!str(memberId) || !str(targetId)) return null;
  const t = await findTarget(str(targetId));
  return t && owns(t, normId(memberId)) ? t : null;
}

/** 이 대상자 이야기가 든 AI상담(HEARTS)·교관 요청 — 오래된 것부터. */
async function coachingAbout(target, mid) {
  const name = target.target_name.trim();
  const owners = [...new Set([target.creator_id, target.leader_id, target.helper_id, mid].filter((id) => str(id)).map(normId))];
  const [mine, feedbacks] = await Promise.all([
    run(db().from('targets').select('target_name').or(ownedBy(normId(mid)))),
    selectAll(() => db().from('feedbacks').select('*').in('nid', owners).order('id')),
  ]);
  // AI상담·교관 요청의 '상황'에는 보통 "대상자: 홍*동"처럼 가린 이름이 들어간다 — 내 대상자 중 가린 이름이 겹치면 실명으로만 찾는다.
  const m = maskName(name);
  const maskUnique = mine.filter((t) => maskName(t.target_name) === m).length <= 1;
  const about = (s) => !!name && (s.includes(name) || (maskUnique && m.length > 1 && s.includes(m)));
  return feedbacks.filter((f) => about(String(f.situation || ''))).sort((a, b) => (String(a.submitted_at) < String(b.submitted_at) ? -1 : 1));
}

export async function targetDossier(target, mid) {
  const [acts, history, allNotes, coach] = await Promise.all([
    activitiesAbout(target),
    run(db().from('target_history').select('*').eq('target_id', target.target_id).order('id')),
    run(db().from('target_ai_notes').select('*').eq('target_id', target.target_id).order('id')).catch(() => []),
    coachingAbout(target, mid),
  ]);
  // 10/30: 교사가 파악한 정보(INFO_KIND)는 AI 기록과 따로 — 모든 AI 프롬프트에 '■ 교사가 파악한 정보'로 들어간다
  const info = allNotes.filter((n) => n.kind === INFO_KIND);
  const notes = allNotes.filter((n) => n.kind !== INFO_KIND);
  const infoLines = info.map((n) => `- ${day(n.created_at)} [${n.input || '기타'}] ${cut(n.text, 1500)}`);

  const actLines = acts.sort((a, b) => (String(a.submitted_at) < String(b.submitted_at) ? -1 : 1)).map((a) => '- ' + [
    day(a.submitted_at), a.roles.length && `[${a.roles.join('·')}]`, a.activities.join(', '), a.target_stage && `(단계: ${a.target_stage})`,
    a.consult_title && `상담 제목: ${a.consult_title}`, a.gospel_subject && `과목: ${a.gospel_subject}`,
    a.reaction && `반응: ${a.reaction}${a.reaction_note ? ` — ${a.reaction_note}` : ''}`,
    a.today_work && `한 일: ${cut(a.today_work, 600)}`, a.next_work && `다음: ${cut(a.next_work, 300)}`, a.special_note && `특이사항: ${cut(a.special_note, 300)}`,
  ].filter(Boolean).join(' / '));
  const histLines = history.map((h) => `- ${day(h.changed_at)} ${h.from_stage || '(처음)'} → ${h.to_stage}${h.memo ? ` (${cut(h.memo, 200)})` : ''}`);
  const coachLines = coach.map((f) => [`- ${day(f.submitted_at)} [${f.source}] 상황: ${cut(f.situation, 400)}`,
    f.ai_coach_text && `  AI 답: ${cut(f.ai_coach_text, 1500)}`, f.handler_answer && `  교관 답(${f.handler || '교관'}): ${cut(f.handler_answer, 1200)}`].filter(Boolean).join('\n'));
  const noteLines = notes.map((n) => `- ${day(n.created_at)} [${n.kind}] ${cut(n.input, 300)}\n  ${cut(n.text, 2500).replace(/\n/g, '\n  ')}`);

  return {
    acts: keepNewest(actLines, 30000), history: keepNewest(histLines, 4000),
    coaching: keepNewest(coachLines, 15000), notes: keepNewest(noteLines, 12000), info: keepNewest(infoLines, 20000),
    basis: `활동 ${acts.length}건 · 파악 정보 ${info.length}건 · 단계 이력 ${history.length}건 · AI상담·교관 ${coach.length}건 · 이전 AI 기록 ${notes.length}건 종합`,
  };
}

/**
 * 대상자를 영구 삭제한다 — 단계 이력, AI 기록(피드백·개강 계획·SWOT 제안), 그 대상자에 대한 담당자들의 활동 기록까지.
 * 2026-10-27: 내 활동 보고 그리드에서 지울 때는 대상자 행이 없을 수도 있어 이름(targetName)으로도 받는다 —
 *             내 담당 대상자 중 같은 이름을 찾고, 없으면 내가 그 이름으로 남긴 활동 기록만 지운다.
 */
async function deleteTarget(body) {
  const mid = str(body.memberId);
  let targetId = str(body.targetId);
  const byName = str(body.targetName);
  if (!mid || (!targetId && !byName)) return { error: 'memberId, targetId 가 필요합니다.' };
  const nid = normId(mid);
  if (!targetId) {
    const mine = await run(db().from('targets').select('target_id, target_name').or(ownedBy(nid)).order('id'));
    const hit = mine.find((t) => t.target_name.trim() === byName);
    if (hit) targetId = hit.target_id;
    else {
      const gone = (await run(db().from('activities').select('id, target_name').eq('nid', nid).order('id')))
        .filter((a) => a.target_name.trim() === byName).map((a) => a.id);
      if (gone.length) await run(db().from('activities').delete().in('id', gone));
      return { ok: true, targetName: byName, deletedActivities: gone.length, deletedHistory: 0 };
    }
  }
  const target = await findTarget(targetId);
  if (!target) return { error: '해당 대상자를 찾을 수 없습니다.' };
  if (!owns(target, nid)) return { error: '본인 담당의 전도 대상자만 삭제할 수 있습니다.' };

  const activityIds = (await activitiesAbout(target)).map((a) => a.id);
  if (activityIds.length) await run(db().from('activities').delete().in('id', activityIds));
  const history = await run(db().from('target_history').delete().eq('target_id', targetId).select('id'));
  try { await run(db().from('target_ai_notes').delete().eq('target_id', targetId)); } catch { /* 표가 없어도 삭제는 계속 */ }
  await run(db().from('targets').delete().eq('id', target.id));
  return { ok: true, targetName: target.target_name.trim(), deletedActivities: activityIds.length, deletedHistory: history.length };
}

// ── 관리자 현황: 진행 중인 대상자의 단계 분포 ──

const ROLES = ['인도자', '교사', '섬김이', '협력교사'];
// 협력교사는 대상자를 맡지 않으므로 올해 협력 활동을 항목별로 센다. ⚠️ app.html COOP_ACTIVITY_OPTIONS 와 같이 맞출 것.
const COOP_ITEMS = ['동아리', '잎사귀', '만남 동행', '밭보기', '육상담', '부스담당', '은사', '멘토교사', '동행교사'];

/** 진행 중인 대상자마다 { stage, roles } — roles 는 담당자들이 그 대상자 활동에 적은 역할 + 담당 배정. */
async function openTargetsWithRoles() {
  const [activities, targets] = await Promise.all([
    selectAll(() => db().from('activities').select('nid, target_name, roles').neq('member_id', '').neq('target_name', '').order('id')),
    selectAll(() => db().from('targets').select('*').eq('completed', false).order('id')),
  ]);
  const rolesBy = new Map();
  for (const a of activities) {
    const name = a.target_name.trim();
    if (!name) continue;
    const key = `${a.nid}::${name}`;
    if (!rolesBy.has(key)) rolesBy.set(key, new Set());
    a.roles.forEach((r) => rolesBy.get(key).add(r));
  }
  return targets.map((t) => {
    const roles = new Set();
    for (const id of [t.creator_id, t.leader_id, t.helper_id]) {
      if (str(id)) rolesBy.get(`${normId(id)}::${t.target_name.trim()}`)?.forEach((r) => roles.add(r));
    }
    if (str(t.leader_id)) roles.add('인도자');
    if (str(t.helper_id)) roles.add('섬김이');
    return { stage: t.stage, roles };
  });
}

async function getTargetStageDistribution(body) {
  let role = str(body.role);
  if (role === '협력') role = '협력교사';
  if (role && !ROLES.includes(role)) return { error: '알 수 없는 역할: ' + role };

  if (role === '협력교사') {
    const year = Number(kstDate().slice(0, 4));
    const activities = await selectAll(() => db().from('activities').select('activities')
      .neq('member_id', '').contains('roles', [role])
      .gte('submitted_at', `${year}-01-01`).lt('submitted_at', `${year + 1}-01-01`).order('id'));
    const counts = Object.fromEntries(COOP_ITEMS.map((s) => [s, 0]));
    let total = 0, other = 0;
    for (const item of activities.flatMap((a) => a.activities)) {
      if (!item) continue;
      if (counts[item] === undefined) { other++; continue; }
      counts[item]++; total++;
    }
    return { role, kind: 'items', total, other, stages: COOP_ITEMS.map((stage) => ({ stage, count: counts[stage] })) };
  }

  const counts = Object.fromEntries(TARGET_STAGES.map((s) => [s, 0]));
  let total = 0, other = 0;
  for (const t of await openTargetsWithRoles()) {
    if (role && !t.roles.has(role)) continue;
    if (counts[t.stage] === undefined) { other++; continue; }
    counts[t.stage]++; total++;
  }
  return { role, total, other, stages: TARGET_STAGES.map((stage) => ({ stage, count: counts[stage] })) };
}

/** 표지 숫자: 복음방·센터소개·센터수강 단계 대상자 수. */
async function getKeyStageCount() {
  const { stages } = await getTargetStageDistribution({});
  const by = Object.fromEntries(stages.map((s) => [s.stage, s.count]));
  return { gospel: by['복음방'] || 0, centerIntro: by['센터소개'] || 0, centerAttend: by['센터수강'] || 0 };
}

// ── 파악한 정보 (2026-10-30) ── 사용자: "파악한 정보를 기록하게, 무제한으로, 페이지를 잘 만들고, 그게 모여서 AI 피드백이 나오게".
//   target_ai_notes 에 kind '파악정보'(input = 분류, text = 내용)로 한 줄씩 — 개수 제한 없음. 모든 AI(단계향상·개강 계획·SWOT·사례)가 읽는다.
const INFO_KIND = '파악정보';
const INFO_FB_KIND = 'AI 파악정보 피드백';
const INFO_CATS = ['가족', '직장·학업', '관심사·취미', '고민·필요', '신앙 배경', '성격·성향', '일정·연락', '기타'];
const infoRow = (n) => ({ id: n.id, cat: n.input || '기타', cats: String(n.input || '기타').split(',').map((c) => c.trim()).filter(Boolean), text: n.text, at: fmtTs(n.created_at), mine: true });

async function getTargetInfo(body) {
  const target = await ownedTarget(body.memberId, body.targetId);
  if (!target) return { error: '본인 담당의 섭외자가 아닙니다.' };
  const rows = await run(db().from('target_ai_notes').select('*').eq('target_id', target.target_id).in('kind', [INFO_KIND, INFO_FB_KIND]).order('id'));
  const fb = rows.filter((n) => n.kind === INFO_FB_KIND).pop();
  return { ok: true, cats: INFO_CATS, items: rows.filter((n) => n.kind === INFO_KIND).map(infoRow).reverse(), feedback: fb ? { text: fb.text, at: fmtTs(fb.created_at), basis: fb.input } : null };
}
async function addTargetInfo(body) {
  const target = await ownedTarget(body.memberId, body.targetId);
  if (!target) return { error: '본인 담당의 섭외자가 아닙니다.' };
  const text = str(body.text).slice(0, 2000);
  if (!text) return { error: '내용을 적어 주세요.' };
  // 10/30(사용자): 한 정보에 분류 여러 개(종합) — cats 배열(옛 앱은 cat 하나). 저장은 '가족, 고민·필요'처럼
  const picked = (Array.isArray(body.cats) ? body.cats : [body.cat]).map(str).filter((c) => INFO_CATS.includes(c));
  const cat = [...new Set(picked)].join(', ') || '기타';
  const [row] = await run(db().from('target_ai_notes').insert({ target_id: target.target_id, member_id: str(body.memberId), kind: INFO_KIND, input: cat, text, created_at: kstDateTime() }).select('*'));
  return { ok: true, item: infoRow(row) };
}
async function deleteTargetInfo(body) {
  const target = await ownedTarget(body.memberId, body.targetId);
  if (!target) return { error: '본인 담당의 섭외자가 아닙니다.' };
  await run(db().from('target_ai_notes').delete().eq('id', Number(body.id)).eq('target_id', target.target_id).eq('kind', INFO_KIND));
  return { ok: true };
}
/** 10/30(사용자: "누적 교육 제목이 밖에 안 보인다"): 사람 화면에서 바로 누적 교육 제목 목록을 고친다(추가·빼기). */
async function setTargetLessons(body) {
  const target = await ownedTarget(body.memberId, body.targetId);
  if (!target) return { error: '본인 담당의 섭외자가 아닙니다.' };
  const lessons = (Array.isArray(body.lessons) ? body.lessons : []).slice(-60)
    .map((l) => ({ date: str(l && l.date).slice(0, 10) || kstDate(), title: str(l && l.title).slice(0, 120) })).filter((l) => l.title);
  const p = { ...(target.report_profile || {}), lessons };
  await run(db().from('targets').update({ report_profile: p, updated_at: kstDateTime() }).eq('target_id', target.target_id));
  return { ok: true, lessons };
}
/** 모은 정보 + 그 사람 기록 전부로 AI 피드백: 이 사람은 어떤 사람인가 / 마음을 여는 열쇠 / 다음 만남 대화 주제 / 조심할 점 / 더 알아볼 것. */
async function targetInfoFeedback(body) {
  const mid = str(body.memberId);
  const target = await ownedTarget(mid, body.targetId);
  if (!target) return { error: '본인 담당의 섭외자가 아닙니다.' };
  const d = await targetDossier(target, mid);
  if (!d.info.length) return { error: '파악한 정보를 한 줄 이상 적어 주세요.' };
  const prompt = [
    '당신은 교회 전도 교사를 돕는 베테랑 전도 코치입니다. 교사가 한 사람(섭외자)에 대해 파악한 정보를 모아 이 사람을 깊이 이해하고 다음 단계로 이끌 피드백을 주세요.',
    `- 섭외자: ${target.gender || ''} ${target.age_group || ''} / 지금 단계: ${target.stage || '섭외'}${target.goal_cohort ? ` / 목표: ${Number(target.goal_cohort.slice(5))}월 개강 센터 인도` : ''}`,
    '',
    '■ 교사가 파악한 정보(가장 중요)', ...d.info,
    '■ 활동 기록', ...d.acts,
    '■ 단계 변경 이력', ...d.history,
    '■ AI 상담·교관 답변', ...d.coaching,
    '',
    '규칙: 파악한 정보에 적힌 사실을 근거로, 이 사람에게만 맞는 말로 짧고 구체적으로. 일반론·지어낸 사실 금지. 실명 대신 "그분".',
    '반드시 아래 5개 마크다운 제목을 그대로 쓰고 다른 제목은 추가하지 마세요:',
    '## 🧑 이 사람은 이런 분이에요', '## 🔑 마음을 여는 열쇠', '## 💬 다음 만남 대화 주제 (3가지)', '## ⚠️ 조심할 점', '## 🔍 더 알아보면 좋을 것',
  ].join('\n');
  const text = await askAiModels(prompt, PLAN_MODELS);
  if (text.startsWith('⚠️')) return { error: text.replace(/^⚠️\s*/, '') };
  const basis = `파악 정보 ${d.info.length}건 종합`;
  await addTargetAiNote(target.target_id, mid, INFO_FB_KIND, basis, text);
  return { ok: true, text, at: fmtTs(kstDateTime()), basis };
}

export default {
  getTargetStageDistribution, getKeyStageCount,
  addTarget, getTargets, getMyTargets: getTargets, updateTarget, updateTargetStage: updateTarget,
  getTargetJournal, deleteTarget, planCohortLead, swotAdvice, writeCaseDraft, getTargetFile,
  getTargetInfo, addTargetInfo, deleteTargetInfo, targetInfoFeedback, setTargetLessons,
};
