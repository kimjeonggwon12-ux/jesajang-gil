// 공무 본인 신고(2026-11-16 사용자): "부서 재적 등록이 안 맞고 등록된 사람을 매번 바꿔 주기 어렵다 → 교역자·자문회·장년회·부녀회·청년회는
//   본인이 들어와 직접 올리게. 교광에 로그인되어 있으면 아무것도 안 하고 바로 눌러도 소속 등이 기록되게(우선)."
// - 신원 = 입장 표(api/index.js 의 _actorNid). 소속(부서·지역)은 교육 재적(edu_roster 목요사명자)에서 서버가 채운다.
// - 저장 = edu_excused_self(본인 신고 전용). 기존 '#excused'(관리자 전체 명단 교체)와 섞지 않아 관리자 저장에 지워지지 않는다.
//   집계(교육보고 탭)는 '#excused' ∪ 본인 신고(유효)를 공무로 센다. 실제 참석이 공무보다 우선.
// - EDU_MGMT_ENABLED=1 일 때만 동작. Telegram 발송 없음.
import { db, run } from '../lib/db.js';
import { kstDate, kstDateTime } from '../lib/util.js';

// 11/16(2차, 사용자): 화요전도단·목요 사명자 교육 둘 다 — 나의교실 '출석' 칸에서 교육·날짜를 골라 신고.
const KINDS = { 화전단: { title: '화요 전도단', days: [2] }, 목사교: { title: '목요 사명자 교육', days: null } }, ROSTER = '목요사명자';
// 11/16(3차, 사용자): 24부서 포함 목사교 재적(교자장부청 부구역장 이상 사명자) 전원에게 카드. 원장은 집계 제외라 카드도 안 보임.
const GROUP = { 교회교역: '교역자', 신학교역: '교역자', 협력교회: '교역자', 장로회: '장로·자문회', 자문회: '장로·자문회' };
const groupOf = (p) => (p.dept === '24부서' ? '24부서 ' + (p.affiliation || '') : GROUP[p.dept] || p.dept);
const excluded = (p) => String(p.position || '').trim() === '원장';
const on = () => process.env.EDU_MGMT_ENABLED === '1';
const fail = (m) => { throw new Error(m); };
const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const dayLabel = (d) => { const x = new Date(d + 'T00:00:00Z'); return `${x.getUTCMonth() + 1}/${x.getUTCDate()}(${WD[x.getUTCDay()]})`; };

/** 다가오는 교육 날짜 2개(오늘 포함). 화요전도단 = 화요일, 목요 사명자 교육 = 정기 교육 요일(없으면 목요일). */
async function nextDates(kind) {
  let days = KINDS[kind].days;
  if (!days) {
    const [s] = await run(db().from('attend_series').select('weekdays').eq('roster_key', ROSTER).neq('status', '삭제').limit(1)).catch(() => []);
    days = Array.isArray(s?.weekdays) && s.weekdays.length ? s.weekdays.map(Number) : [4];
  }
  const out = [];
  for (let i = 0, d = kstDate(); i < 21 && out.length < 2; i++) { const x = addDays(d, i); if (days.includes(new Date(x + 'T00:00:00Z').getUTCDay())) out.push(x); }
  return out;
}

