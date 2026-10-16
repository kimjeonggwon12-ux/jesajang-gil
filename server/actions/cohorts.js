// 교육 과정(교육생 반): 앱 관리자(7777 = 김정권 계정)만 만들고 교육생을 넣는다.
// 과정마다 출석(기존 QR 출석 모임을 연결)·과제 제출을 켜고 끄며, 알림·집계는 과정의 텔레그램 방으로 보낸다.
import { db, run, isDuplicate } from '../lib/db.js';
import { normId, kstDate, kstDateTime, fmtTs } from '../lib/util.js';
import { clip, newId, isDate } from '../lib/input.js';
import { runLater } from '../lib/background.js';
import { sendAttendText, recentAttendChats } from '../lib/attend-bot.js';
import { toCohort, findCohort, cohortMember } from '../lib/cohort.js';
import { isOwner, memberInfo } from './roster.js';
import { loadRecords } from './attendance.js';

const DENIED = { error: '교육 과정은 앱 관리자(7777)만 관리할 수 있어요.' };
const owner = (body) => isOwner(clip(body.memberId, 40));

const toMember = (r) => ({ memberId: r.member_id, name: r.name, church: r.church, addedAt: fmtTs(r.added_at) });
const toAssignment = (r) => ({ assignmentId: r.assignment_id, cohortId: r.cohort_id, title: r.title, guide: r.guide, due: r.due, status: r.status });
const toSubmission = (r) => ({ assignmentId: r.assignment_id, memberId: r.member_id, name: r.name, content: r.content, at: fmtTs(r.updated_at || r.submitted_at) });
const toMeetingRow = (r) => ({ meetingId: r.meeting_id, title: r.title, date: r.date, start: String(r.start_time || '').slice(0, 5), status: r.status });

const logChange = (body, kind, target, after) => run(db().from('roster_changes').insert({
  changed_at: kstDateTime(), actor_id: clip(body.memberId, 40), actor_name: clip(body.name, 40) || '관리자', kind,
  target_id: target.memberId, target_name: target.name, before: null, after,
}));

// ── 과정 ──

async function cohortList(body) {
  if (!owner(body)) return DENIED;
  const rows = await run(db().from('cohorts').select('*').neq('status', '삭제').order('id', { ascending: false }));
  const ids = rows.map((r) => r.cohort_id);
  const members = ids.length ? await run(db().from('cohort_members').select('cohort_id').in('cohort_id', ids)) : [];
  const count = {};
  for (const m of members) count[m.cohort_id] = (count[m.cohort_id] || 0) + 1;
  return { cohorts: rows.map((r) => ({ ...toCohort(r), memberCount: count[r.cohort_id] || 0 })) };
}

async function cohortSave(body) {
  if (!owner(body)) return DENIED;
  const c = body.cohort || {};
  const title = clip(c.title, 60);
  if (!title) return { error: '교육명칭을 넣어 주세요.' };
  const tgChat = clip(c.tgChat, 30);
  if (tgChat && !/^-?\d+$/.test(tgChat)) return { error: '텔레그램 방 번호는 숫자(예: -1001234567890)예요.' };
  const fields = {
    title, use_attend: c.useAttend !== false, use_assign: !!c.useAssign, tg_chat: tgChat,
    status: ['진행', '종료', '삭제'].includes(String(c.status)) ? String(c.status) : '진행', updated_at: kstDateTime(),
  };
  const id = clip(c.cohortId, 40);
  if (id) {
    if (!(await findCohort(id))) return { error: '교육 과정을 찾을 수 없어요.' };
    await run(db().from('cohorts').update(fields).eq('cohort_id', id));
    return { ok: true, cohortId: id };
  }
  const dup = await run(db().from('cohorts').select('cohort_id').eq('title', title).neq('status', '삭제').limit(1));
  if (dup.length) return { error: `같은 이름의 교육 과정이 이미 있어요: ${title}`, cohortId: dup[0].cohort_id };
  const cohortId = newId('CH');
  await run(db().from('cohorts').insert({ cohort_id: cohortId, ...fields, created_by: clip(body.memberId, 40), created_at: kstDateTime() }));
  return { ok: true, cohortId };
}

