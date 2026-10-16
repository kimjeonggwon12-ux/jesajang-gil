// 교육 과정(교육생 반) — 출석 쪽에서도 쓰는 가벼운 도구(attendance.js ↔ cohorts.js 가 서로 부르지 않게 여기에 둔다)
import { db, run } from './db.js';
import { normId } from './util.js';
import { sendAttendText } from './attend-bot.js';

const nameKey = (s) => String(s == null ? '' : s).replace(/\s/g, '');

export const toCohort = (r) => ({
  cohortId: r.cohort_id, title: r.title, status: r.status, useAttend: r.use_attend, useAssign: r.use_assign,
  tgChat: r.tg_chat, createdAt: r.created_at ? String(r.created_at).replace('T', ' ').slice(0, 16) : '',
});

export async function findCohort(cohortId) {
  if (!cohortId) return null;
  const [row] = await run(db().from('cohorts').select('*').eq('cohort_id', cohortId).neq('status', '삭제').limit(1));
  return row ? toCohort(row) : null;
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