// 11/17(사용자): "교육 시간이 지나간 교육은 '종료', 다음날이 되면 그 다음 회차가 뜨게".
//   끝 시각 = 그날 그 교육 출석 모임의 마지막 타임 끝(화전단 = 제목 '화요전도단', 목사교 = 목요사명자 정기 교육). 모임이 없으면 정기 교육 타임 끝, 그것도 없으면 22:00.
//   지난 교육은 신고·취소를 막는다. 다가오는 2회차(오늘 포함)는 그대로라, 다음날이 되면 오늘 것이 빠지고 다음 회차가 뜬다.
const hm = (t) => String(t || '').slice(0, 5);
const lastEnd = (rows) => rows.flatMap((r) => [hm(r.end_time), ...(Array.isArray(r.slots) ? r.slots : []).map((x) => hm(x && x.end))]).filter((t) => /^\d\d:\d\d$/.test(t)).sort().pop() || '';
async function endTimeOf(kind, date) {
  const ms = (await run(db().from('attend_meetings').select('title, end_time, slots, series_id').eq('date', date).neq('status', '삭제')).catch(() => [])).filter((m) => !String(m.title || '').startsWith('[TEST]'));
  if (kind === '화전단') return lastEnd(ms.filter((m) => /화요전도단|화전단/.test(m.title || ''))) || '22:00';
  const ss = await run(db().from('attend_series').select('series_id, slots').eq('roster_key', ROSTER).neq('status', '삭제')).catch(() => []);
  const ids = new Set(ss.map((x) => x.series_id));
  return lastEnd(ms.filter((m) => ids.has(m.series_id))) || lastEnd(ss.map((x) => ({ slots: x.slots }))) || '22:00';
}
async function isEnded(kind, date) {
  const now = kstDateTime(), today = now.slice(0, 10);
  if (date < today) return true;
  if (date > today) return false;
  return now.slice(11, 16) >= await endTimeOf(kind, date);
}

// 11/17(사용자 "어떤 사람은 되고 어떤 사람은 안 된다"): 목사교 재적(부구역장 이상 1,203명)에 없는 교사(예: 장년회 13지역 김성재)는
//   '재적에 없어요'만 보고 버튼이 없었다 → 화요 전도단은 교사 전체가 오므로, 재적 밖이라도 교사·관리자 명단에 있으면 화요 전도단은 신고 가능.
//   (목요 사명자 교육은 재적 기준 집계라 재적에 있는 분만)
async function me(body) {
  const nid = String(body?._actorNid || '');
  if (!nid) fail('로그인이 필요해요.');
  const [p] = await run(db().from('edu_roster').select('nid, name, dept, region, district, affiliation, position').eq('roster_key', ROSTER).eq('nid', nid).limit(1));
  if (p) return { nid, p: excluded(p) ? null : p, outside: excluded(p), kinds: Object.keys(KINDS) };
  const [t] = await run(db().from('teachers').select('nid, name, dept, region, affiliation, position').eq('nid', nid).limit(1));
  const [a] = t ? [] : await run(db().from('admins').select('nid, name, dept, position').eq('nid', nid).limit(1));
  const q = t || a;
  return { nid, p: q ? { ...q, region: q.region || '', affiliation: q.affiliation || '', outsideRoster: true } : null, outside: false, kinds: q ? ['화전단'] : [] };
}
const view = (r) => r && { kind: r.kind, date: r.date, label: dayLabel(r.date), reason: r.reason, active: r.active, dept: r.dept, region: r.region, at: r.updated_at };

/** 첫 화면 카드: 신고 대상인지, 다가오는 날짜, 내 신고 상태. 대상이 아니면 eligible:false(카드 안 보임). */
export async function getMyExcused(body = {}) {
  if (!on()) return { enabled: false };
  const m = await me(body);
  if (!m.p) return { enabled: true, eligible: false, reason: m.outside ? '원장님은 출석 집계 대상이 아니에요.' : '목요 사명자 교육 재적에 없어요.' };
  const kinds = [];
  for (const kind of m.kinds) {
    const dates = await nextDates(kind);
    const rows = await run(db().from('edu_excused_self').select('*').eq('kind', kind).eq('nid', m.nid).in('date', dates));
    const ended = await Promise.all(dates.map((d) => isEnded(kind, d)));
    kinds.push({ kind, title: KINDS[kind].title, dates: dates.map((d, i) => ({ date: d, label: dayLabel(d), ended: ended[i], mine: view(rows.find((r) => r.date === d && r.active)) })) });
  }
  return { enabled: true, eligible: true, title: '화요 전도단 · 목요 사명자 교육 공무로 인한 결석자 보고', group: groupOf(m.p), dept: m.p.dept, region: m.p.dept === '24부서' ? '' : (m.p.region || ''),
    name: m.p.name, kinds, note: m.p.outsideRoster ? '목요 사명자 교육은 사명자 재적(부구역장 이상)에 있는 분만 신고해요.' : '' };
}