/** 과정 한 개의 모든 것: 교육생, 연결된 출석 모임과 출석, 과제와 제출 수. */
async function loadDetail(c) {
  const [members, assignments, meetings, subs] = await Promise.all([
    run(db().from('cohort_members').select('*').eq('cohort_id', c.cohortId).order('church').order('name')),
    run(db().from('cohort_assignments').select('*').eq('cohort_id', c.cohortId).neq('status', '삭제').order('id')),
    run(db().from('attend_meetings').select('*').eq('cohort_id', c.cohortId).neq('status', '삭제').order('date').order('start_time')),
    run(db().from('cohort_submissions').select('assignment_id, nid').eq('cohort_id', c.cohortId)),
  ]);
  const ids = meetings.map((m) => m.meeting_id);
  const records = ids.length ? await loadRecords((q) => q.in('meeting_id', ids)) : [];
  const nids = new Set(members.map((m) => m.nid));
  const attended = {};   // nid → 출석한 모임 수
  const perMeeting = {}; // meetingId → 교육생 출석 수
  for (const r of records) {
    const n = normId(r.memberId);
    if (!nids.has(n)) continue;
    attended[n] = (attended[n] || 0) + 1;
    perMeeting[r.meetingId] = (perMeeting[r.meetingId] || 0) + 1;
  }
  const submitted = {};  // nid → 낸 과제 수
  const perAssign = {};  // assignmentId → 낸 사람 수
  for (const s of subs) {
    if (!nids.has(s.nid)) continue;
    submitted[s.nid] = (submitted[s.nid] || 0) + 1;
    perAssign[s.assignment_id] = (perAssign[s.assignment_id] || 0) + 1;
  }
  return {
    cohort: c,
    members: members.map((m) => ({ ...toMember(m), attended: attended[m.nid] || 0, submitted: submitted[m.nid] || 0 })),
    meetings: meetings.map((m) => ({ ...toMeetingRow(m), count: perMeeting[m.meeting_id] || 0 })),
    assignments: assignments.map((a) => ({ ...toAssignment(a), count: perAssign[a.assignment_id] || 0 })),
  };
}

async function cohortDetail(body) {
  if (!owner(body)) return DENIED;
  const c = await findCohort(clip(body.cohortId, 40));
  if (!c) return { error: '교육 과정을 찾을 수 없어요.' };
  // 연결할 수 있는 최근 출석 모임(다른 과정에 안 묶인 것)
  const free = await run(db().from('attend_meetings').select('*').eq('cohort_id', '').neq('status', '삭제').order('id', { ascending: false }).limit(20));
  return { ...(await loadDetail(c)), freeMeetings: free.map(toMeetingRow) };
}

// ── 교육생 ──

/** 교육생 넣기: [{ church, name, memberId }] — 여러 명을 한 번에(붙여 넣기). 변경 기록에 '교육생 추가'로 남는다. */
async function cohortAddMembers(body) {
  if (!owner(body)) return DENIED;
  const c = await findCohort(clip(body.cohortId, 40));
  if (!c) return { error: '교육 과정을 먼저 고르거나 만들어 주세요.' };
  const list = (Array.isArray(body.members) ? body.members : []).slice(0, 500);
  const added = [], skipped = [];
  for (const raw of list) {
    const p = { church: clip(raw?.church, 40), name: clip(raw?.name, 30), memberId: clip(raw?.memberId, 40) };
    if (!p.name || p.memberId.replace(/\D/g, '').length < 5) { skipped.push({ ...p, why: '이름·고유번호 확인' }); continue; }
    if (!p.church) {
      const { teacher } = await memberInfo(p.memberId);   // 교회를 비우면 명단의 부서·지역으로
      p.church = teacher ? [teacher.dept, teacher.region].filter(Boolean).join(' ') : '';
    }
    const { error } = await db().from('cohort_members').insert({
      cohort_id: c.cohortId, member_id: p.memberId, name: p.name, church: p.church, added_by: clip(body.memberId, 40), added_at: kstDateTime(),
    });
    if (error) { skipped.push({ ...p, why: isDuplicate(error) ? '이미 등록됨' : error.message }); continue; }
    added.push(p);
    await logChange(body, '교육생 추가', p, { 교육: c.title, 교회: p.church });
  }
  if (added.length) {
    runLater(sendAttendText(`🎓 [${c.title}] 교육생 ${added.length}명 등록\n${added.map((p) => `• ${p.name}${p.church ? ' (' + p.church + ')' : ''}`).join('\n')}`, c.tgChat));
  }
  return { ok: true, added: added.length, skipped };
}

