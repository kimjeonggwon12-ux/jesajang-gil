// QR 출석: 모임 · 출석 · 관리자 화면 · 마감 서머리
import { db, run, selectAll } from '../lib/db.js';
import { normId, kstDate, kstDateTime, fmtTs } from '../lib/util.js';
import { clip, pickList, newId, isDate } from '../lib/input.js';
import { sendAttendText } from '../lib/attend-bot.js';
import { findTeacher, findAdmin, isAdmin } from './roster.js';
import { closingBoxText, sendClosing } from './attendance-closing.js';

const QUESTION_TYPES = ['choice', 'multi', 'text'];
const ORG_OPTIONS = ['부녀', '장년', '청년', '자문', '교역자', '전체', '기타'];   // 모임의 부서
const ORGS_WITH_DISTRICT = ['부녀', '장년', '청년', '자문'];                     // 지역이 있는 부서
const DISTRICT_MAX = 12;
const EXTRA_DISTRICTS = { 부녀: ['유아모'] };
const PICK_ORGS = ['교역자', '자문', '장년', '부녀', '청년'];                    // 참석자가 고르는 소속
const DEPT24 = ['행서', '내무', '기획', '재정', '교육', '신학', '해선', '문화', '출판', '정통', '찬양', '섭외', '국선', '홍보', '법무', '건설', '체육', '사업', '후생', '봉교'];

export const isTestMeeting = (m) => String(m.title).startsWith('[TEST]');

// ── 작은 도구 ──

/** '기타'를 골랐을 때: 직접 쓴 글이 있으면 '기타(글)', 없으면 ''. '기타'가 아니면 null. */
function etc(value, typed) {
  if (String(value) !== '기타') return null;
  const t = clip(typed, 30);
  return t ? `기타(${t})` : '';
}

/** 'H:mm' / 'HH:mm…' → 'HH:mm' (아니면 ''). */
function hhmm(v) {
  const m = String(v == null ? '' : v).trim().match(/^(\d{1,2}):(\d{2})/);
  return m ? m[1].padStart(2, '0') + ':' + m[2] : '';
}

/** 지역 값 다듬기: 1~12 숫자 또는 그 부서의 특별 지역(유아모). 아니면 ''. */
function cleanDistrict(org, v) {
  if (v == null || v === '' || !ORGS_WITH_DISTRICT.includes(org)) return '';
  const s = String(v).trim().replace(/지역$/, '');
  if (/^\d+$/.test(s)) { const n = Number(s); return n >= 1 && n <= DISTRICT_MAX ? n : ''; }
  return (EXTRA_DISTRICTS[org] || []).includes(s) ? s : '';
}

/** "부녀회 3지역" 같은 표시 이름. */
export function meetLabel({ org, district }) {
  let label = org ? org + (ORGS_WITH_DISTRICT.includes(org) ? '회' : '') : '';
  if (district != null && district !== '') label += (label ? ' ' : '') + (typeof district === 'number' ? district + '지역' : district);
  return label;
}

/** 참석자가 고른 소속·지역·24부서를 한 줄로. */
export const pickText = (rec) =>
  [meetLabel({ org: rec.pickOrg, district: rec.pickDistrict === '' ? null : rec.pickDistrict }), rec.dept24].filter(Boolean).join(' · ');

/** 명단의 부서 이름에서 소속을 찾는다('부녀회' → '부녀'). */
const orgFromDept = (dept) => PICK_ORGS.find((o) => String(dept || '').includes(o)) || '';

/** 명단의 지역에서 지역 번호를 찾는다('03지역' → 3). */
function districtFromRegion(org, region) {
  if (!ORGS_WITH_DISTRICT.includes(org)) return '';
  const r = String(region || '');
  if (r.includes('유아모') && org === '부녀') return '유아모';
  const n = Number(r.replace(/\D/g, ''));
  return n >= 1 && n <= DISTRICT_MAX ? n : '';
}