/** 공무 신고(바로 누르기: 사유 없으면 '공무'). 같은 날 다시 누르면 사유만 고친다. */
// 11/17(사용자): 공무 항목 = 총회업무·지파업무·부서업무·센터관련·전도활동·성도관리·기타(사유 직접 입력) — 화전단·목사교 둘 다.
//   저장 값 = 항목 이름 그대로, 기타는 '기타: <사유>'. 앱 window.exR 과 같은 목록.
export const EX_REASON_CATS = ['총회업무', '지파업무', '부서업무', '센터관련', '전도활동', '성도관리'];
export const validReason = (v) => { const s = String(v || '').trim(); return EX_REASON_CATS.includes(s) || /^기타: \S/.test(s); };
export const reasonProblem = (v) => (/^기타/.test(String(v || '').trim()) ? "'기타'를 골랐으면 사유를 직접 적어 주세요." : `공무 항목(${EX_REASON_CATS.join('·')}·기타)을 골라 주세요.`);
export async function submitMyExcused(body = {}) {
  if (!on()) fail('교육보고 기능이 아직 꺼져 있어요.');
  const m = await me(body);
  if (!m.p) fail(m.outside ? '원장님은 출석 집계 대상이 아니에요.' : '목요 사명자 교육 재적에 없어요. 담당자에게 알려 주세요.');
  const kind = String(body.kind || '목사교'), date = String(body.date || ''), reason = String(body.reason || '').trim();
  // 11/17(사용자): 공무 항목은 정해진 것만(드롭다운), 기타는 사유 직접 입력
  if (!validReason(reason)) fail(reasonProblem(reason));
  if (!KINDS[kind]) fail('교육을 골라 주세요.');
  if (!m.kinds.includes(kind)) fail('목요 사명자 교육은 사명자 재적에 있는 분만 신고할 수 있어요.');
  if (!validDate(date) || !(await nextDates(kind)).includes(date)) fail('다가오는 교육 날짜만 신고할 수 있어요.');
  if (await isEnded(kind, date)) fail('이미 끝난(종료된) 교육이에요. 다음 회차를 골라 주세요.');
  if (reason.length > 200) fail('사유는 200자 이내로 적어 주세요.');
  const row = { kind, date, nid: m.nid, name: m.p.name, dept: m.p.dept, region: m.p.dept === '24부서' ? (m.p.affiliation || '') : (m.p.region || ''), reason, active: true, registered_by: '', canceled_by: '', updated_at: new Date().toISOString() };
  await run(db().from('edu_excused_self').upsert(row, { onConflict: 'kind,date,nid' }));
  return { ok: true, label: KINDS[kind].title + ' ' + dayLabel(date), dept: m.p.dept, region: m.p.region || '' };
}

export async function cancelMyExcused(body = {}) {
  if (!on()) fail('교육보고 기능이 아직 꺼져 있어요.');
  const m = await me(body), kind = String(body.kind || '목사교'), date = String(body.date || '');
  if (!KINDS[kind] || !validDate(date)) fail('교육과 날짜를 확인해 주세요.');
  if (await isEnded(kind, date)) fail('이미 끝난(종료된) 교육이라 취소할 수 없어요.');
  await run(db().from('edu_excused_self').update({ active: false, canceled_by: '본인', updated_at: new Date().toISOString() }).eq('kind', kind).eq('date', date).eq('nid', m.nid));
  return { ok: true };
}

/** 집계용: 그 날 본인 신고(유효) — nid → 사유 */
export async function selfExcusedOf(kind, date) {
  const rows = await run(db().from('edu_excused_self').select('nid, reason').eq('kind', kind).eq('date', date).eq('active', true)).catch(() => []);
  return new Map(rows.map((r) => [r.nid, r.reason]));
}

export default { getMyExcused, submitMyExcused, cancelMyExcused };