async function cohortRemoveMember(body) {
  if (!owner(body)) return DENIED;
  const c = await findCohort(clip(body.cohortId, 40));
  if (!c) return { error: '교육 과정을 찾을 수 없어요.' };
  const nid = normId(body.targetId);
  const gone = await run(db().from('cohort_members').delete().eq('cohort_id', c.cohortId).eq('nid', nid).select());
  if (!gone.length) return { error: '그 교육생을 찾을 수 없어요.' };
  await logChange(body, '교육생 빼기', toMember(gone[0]), { 교육: c.title });
  return { ok: true };
}

// ── 출석 모임 연결 ──

async function cohortLinkMeeting(body) {
  if (!owner(body)) return DENIED;
  const c = await findCohort(clip(body.cohortId, 40));
  if (!c) return { error: '교육 과정을 찾을 수 없어요.' };
  const meetingId = clip(body.meetingId, 40);
  const [m] = await run(db().from('attend_meetings').select('meeting_id, cohort_id').eq('meeting_id', meetingId).neq('status', '삭제').limit(1));
  if (!m) return { error: '출석 모임을 찾을 수 없어요.' };
  if (body.on && m.cohort_id && m.cohort_id !== c.cohortId) return { error: '다른 교육 과정에 연결된 모임이에요.' };
  await run(db().from('attend_meetings').update({ cohort_id: body.on ? c.cohortId : '', updated_at: kstDateTime() }).eq('meeting_id', meetingId));
  return { ok: true };
}

/** 과정 전용 출석 모임을 바로 만든다(QR·설문은 관리자 탭 '출석'에서 그대로). */
async function cohortCreateMeeting(body) {
  if (!owner(body)) return DENIED;
  const c = await findCohort(clip(body.cohortId, 40));
  if (!c) return { error: '교육 과정을 찾을 수 없어요.' };
  const m = body.meeting || {};
  const date = clip(m.date, 10);
  const hm = (v) => (/^\d{1,2}:\d{2}$/.test(clip(v, 5)) ? clip(v, 5).padStart(5, '0') : '');
  const start = hm(m.start), end = hm(m.end);
  if (!isDate(date)) return { error: '날짜를 골라 주세요.' };
  if (!start || !end || end <= start) return { error: '시작·끝 시간을 넣어 주세요(끝이 시작보다 뒤).' };
  const meetingId = newId('MT');
  await run(db().from('attend_meetings').insert({
    meeting_id: meetingId, title: clip(m.title, 80) || `${c.title} ${date.slice(5).replace('-', '/')}`, date, start_time: start, end_time: end,
    place: clip(m.place, 80), open_before: 30, questions: [], status: '열림', org: '전체', district: '',
    created_by: clip(body.memberId, 40), created_at: kstDateTime(), cohort_id: c.cohortId,
  }));
  return { ok: true, meetingId };
}

// ── 과제 ──

