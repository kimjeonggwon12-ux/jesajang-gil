// 교육 과정(교육생 반) — 출석 쪽에서도 쓰는 가벼운 도구(attendance.js ↔ cohorts.js 가 서로 부르지 않게 여기에 둔다)
import { db, run } from './db.js';
import { normId, kstDate } from './util.js';
import { sendAttendText } from './attend-bot.js';

const nameKey = (s) => String(s == null ? '' : s).replace(/\s/g, '');
export const WEEK = '월화수목금토일';

export const toCohort = (r) => ({
  cohortId: r.cohort_id, title: r.title, status: r.status, useAttend: r.use_attend, useAssign: r.use_assign,
  tgChat: r.tg_chat, createdAt: r.created_at ? String(r.created_at).replace('T', ' ').slice(0, 16) : '',
  startDate: r.start_date || '', endDate: r.end_date || '', days: r.days || '', startTime: r.start_time || '', endTime: r.end_time || '',
});

/** 'yyyy-MM-dd' → '월'…'일' */
export const weekdayOf = (date) => '일월화수목금토'[new Date(date + 'T00:00:00Z').getUTCDay()];

/** 그날이 교육 날인가(기간 안 + 교육 요일; 요일을 안 정했으면 매일). */
export function isClassDay(c, date) {
  if (c.startDate && date < c.startDate) return false;
  if (c.endDate && date > c.endDate) return false;
  return !c.days || c.days.includes(weekdayOf(date));
}

/** 과제가 그날 낼 과제인가: 매일 / 정한 요일 / 한번(열려 있는 동안). */
export function assignmentOn(a, date) {
  if (a.repeat === '매일') return true;
  if (a.repeat === '요일') return String(a.days || '').includes(weekdayOf(date));
  return true;
}

/** 과제 제출이 늦었나. 반복 과제는 그날 마감 시각(비면 자정), 한번 과제는 기한 날짜(+마감 시각). */
export function isLate(a, nowDateTime) {
  const day = nowDateTime.slice(0, 10), hm = nowDateTime.slice(11, 16);
  if (a.repeat === '매일' || a.repeat === '요일') return !!a.due_time && hm > a.due_time;
  if (!a.due) return false;
  return day > a.due || (day === a.due && !!a.due_time && hm > a.due_time);
}

export async function findCohort(cohortId) {
  if (!cohortId) return null;
  const [row] = await run(db().from('cohorts').select('*').eq('cohort_id', cohortId).neq('status', '삭제').limit(1));
  return row ? toCohort(row) : null;
}

/**
 * 교육 과정 고정 QR(#attend=CH…) → 오늘 그 과정의 출석 모임 번호. 과정 번호가 아니면 그대로.
 * 오늘 모임이 여러 개면 아직 안 끝난 첫 모임, 다 끝났으면 마지막 모임.
 */
const resolveCache = new Map();   // cohortId → { at, value }
export async function resolveCohortMeeting(id) {
  if (!/^CH\d/.test(String(id || ''))) return { meetingId: id };
  const hit = resolveCache.get(id);
  if (hit && Date.now() - hit.at < 10_000) return hit.value;
  const today = kstDate();
  const rows = await run(db().from('attend_meetings').select('meeting_id, end_time').eq('cohort_id', id).eq('date', today).neq('status', '삭제').order('start_time'));
  const hm = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }).format(new Date());
  const pick = rows.find((r) => !r.end_time || String(r.end_time).slice(0, 5) >= hm) || rows.at(-1);
  const value = pick ? { meetingId: pick.meeting_id } : { meetingId: '', error: '오늘은 이 교육의 출석 일정이 없어요.' };
  resolveCache.set(id, { at: Date.now(), value });
  return value;
}

/** 교육생 한 명(과정 안). 이름을 주면 이름도 맞아야 한다. */
export async function cohortMember(cohortId, memberId, name) {
  const nid = normId(memberId);
  if (!cohortId || nid === '0') return null;
  const [row] = await run(db().from('cohort_members').select('*').eq('cohort_id', cohortId).eq('nid', nid).limit(1));
  if (!row) return null;
  if (name != null && nameKey(name) && nameKey(row.name) && nameKey(name) !== nameKey(row.name)) return null;
  return { memberId: row.member_id, name: row.name, church: row.church };
}

/** 과정에 연결된 출석 모임에서 출석했을 때 — 과정 방으로 "n/전체명" 알림. */
export async function notifyCohortAttendance(m, rec) {
  const c = await findCohort(m.cohortId);
  if (!c) return;
  const [{ count: total }, { count: done }, member] = await Promise.all([
    db().from('cohort_members').select('*', { count: 'exact', head: true }).eq('cohort_id', c.cohortId),
    db().from('attend_records').select('*', { count: 'exact', head: true }).eq('meeting_id', m.meetingId).neq('record_id', ''),
    cohortMember(c.cohortId, rec.memberId),
  ]);
  const who = rec.name + (member?.church ? ` · ${member.church}` : rec.dept ? ` · ${rec.dept}` : '');
  await sendAttendText(
    `✅ [${c.title}] 출석 ${done || 0}/${total || 0}명\n👤 ${who}${member ? '' : ' (교육생 명단 밖)'}\n📋 ${m.title}\n🕐 ${rec.at}${rec.late ? ' · ' + rec.late : ''}`,
    c.tgChat,
  );
}