/**
 * 출석 시각으로 본 지각 여부: '정상 출석' 또는 'N분 지각'.
 * 저녁 시작 시각이 있으면 15시 이후 출석은 그 시각을 기준으로 본다.
 */
export function lateText(m, at) {
  if (!m || !m.start || !m.date) return '';
  const a = String(at || '');
  const base = m.start2 && a.slice(11, 16) >= '15:00' ? m.start2 : m.start;
  if (a.slice(0, 10) !== m.date || a <= `${m.date} ${base}:00`) return '정상 출석';
  const [h, min, s] = a.slice(11).split(':').map(Number);
  const [bh, bm] = base.split(':').map(Number);
  const sec = h * 3600 + min * 60 + (s || 0) - (bh * 3600 + bm * 60);
  return sec > 0 ? Math.max(1, Math.floor(sec / 60)) + '분 지각' : '정상 출석';
}

// ── 모임 ──

function toMeeting(r) {
  const district = cleanDistrict(r.org, r.district);
  return {
    meetingId: r.meeting_id, title: r.title, date: r.date, start: hhmm(r.start_time), end: hhmm(r.end_time),
    place: r.place, openBefore: r.open_before >= 0 ? r.open_before : 30, questions: r.questions || [],
    status: r.status || '열림', createdBy: r.created_by, createdAt: fmtTs(r.created_at),
    org: r.org, district: district === '' ? null : district,
    askDistrict: r.ask_district, askDept: r.ask_dept, start2: hhmm(r.start2),
  };
}

/** 지워지지 않은 모임(최근 것부터). */
export async function loadMeetings() {
  const rows = await selectAll(() => db().from('attend_meetings').select('*').neq('status', '삭제').order('id'));
  return rows.map(toMeeting).sort((a, b) => {
    const ka = a.date + a.start;
    const kb = b.date + b.start;
    return kb < ka ? -1 : (kb > ka ? 1 : 0);
  });
}

export async function findMeeting(meetingId) {
  if (!meetingId) return null;
  const [row] = await run(db().from('attend_meetings').select('*').eq('meeting_id', meetingId).neq('status', '삭제').limit(1));
  return row ? toMeeting(row) : null;
}

/** 지금 출석을 받을 수 있는가 + 열리는·닫히는 시각. */
function attendWindow(m) {
  const now = kstDateTime().slice(0, 16);
  let opensAt = `${m.date} ${m.start || '00:00'}`;
  if (m.start) {
    const [y, mo, d] = m.date.split('-').map(Number);
    const [h, min] = m.start.split(':').map(Number);
    opensAt = kstDateTime(new Date(y, mo - 1, d, h, min - m.openBefore)).slice(0, 16);
  }
  const closesAt = `${m.date} ${m.end || '23:59'}`;
  const short = (t) => t.slice(5).replace('-', '/');
  let reason = '';
  if (m.status === '닫힘' || m.status === '집계완료') reason = '관리자가 출석을 마감했어요.';
  else if (now < opensAt) reason = `아직 출석 시간이 아니에요. ${short(opensAt)}부터 출석할 수 있어요.`;
  else if (now > closesAt) reason = `출석 시간이 끝났어요(${short(closesAt)}까지).`;
  return { open: !reason, reason, opensAt, closesAt };
}

/** 참석자에게 보여 주는 모임 정보. */
function toPublic(m) {
  const { meetingId, title, date, start, end, place, openBefore, questions, status, org, district, askDistrict, askDept } = m;
  return { meetingId, title, date, start, end, place, openBefore, questions, status, org, district, askDistrict, askDept, ...attendWindow(m) };
}

// ── 출석 기록 ──

const toRecord = (r) => ({
  recordId: r.record_id, meetingId: r.meeting_id, memberId: r.member_id, name: r.name, dept: r.dept, position: r.position,
  answers: r.answers || {}, at: fmtTs(r.at), method: r.method, pickOrg: r.pick_org,
  pickDistrict: /^\d+$/.test(r.pick_district) ? Number(r.pick_district) : r.pick_district,
  dept24: r.dept24, late: r.late,
});