async function cohortSaveAssignment(body) {
  if (!owner(body)) return DENIED;
  const c = await findCohort(clip(body.cohortId, 40));
  if (!c) return { error: '교육 과정을 찾을 수 없어요.' };
  const a = body.assignment || {};
  const title = clip(a.title, 80);
  if (!title) return { error: '과제 이름을 넣어 주세요.' };
  const due = clip(a.due, 10);
  if (due && !isDate(due)) return { error: '기한 날짜를 다시 골라 주세요.' };
  const fields = { title, guide: clip(a.guide, 1000), due, status: ['열림', '닫힘', '삭제'].includes(String(a.status)) ? String(a.status) : '열림' };
  const id = clip(a.assignmentId, 40);
  if (id) {
    await run(db().from('cohort_assignments').update(fields).eq('assignment_id', id).eq('cohort_id', c.cohortId));
    return { ok: true, assignmentId: id };
  }
  const assignmentId = newId('AS');
  await run(db().from('cohort_assignments').insert({ assignment_id: assignmentId, cohort_id: c.cohortId, ...fields, created_at: kstDateTime() }));
  if (c.useAssign) runLater(sendAttendText(`📌 [${c.title}] 새 과제: ${title}${due ? `\n⏰ 기한 ${due}` : ''}${fields.guide ? '\n' + fields.guide : ''}`, c.tgChat));
  return { ok: true, assignmentId };
}

async function cohortSubmissions(body) {
  if (!owner(body)) return DENIED;
  const id = clip(body.assignmentId, 40);
  const [a] = await run(db().from('cohort_assignments').select('*').eq('assignment_id', id).limit(1));
  if (!a) return { error: '과제를 찾을 수 없어요.' };
  const [subs, members] = await Promise.all([
    run(db().from('cohort_submissions').select('*').eq('assignment_id', id).order('id')),
    run(db().from('cohort_members').select('*').eq('cohort_id', a.cohort_id).order('church').order('name')),
  ]);
  const done = new Set(subs.map((s) => s.nid));
  return { assignment: toAssignment(a), submissions: subs.map(toSubmission), missing: members.filter((m) => !done.has(m.nid)).map(toMember) };
}

// ── 텔레그램 ──

async function cohortChats(body) {
  if (!owner(body)) return DENIED;
  return recentAttendChats();
}

function summaryText(d) {
  const { cohort: c, members, meetings, assignments } = d;
  const total = members.length;
  const lines = [`📊 [${c.title}] 집계 · ${kstDate()}`, `교육생 ${total}명`];
  if (c.useAttend && meetings.length) {
    lines.push('', '✅ 출석');
    for (const m of meetings) lines.push(`• ${m.date.slice(5).replace('-', '/')} ${m.title}: ${m.count}/${total}명`);
  }
  if (c.useAssign && assignments.length) {
    lines.push('', '📝 과제');
    for (const a of assignments) lines.push(`• ${a.title}${a.due ? ` (~${a.due.slice(5).replace('-', '/')})` : ''}: ${a.count}/${total}명`);
  }
  lines.push('', '👤 교육생별');
  for (const m of members) {
    const parts = [];
    if (c.useAttend && meetings.length) parts.push(`출석 ${m.attended}/${meetings.length}`);
    if (c.useAssign && assignments.length) parts.push(`과제 ${m.submitted}/${assignments.length}`);
    lines.push(`• ${m.name}${m.church ? '(' + m.church + ')' : ''}${parts.length ? ' — ' + parts.join(' · ') : ''}`);
  }
  return lines.join('\n');
}

async function cohortSendSummary(body) {
  if (!owner(body)) return DENIED;
  const c = await findCohort(clip(body.cohortId, 40));
  if (!c) return { error: '교육 과정을 찾을 수 없어요.' };
  const text = summaryText(await loadDetail(c));
  await sendAttendText(text, c.tgChat);
  return { ok: true, text };
}

// ── 교육생 화면(나의 교실) ──

