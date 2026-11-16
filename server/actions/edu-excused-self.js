// 공무 본인 신고(2026-11-16 사용자): "부서 재적 등록이 안 맞고 등록된 사람을 매번 바꿔 주기 어렵다 → 교역자·자문회·장년회·부녀회·청년회는
//   본인이 들어와 직접 올리게. 교광에 로그인되어 있으면 아무것도 안 하고 바로 눌러도 소속 등이 기록되게(우선)."
// - 신원 = 입장 표(api/index.js 의 _actorNid). 소속(부서·지역)은 교육 재적(edu_roster 목요사명자)에서 서버가 채운다.
// - 저장 = edu_excused_self(본인 신고 전용). 기존 '#excused'(관리자 전체 명단 교체)와 섞지 않아 관리자 저장에 지워지지 않는다.
//   집계(교육보고 탭)는 '#excused' ∪ 본인 신고(유효)를 공무로 센다. 실제 참석이 공무보다 우선.
// - EDU_MGMT_ENABLED=1 일 때만 동작. Telegram 발송 없음.
import { db, run } from '../lib/db.js';
import { kstDate } from '../lib/util.js';

const KIND = '목사교', ROSTER = '목요사명자';
export const SELF_DEPTS = ['교회교역', '신학교역', '협력교회', '장로회', '자문회', '장년회', '부녀회', '청년회'];
const GROUP = { 교회교역: '교역자', 신학교역: '교역자', 협력교회: '교역자', 장로회: '자문회', 자문회: '자문회', 장년회: '장년회', 부녀회: '부녀회', 청년회: '청년회' };
const on = () => process.env.EDU_MGMT_ENABLED === '1';
const fail = (m) => { throw new Error(m); };
const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const dayLabel = (d) => { const x = new Date(d + 'T00:00:00Z'); return `${x.getUTCMonth() + 1}/${x.getUTCDate()}(${WD[x.getUTCDay()]})`; };

/** 다가오는 교육 날짜 2개(오늘 포함) — 정기 교육 요일 기준, 없으면 목요일. */
async function nextDates() {
  const [s] = await run(db().from('attend_series').select('weekdays').eq('roster_key', ROSTER).neq('status', '삭제').limit(1)).catch(() => []);
  const days = Array.isArray(s?.weekdays) && s.weekdays.length ? s.weekdays.map(Number) : [4];
  const out = [];
  for (let i = 0, d = kstDate(); i < 21 && out.length < 2; i++) { const x = addDays(d, i); if (days.includes(new Date(x + 'T00:00:00Z').getUTCDay())) out.push(x); }
  return out;
}

async function me(body) {
  const nid = String(body?._actorNid || '');
  if (!nid) fail('로그인이 필요해요.');
  const [p] = await run(db().from('edu_roster').select('nid, name, dept, region, district, affiliation').eq('roster_key', ROSTER).eq('nid', nid).limit(1));
  return { nid, p: p && SELF_DEPTS.includes(p.dept) ? p : null, outside: !!p && !SELF_DEPTS.includes(p.dept) };
}
const view = (r) => r && { kind: r.kind, date: r.date, label: dayLabel(r.date), reason: r.reason, active: r.active, dept: r.dept, region: r.region, at: r.updated_at };

/** 첫 화면 카드: 신고 대상인지, 다가오는 날짜, 내 신고 상태. 대상이 아니면 eligible:false(카드 안 보임). */
export async function getMyExcused(body = {}) {
  if (!on()) return { enabled: false };
  const m = await me(body);
  if (!m.p) return { enabled: true, eligible: false, reason: m.outside ? '24부서는 부서 공무 보고로 올려요.' : '목요 사명자 교육 재적에 없어요.' };
  const dates = await nextDates();
  const rows = await run(db().from('edu_excused_self').select('*').eq('kind', KIND).eq('nid', m.nid).in('date', dates));
  return { enabled: true, eligible: true, kind: KIND, title: '목요 사명자 교육', group: GROUP[m.p.dept], dept: m.p.dept, region: m.p.region || '',
    name: m.p.name, dates: dates.map((d) => ({ date: d, label: dayLabel(d), mine: view(rows.find((r) => r.date === d && r.active)) })) };
}

/** 공무 신고(바로 누르기: 사유 없으면 '공무'). 같은 날 다시 누르면 사유만 고친다. */
export async function submitMyExcused(body = {}) {
  if (!on()) fail('교육보고 기능이 아직 꺼져 있어요.');
  const m = await me(body);
  if (!m.p) fail(m.outside ? '24부서는 부서 공무 보고로 올려요.' : '목요 사명자 교육 재적에 없어요. 담당자에게 알려 주세요.');
  const date = String(body.date || ''), reason = String(body.reason || '').trim() || '공무';
  if (!validDate(date) || !(await nextDates()).includes(date)) fail('다가오는 교육 날짜만 신고할 수 있어요.');
  if (reason.length > 200) fail('사유는 200자 이내로 적어 주세요.');
  const row = { kind: KIND, date, nid: m.nid, name: m.p.name, dept: m.p.dept, region: m.p.region || '', reason, active: true, updated_at: new Date().toISOString() };
  await run(db().from('edu_excused_self').upsert(row, { onConflict: 'kind,date,nid' }));
  return { ok: true, label: dayLabel(date), dept: m.p.dept, region: m.p.region || '' };
}

export async function cancelMyExcused(body = {}) {
  if (!on()) fail('교육보고 기능이 아직 꺼져 있어요.');
  const m = await me(body), date = String(body.date || '');
  if (!validDate(date)) fail('날짜를 확인해 주세요.');
  await run(db().from('edu_excused_self').update({ active: false, updated_at: new Date().toISOString() }).eq('kind', KIND).eq('date', date).eq('nid', m.nid));
  return { ok: true };
}

/** 집계용: 그 날 본인 신고(유효) — nid → 사유 */
export async function selfExcusedOf(kind, date) {
  const rows = await run(db().from('edu_excused_self').select('nid, reason').eq('kind', kind).eq('date', date).eq('active', true)).catch(() => []);
  return new Map(rows.map((r) => [r.nid, r.reason]));
}

export default { getMyExcused, submitMyExcused, cancelMyExcused };