/** 출석 기록(적힌 순서). 같은 모임에 같은 사람이 두 번 있으면 첫 기록만. */
export async function loadRecords(filter) {
  const rows = await selectAll(() => filter(db().from('attend_records').select('*').neq('record_id', '')).order('id'));
  const seen = new Set();
  return rows.map(toRecord).filter((rec) => {
    const key = `${rec.meetingId}|${normId(rec.memberId)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 출석하는 사람의 정보: 명단 + 관리자 명단(관리자 명단의 이름·부서·직책이 우선). */
async function personOf(memberId) {
  const [teacher, admin] = await Promise.all([findTeacher(memberId), findAdmin(memberId)]);
  if (!teacher && !admin) return null;
  return {
    name: admin?.name || teacher?.name || '', dept: admin?.dept || teacher?.dept || '',
    position: admin?.position || teacher?.position || '', region: teacher?.region || '', rosterDept: teacher?.dept || '',
  };
}

async function getAttendMeeting(body) {
  const m = await findMeeting(clip(body.meetingId, 40));
  if (!m) return { error: '출석 모임을 찾을 수 없어요. QR을 다시 확인해 주세요.' };
  const nid = normId(body.memberId);
  const [mineRows, person] = await Promise.all([
    run(db().from('attend_records').select('*').eq('meeting_id', m.meetingId).eq('nid', nid).order('id').limit(1)),
    personOf(body.memberId),
  ]);
  const p = person || {};
  const org = orgFromDept(p.rosterDept || p.dept);
  const district = districtFromRegion(org, p.region);
  return {
    meeting: toPublic(m),
    mine: mineRows[0] ? toRecord(mineRows[0]) : null,
    me: {
      dept: p.dept || '', region: p.region || '', position: p.position || '', org, district,
      label: meetLabel({ org, district: district === '' ? null : district }),
      late: m.date === kstDate() ? lateText(m, kstDateTime()) : '',
    },
  };
}

/** 모임에 부서가 정해져 있으면 그 부서(지역만 고름), 교역자 모임이면 고를 것 없음(null), 그 밖에는 직접 고름(''). */
const fixedPickOrg = (m) => (ORGS_WITH_DISTRICT.includes(m.org) ? m.org : (m.org === '교역자' ? null : ''));

/** 설문 답을 질문 정의에 맞게 다듬는다. 필수 항목이 비면 { error }. */
function readAnswers(questions, src) {
  const answers = {};
  for (const q of questions) {
    let v = src[q.id];
    if (q.type === 'multi') v = pickList(v, q.options, 20);
    else if (q.type === 'choice') v = q.options.includes(String(v)) ? String(v) : '';
    else v = clip(v, 500);
    if (q.required && (!v || (Array.isArray(v) && !v.length))) return { error: `"${q.label}" 항목에 답해 주세요.` };
    answers[q.id] = v;
  }
  return { answers };
}

/** 참석자가 고른 소속·지역·24부서. 잘못 골랐으면 { error }. */
function readPicks(m, body) {
  let pickOrg = '', pickDistrict = '', dept24 = '';
  const fixed = m.askDistrict ? fixedPickOrg(m) : null;
  if (m.askDistrict && fixed !== null) {
    const asked = String(body.pickOrg || '');
    if (fixed) pickOrg = fixed;
    else if (asked === '기타') {
      pickOrg = etc('기타', body.pickOrgEtc);
      if (!pickOrg) return { error: '소속 기타 칸에 직접 써 주세요.' };
    } else if (PICK_ORGS.includes(asked)) pickOrg = asked;
    if (pickOrg && ORGS_WITH_DISTRICT.includes(pickOrg)) {
      const typed = etc(body.pickDistrict, body.pickDistrictEtc);
      if (typed === '') return { error: '지역 기타 칸에 직접 써 주세요.' };
      pickDistrict = typed != null ? typed : cleanDistrict(pickOrg, body.pickDistrict);
      if (pickDistrict === '') {
        if (!fixed) return { error: '지역을 골라 주세요.' };
        pickOrg = '';   // 부서가 정해진 모임에서 지역을 안 고름 = 고르지 않은 것으로
      }
    }
  }
  if (m.askDept) {
    const typed = etc(body.dept24, body.dept24Etc);
    if (typed === '') return { error: '부서 기타 칸에 직접 써 주세요.' };
    dept24 = typed != null ? typed : (DEPT24.includes(String(body.dept24)) ? String(body.dept24) : '');
  }
  return { pickOrg, pickDistrict, dept24 };
}

async function submitAttendance(body) {
  const mid = clip(body.memberId, 40);
  if (!mid) return { error: '로그인 정보가 없습니다.' };
  const m = await findMeeting(clip(body.meetingId, 40));
  if (!m) return { error: '출석 모임을 찾을 수 없어요.' };
  const window = attendWindow(m);
  if (!window.open) return { error: window.reason };
  const nid = normId(mid);
  const existing = () => run(db().from('attend_records').select('*').eq('meeting_id', m.meetingId).eq('nid', nid).order('id').limit(1));
  const [already] = await existing();
  if (already) return { ok: true, already: true, record: toRecord(already) };

  const read = readAnswers(m.questions, body.answers || {});
  if (read.error) return read;
  const picks = readPicks(m, body);
  if (picks.error) return picks;
  const person = (await personOf(mid)) || {};
  // 고르지 않았으면 명단의 소속·지역을 넣는다.
  if (!picks.pickOrg) {
    picks.pickOrg = fixedPickOrg(m) || orgFromDept(person.rosterDept || person.dept);
    picks.pickDistrict = picks.pickOrg ? districtFromRegion(picks.pickOrg, person.region) : '';
  }

  const at = kstDateTime();
  const row = {
    record_id: newId('AT') + nid.slice(-4), meeting_id: m.meetingId, member_id: mid,
    name: person.name || clip(body.name, 40), dept: person.dept || '', position: person.position || '',
    answers: read.answers, at, method: body.method === 'scan' ? '앱스캔' : 'QR',
    pick_org: picks.pickOrg, pick_district: String(picks.pickDistrict), dept24: picks.dept24, late: lateText(m, at),
  };
  const { data, error } = await db().from('attend_records').insert(row).select();
  if (error) {
    // 같은 사람이 동시에 두 번 누른 경우: 먼저 들어간 기록을 돌려준다.
    const [first] = await existing();
    if (first) return { ok: true, already: true, record: toRecord(first) };
    return { retry: true, error: '접속이 몰려 순서대로 처리하고 있어요.' };
  }
  const record = toRecord(data[0]);
  try { await notifyAttendance(m, record); } catch { /* 알림 실패는 무시 */ }
  return { ok: true, record };
}

// ── 출석 알림 ── 1분에 8명까지는 한 명씩, 그보다 몰리면 20명씩 묶어서 보낸다.

const answerText = (v) => (Array.isArray(v) ? v.join(', ') : String(v == null ? '' : v).trim());

async function notifyAttendance(m, rec) {
  if (isTestMeeting(m)) return;
  const label = meetLabel(m);
  const where = m.title + (label ? ` [${label}]` : '');
  const minute = rec.at.slice(0, 16);
  const { count } = await db().from('attend_records').select('*', { count: 'exact', head: true })
    .eq('meeting_id', m.meetingId).gte('at', `${minute}:00`).lte('at', `${minute}:59`);

  if ((count || 0) <= 8) {
    const picked = pickText(rec);
    const survey = m.questions.length
      ? '\n\n📝 설문\n' + m.questions.map((q) => `• ${q.label}: ${answerText(rec.answers[q.id]) || '-'}`).join('\n')
      : '';
    await sendAttendText(`✅ 출석 완료\n👤 ${rec.name}${rec.dept ? ' · ' + rec.dept : ''}${rec.position ? ' · ' + rec.position : ''}\n` +
      `📋 ${where} (${m.date})\n🕐 ${rec.at}${rec.late ? ' · ' + rec.late : ''}` + (picked ? `\n📍 ${picked}` : '') + survey);
    return;
  }
  await run(db().from('attend_notify_queue').insert({ meeting_id: m.meetingId, label: rec.name + (rec.dept ? `(${rec.dept})` : '') }));
  const queued = await run(db().from('attend_notify_queue').select('id, label').eq('meeting_id', m.meetingId).order('id'));
  if (queued.length >= 20) {
    const taken = await run(db().from('attend_notify_queue').delete().in('id', queued.map((q) => q.id)).select('label'));
    if (taken.length) await sendAttendText(`✅ 출석 몰림 — ${where}\n${taken.length}명: ${taken.map((q) => q.label).join(', ')}`);
  }
}

// ── 내 출석 · 관리자 화면 ──

async function getMyAttendance(body) {
  const nid = normId(body.memberId);
  const today = kstDate();
  const [meetings, records] = await Promise.all([loadMeetings(), loadRecords((q) => q.eq('nid', nid))]);
  return { meetings: meetings.filter((m) => m.date <= today).map(toPublic), records };
}

/** 설문 질문 다듬기: 20개까지, 선택형은 보기가 있어야 한다. */
const cleanQuestions = (qs) => (Array.isArray(qs) ? qs : []).slice(0, 20).map((q, i) => {
  const type = QUESTION_TYPES.includes(String(q?.type)) ? String(q.type) : 'text';
  return {
    id: 'q' + (i + 1), label: clip(q?.label, 120), type,
    options: type === 'text' ? [] : pickList(q?.options, null, 20).map((o) => o.slice(0, 60)), required: !!q?.required,
  };
}).filter((q) => q.label && (q.type === 'text' || q.options.length));

const requireAdmin = async (body, message) => {
  const mid = clip(body.memberId, 40);
  return mid && (await isAdmin(mid)) ? null : { error: message };
};

async function saveAttendMeeting(body) {
  const denied = await requireAdmin(body, '모임은 관리자만 만들 수 있어요.');
  if (denied) return denied;
  const m = body.meeting || {};
  const title = clip(m.title, 80);
  const date = clip(m.date, 10);
  if (!title) return { error: '모임 이름을 입력해 주세요.' };
  if (!isDate(date)) return { error: '날짜를 선택해 주세요.' };
  const start = hhmm(m.start);
  const end = hhmm(m.end);
  if (start && end && end <= start) return { error: '끝나는 시간이 시작 시간보다 뒤여야 해요.' };
  const org = m.org && ORG_OPTIONS.includes(String(m.org)) ? String(m.org) : '';
  if (m.district != null && m.district !== '' && !org) return { error: '지역을 선택하려면 부서를 먼저 선택해 주세요.' };
  const now = kstDateTime();
  const fields = {
    title, date, start_time: start, end_time: end, place: clip(m.place, 80),
    open_before: Math.max(0, Math.min(600, Number(m.openBefore) || 0)), questions: cleanQuestions(m.questions),
    status: ['열림', '닫힘'].includes(String(m.status)) ? String(m.status) : '열림',
    org, district: String(cleanDistrict(org, m.district)), ask_district: !!m.askDistrict, ask_dept: !!m.askDept,
  };
  const meetingId = clip(m.meetingId, 40);
  if (meetingId) {
    if (!(await findMeeting(meetingId))) return { error: '모임을 찾을 수 없어요.' };
    await run(db().from('attend_meetings').update({ ...fields, updated_at: now }).eq('meeting_id', meetingId));
    return { ok: true, meetingId };
  }
  const fresh = newId('MT');
  await run(db().from('attend_meetings').insert({ meeting_id: fresh, ...fields, created_by: clip(body.memberId, 40), created_at: now }));
  return { ok: true, meetingId: fresh };
}

const setStatus = (meetingId, status) =>
  run(db().from('attend_meetings').update({ status, updated_at: kstDateTime() }).eq('meeting_id', meetingId));

async function deleteAttendMeeting(body) {
  const denied = await requireAdmin(body, '관리자만 지울 수 있어요.');
  if (denied) return denied;
  const m = await findMeeting(clip(body.meetingId, 40));
  if (!m) return { error: '모임을 찾을 수 없어요.' };
  await setStatus(m.meetingId, '삭제');
  return { ok: true };
}

/** 관리자 화면: 모임 목록(부서·지역으로 거름)과 그 출석 기록. */
async function getAttendAdmin(body) {
  const denied = await requireAdmin(body, '관리자만 볼 수 있어요.');
  if (denied) return denied;
  const org = clip(body.filterOrg, 20);
  const district = body.filterDistrict != null && body.filterDistrict !== '' ? String(body.filterDistrict) : null;
  const meetings = (await loadMeetings()).filter((m) => (!org || m.org === org)
    && (district == null || String(m.district == null ? '' : m.district) === district));
  const ids = meetings.map((m) => m.meetingId);
  const records = ids.length ? await loadRecords((q) => q.in('meeting_id', ids)) : [];
  const counts = new Map();
  for (const r of records) counts.set(r.meetingId, (counts.get(r.meetingId) || 0) + 1);
  return {
    meetings: meetings.map((m) => ({ ...toPublic(m), count: counts.get(m.meetingId) || 0, createdAt: m.createdAt })),
    records,
  };
}

async function getAttendCount(body) {
  const meetingId = clip(body.meetingId, 40);
  return { count: (await loadRecords((q) => q.eq('meeting_id', meetingId))).length };
}

async function deleteAttendRecord(body) {
  const denied = await requireAdmin(body, '관리자만 지울 수 있어요.');
  if (denied) return denied;
  await run(db().from('attend_records').delete().eq('record_id', clip(body.recordId, 40)));
  return { ok: true };
}

/** 저녁 시작 시각을 정하고(15시 이후 출석의 지각 기준), 그 모임의 지각 표시를 다시 계산한다. */
async function attSetEveningStart(body) {
  const denied = await requireAdmin(body, '관리자만 할 수 있어요.');
  if (denied) return denied;
  const m = await findMeeting(clip(body.meetingId, 40));
  if (!m) return { error: '모임을 찾을 수 없어요.' };
  m.start2 = hhmm(body.start2);
  await run(db().from('attend_meetings').update({ start2: m.start2 }).eq('meeting_id', m.meetingId));
  const rows = await selectAll(() => db().from('attend_records').select('id, at, late').eq('meeting_id', m.meetingId).order('id'));
  let recalculated = 0;
  for (const r of rows) {
    const late = lateText(m, fmtTs(r.at));
    if (r.late !== late) { await run(db().from('attend_records').update({ late }).eq('id', r.id)); recalculated++; }
  }
  return { ok: true, start2: m.start2, recalculated };
}

/** 부하 시험용 [TEST] 모임과 그 기록을 정리한다. */
async function attTestCleanup(body) {
  const denied = await requireAdmin(body, '관리자만 할 수 있어요.');
  if (denied) return denied;
  const m = await findMeeting(clip(body.meetingId, 40));
  if (!m) return { error: '모임을 찾을 수 없어요.' };
  if (!isTestMeeting(m)) return { error: '[TEST] 모임만 정리할 수 있어요.' };
  const removed = await run(db().from('attend_records').delete().eq('meeting_id', m.meetingId).select('id'));
  await setStatus(m.meetingId, '삭제');
  return { ok: true, removed: removed.length };
}

// ── 마감 서머리 ── 끝난 지 10분이 지난 모임(또는 관리자가 닫은 모임)을 집계해 방에 알리고 명단 파일을 보낸다.

/** 설문 결과: 선택형은 보기별 수, 글은 사람별 답. */
function surveySummary(questions, records) {
  if (!questions.length || !records.length) return '';
  const blocks = questions.map((q) => {
    if (q.type === 'text') {
      const rows = records.map((r) => { const a = answerText(r.answers[q.id]); return a ? `  - ${r.name}: ${a}` : ''; }).filter(Boolean);
      return `▪ ${q.label}` + (rows.length ? '\n' + rows.join('\n') : ' — (응답 없음)');
    }
    const counts = Object.fromEntries((q.options || []).map((o) => [o, 0]));
    let none = 0;
    for (const r of records) {
      const v = r.answers[q.id];
      const picked = Array.isArray(v) ? v : (v ? [String(v)] : []);
      if (!picked.length) none++;
      for (const x of picked) counts[x] = (counts[x] || 0) + 1;
    }
    const parts = Object.entries(counts).map(([o, n]) => `${o} ${n}`);
    if (none) parts.push('무응답 ' + none);
    return `▪ ${q.label}${q.type === 'multi' ? ' (복수 선택)' : ''} — ${parts.join(' · ')}`;
  });
  return '📝 설문 결과\n' + blocks.join('\n');
}

/** 참석자가 고른 지역별·부서별 수. */
function pickSummary(m, records) {
  const lines = [];
  const add = (on, title, keyOf) => {
    if (!on) return;
    const counts = new Map();
    for (const r of records) { const k = keyOf(r) || '미선택'; counts.set(k, (counts.get(k) || 0) + 1); }
    if (counts.size) lines.push(`${title} — ${[...counts].map(([k, n]) => `${k} ${n}`).join(' · ')}`);
  };
  add(m.askDistrict, '📍 지역별', (r) => meetLabel({ org: r.pickOrg, district: r.pickDistrict === '' ? null : r.pickDistrict }));
  add(m.askDept, '🏢 부서별', (r) => r.dept24);
  return lines.join('\n');
}

/** 주기 실행(5~10분마다): 마감할 때가 된 모임을 한 번씩 집계한다. */
async function attAutoSummary(body) {
  const cronKey = process.env.TEACHERSQUARE_CRON_KEY;
  if (!cronKey || String(body.key) !== cronKey) return { error: 'key' };
  const now = new Date();
  const today = kstDate();
  const closed = [];
  for (const m of await loadMeetings()) {
    if (!m.end || !m.date || m.status === '집계완료') continue;
    const [y, mo, d] = m.date.split('-').map(Number);
    const [h, min] = m.end.split(':').map(Number);
    const sinceClose = Math.round((now - new Date(y, mo - 1, d, h, min + 10)) / 60000);   // 끝나고 10분 뒤부터
    const manual = m.status === '닫힘' && sinceClose <= 24 * 60 && m.date <= today;
    if (!manual && (sinceClose < 0 || sinceClose > 360)) continue;
    await setStatus(m.meetingId, '집계완료');
    closed.push(m.meetingId);

    const records = await loadRecords((q) => q.eq('meeting_id', m.meetingId));
    const label = meetLabel(m);
    const test = isTestMeeting(m);
    let box = '';
    if (records.length && !test) { try { box = (await closingBoxText(m)) + '\n'; } catch (e) { console.log('박스 오류: ' + e); } }
    const picks = records.length ? pickSummary(m, records) : '';
    await sendAttendText(
      `📋 출석 마감 서머리\n📌 ${m.title}${label ? ` [${label}]` : ''} (${m.date})\n⏰ ${m.start} ~ ${m.end}${manual ? ' (관리자 마감)' : ''}\n` +
      `✅ 총 ${records.length}명 출석\n${box}${picks ? picks + '\n' : ''}` +
      (!records.length ? '\n(출석자 없음)' : (test ? '' : '\n📎 명단 파일은 바로 이어서 보냅니다.')) +
      (records.length && m.questions.length ? '\n\n' + surveySummary(m.questions, records) : ''));
    if (records.length && !test) {
      try { await sendClosing(m); } catch (e) { await sendAttendText('⚠️ 출석 명단 파일을 만들지 못했어요: ' + e); }
    }
  }
  return { ok: true, closed };
}

export default {
  getAttendMeeting, submitAttendance, getMyAttendance, saveAttendMeeting, deleteAttendMeeting,
  getAttendAdmin, getAttendCount, deleteAttendRecord, attSetEveningStart, attTestCleanup, attAutoSummary,
};