/** 내가 교육생인 진행 중 과정들: 연결된 출석 모임과 내 출석, 과제와 내 제출. */
async function getMyCohorts(body) {
  const nid = normId(body.memberId);
  if (nid === '0') return { cohorts: [] };
  const mine = await run(db().from('cohort_members').select('*').eq('nid', nid));
  if (!mine.length) return { cohorts: [] };
  const ids = mine.map((m) => m.cohort_id);
  const [cohorts, assignments, subs, meetings] = await Promise.all([
    run(db().from('cohorts').select('*').in('cohort_id', ids).eq('status', '진행').order('id')),
    run(db().from('cohort_assignments').select('*').in('cohort_id', ids).neq('status', '삭제').order('id')),
    run(db().from('cohort_submissions').select('*').in('cohort_id', ids).eq('nid', nid)),
    run(db().from('attend_meetings').select('*').in('cohort_id', ids).neq('status', '삭제').order('date').order('start_time')),
  ]);
  const records = meetings.length ? await loadRecords((q) => q.eq('nid', nid).in('meeting_id', meetings.map((m) => m.meeting_id))) : [];
  const attendedAt = new Map(records.map((r) => [r.meetingId, r]));
  const subOf = new Map(subs.map((s) => [s.assignment_id, toSubmission(s)]));
  const today = kstDate();
  return {
    cohorts: cohorts.map(toCohort).map((c) => ({
      cohortId: c.cohortId, title: c.title, useAttend: c.useAttend, useAssign: c.useAssign,
      church: mine.find((m) => m.cohort_id === c.cohortId)?.church || '',
      meetings: c.useAttend ? meetings.filter((m) => m.cohort_id === c.cohortId).map((m) => {
        const r = attendedAt.get(m.meeting_id);
        return { ...toMeetingRow(m), attended: !!r, at: r ? r.at : '', late: r ? r.late : '', past: m.date < today };
      }) : [],
      assignments: c.useAssign ? assignments.filter((a) => a.cohort_id === c.cohortId).map((a) => ({ ...toAssignment(a), mine: subOf.get(a.assignment_id) || null })) : [],
    })),
  };
}

async function submitCohortAssignment(body) {
  const mid = clip(body.memberId, 40);
  const [a] = await run(db().from('cohort_assignments').select('*').eq('assignment_id', clip(body.assignmentId, 40)).neq('status', '삭제').limit(1));
  if (!a) return { error: '과제를 찾을 수 없어요.' };
  const c = await findCohort(a.cohort_id);
  if (!c || c.status !== '진행' || !c.useAssign) return { error: '지금은 과제를 낼 수 없는 교육이에요.' };
  if (a.status !== '열림') return { error: '마감된 과제예요.' };
  const me = await cohortMember(c.cohortId, mid);
  if (!me) return { error: '이 교육의 교육생으로 등록되어 있지 않아요.' };
  const content = clip(body.content, 4000);
  if (!content) return { error: '내용을 써 주세요.' };
  const now = kstDateTime();
  const nid = normId(mid);
  const [had] = await run(db().from('cohort_submissions').select('id').eq('assignment_id', a.assignment_id).eq('nid', nid).limit(1));
  if (had) {
    await run(db().from('cohort_submissions').update({ content, updated_at: now }).eq('id', had.id));
  } else {
    const { error } = await db().from('cohort_submissions').insert({
      assignment_id: a.assignment_id, cohort_id: c.cohortId, member_id: me.memberId, name: me.name, content, submitted_at: now, updated_at: now,
    });
    if (error && !isDuplicate(error)) throw new Error(error.message);
  }
  runLater((async () => {
    const [{ count: done }, { count: total }] = await Promise.all([
      db().from('cohort_submissions').select('*', { count: 'exact', head: true }).eq('assignment_id', a.assignment_id),
      db().from('cohort_members').select('*', { count: 'exact', head: true }).eq('cohort_id', c.cohortId),
    ]);
    const late = a.due && now.slice(0, 10) > a.due ? ' · 기한 지남' : '';
    await sendAttendText(
      `📝 [${c.title}] 과제 ${had ? '고쳐 냄' : '제출'} ${done || 0}/${total || 0}명\n👤 ${me.name}${me.church ? ' · ' + me.church : ''}\n📌 ${a.title}${late}\n🕐 ${now}\n\n${content.length > 600 ? content.slice(0, 600) + '…' : content}`,
      c.tgChat,
    );
  })());
  return { ok: true, updated: !!had };
}

export default {
  cohortList, cohortSave, cohortDetail, cohortAddMembers, cohortRemoveMember, cohortLinkMeeting, cohortCreateMeeting,
  cohortSaveAssignment, cohortSubmissions, cohortChats, cohortSendSummary, getMyCohorts, submitCohortAssignment,
};
