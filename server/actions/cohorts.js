// 교육 과정(교육생 반): 앱 관리자(7777 = 김정권 계정)만 만들고 교육생을 넣는다.
// 2026-10-16(2차): 기간·요일이 있는 정기 교육 — 날짜마다 출석 모임(고정 QR 하나로 그날 모임에 출석),
// 과제는 한번/매일/요일 반복이고 날짜마다 따로 기록, 시험 점수는 텔레그램으로 수시로(cohort-bot.js).
import { db, run, isDuplicate } from '../lib/db.js';
import { normId, kstDate, kstDateTime, fmtTs } from '../lib/util.js';
import { clip, newId, isDate } from '../lib/input.js';
import { runLater } from '../lib/background.js';
import { sendAttendText } from '../lib/attend-bot.js';
import { toCohort, findCohort, WEEK, weekdayOf, isClassDay, assignmentOn } from '../lib/cohort.js';
import { isOwner, memberInfo } from './roster.js';
import { loadRecords } from './attendance.js';

const DENIED = { error: '교육 과정은 앱 관리자(7777)만 관리할 수 있어요.' };
const owner = (body) => isOwner(clip(body.memberId, 40));
const hm = (v) => (/^\d{1,2}:\d{2}$/.test(clip(v, 5)) ? clip(v, 5).padStart(5, '0') : '');
const cleanDays = (v) => [...WEEK].filter((d) => String(v || '').includes(d)).join('');
const mmdd = (d) => String(d).slice(5).replace('-', '/');
const REPEATS = ['한번', '매일', '요일'];

const toMember = (r) => ({ memberId: r.member_id, name: r.name, church: r.church, addedAt: fmtTs(r.added_at) });
export const toAssignment = (r) => ({
  assignmentId: r.assignment_id, cohortId: r.cohort_id, title: r.title, guide: r.guide, due: r.due, status: r.status,
  repeat: r.repeat || '한번', days: r.days || '', dueTime: r.due_time || '', createdAt: fmtTs(r.created_at).slice(0, 10),
});
const toSubmission = (r) => ({
  assignmentId: r.assignment_id, memberId: r.member_id, name: r.name, content: r.content, workDate: r.work_date || '',
  late: !!r.late, source: r.source || '', at: fmtTs(r.updated_at || r.submitted_at),
});
export const toExam = (r) => ({ examId: r.exam_id, cohortId: r.cohort_id, subject: r.subject, days: r.days || '', date: r.date || '', dueTime: r.due_time || '', status: r.status });
/** 시험이 그날 있나: 요일 루틴이면 요일, 한번 시험이면 그 날짜. */
export const examOn = (e, date) => e.status === '열림' && (e.days ? e.days.includes(weekdayOf(date)) : e.date === date);
const examText = (e) => (e.days ? (e.days.length === 7 ? '매일' : e.days) : (e.date ? mmdd(e.date) : '')) + ` · ${e.dueTime || '자정'}까지 점수`;
const toMeetingRow = (r) => ({ meetingId: r.meeting_id, title: r.title, date: r.date, start: String(r.start_time || '').slice(0, 5), end: String(r.end_time || '').slice(0, 5), status: r.status });

/** 반복 설명: "매일 · 21:00까지", "월수금 · 자정까지", "~10/20" */
export const repeatText = (a) => (a.repeat === '매일' ? '매일' : a.repeat === '요일' ? `${a.days || '요일'}` : (a.due ? `~${mmdd(a.due)}` : '한 번'))
  + (a.repeat !== '한번' || a.due ? ` · ${a.dueTime || '자정'}까지` : '');

/** 날짜 목록 from~to(포함) */
function dateRange(from, to, max = 400) {
  const out = [];
  const d = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (d <= end && out.length < max) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

/** 그 과제를 오늘까지 내야 했던 날들(한번 과제는 ['']). 시작 = 과정 시작일과 과제 만든 날 중 늦은 날. */
function dueDates(c, a, today) {
  if (a.repeat === '한번') return [''];
  const from = [c.startDate, a.createdAt].filter(Boolean).sort().at(-1) || today;
  const to = c.endDate && c.endDate < today ? c.endDate : today;
  if (from > to) return [];
  return dateRange(from, to).filter((d) => assignmentOn(a, d));
}

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
  const startDate = clip(c.startDate, 10), endDate = clip(c.endDate, 10);
  if ((startDate && !isDate(startDate)) || (endDate && !isDate(endDate))) return { error: '교육 기간 날짜를 다시 골라 주세요.' };
  if (startDate && endDate && endDate < startDate) return { error: '교육 끝나는 날이 시작하는 날보다 뒤여야 해요.' };
  const startTime = hm(c.startTime), endTime = hm(c.endTime);
  if (startTime && endTime && endTime <= startTime) return { error: '교육 끝 시간이 시작 시간보다 뒤여야 해요.' };
  const fields = {
    title, use_attend: c.useAttend !== false, use_assign: c.useAssign !== false, tg_chat: tgChat,
    start_date: startDate, end_date: endDate, days: cleanDays(c.days), start_time: startTime, end_time: endTime,
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

/** 과정의 모든 자료(상세·집계·취합 표가 같이 쓴다). */
async function loadAll(c) {
  const [members, assignments, meetings, subs, scores, examRows] = await Promise.all([
    run(db().from('cohort_members').select('*').eq('cohort_id', c.cohortId).order('church').order('name')),
    run(db().from('cohort_assignments').select('*').eq('cohort_id', c.cohortId).neq('status', '삭제').order('id')),
    run(db().from('attend_meetings').select('*').eq('cohort_id', c.cohortId).neq('status', '삭제').order('date').order('start_time')),
    run(db().from('cohort_submissions').select('*').eq('cohort_id', c.cohortId).order('id')),
    run(db().from('cohort_scores').select('*').eq('cohort_id', c.cohortId).order('date').order('subject')),
    run(db().from('cohort_exams').select('*').eq('cohort_id', c.cohortId).neq('status', '삭제').order('id')),
  ]);
  const ids = meetings.map((m) => m.meeting_id);
  const records = ids.length ? await loadRecords((q) => q.in('meeting_id', ids)) : [];
  return { members, assignments: assignments.map(toAssignment), meetings, subs, scores, records, examRoutines: examRows.map(toExam) };
}

/** 상세·집계용 숫자. */
function crunch(c, all) {
  const today = kstDate();
  const { members, assignments, meetings, subs, scores, records } = all;
  const nids = new Set(members.map((m) => m.nid));
  const total = members.length;
  const held = meetings.filter((m) => m.date <= today);             // 오늘까지 있었던 출석 모임
  const attended = {}, perMeeting = {};
  for (const r of records) {
    const n = normId(r.memberId);
    if (!nids.has(n)) continue;
    perMeeting[r.meetingId] = (perMeeting[r.meetingId] || 0) + 1;
    if (held.some((m) => m.meeting_id === r.meetingId)) attended[n] = (attended[n] || 0) + 1;
  }
  const subKey = new Set(subs.filter((s) => nids.has(s.nid)).map((s) => `${s.assignment_id}|${s.work_date}|${s.nid}`));
  const asg = assignments.map((a) => {
    const dates = dueDates(c, a, today);
    const todayKey = a.repeat === '한번' ? '' : today;
    const onToday = a.status === '열림' && (a.repeat === '한번' || (isClassDayForAssign(c, today) && assignmentOn(a, today)));
    const doneToday = members.filter((m) => subKey.has(`${a.assignmentId}|${todayKey}|${m.nid}`)).length;
    const doneAll = subs.filter((s) => s.assignment_id === a.assignmentId && nids.has(s.nid) && dates.includes(s.work_date)).length;
    return { ...a, repeatText: repeatText(a), dates, onToday, doneToday, doneAll, expectAll: dates.length * total };
  });
  const memberRows = members.map((m) => {
    let expected = 0, done = 0;
    for (const a of asg) for (const d of a.dates) { expected++; if (subKey.has(`${a.assignmentId}|${d}|${m.nid}`)) done++; }
    return { ...toMember(m), attended: attended[m.nid] || 0, held: held.length, submitted: done, expected };
  });
  const exams = new Map();
  for (const s of scores) {
    if (!nids.has(s.nid)) continue;
    const key = s.date + '|' + s.subject;
    const e = exams.get(key) || { date: s.date, subject: s.subject, count: 0, sum: 0 };
    e.count++; e.sum += Number(s.score);
    exams.set(key, e);
  }
  const routines = (all.examRoutines || []).map((e) => {
    const k = String(e.subject).replace(/s/g, '');
    const todayScores = scores.filter((s) => s.date === today && nids.has(s.nid) && String(s.subject).replace(/s/g, '') === k);
    return { ...e, examText: examText(e), onToday: examOn(e, today), doneToday: todayScores.length };
  });
  const todayMeetings = meetings.filter((m) => m.date === today).map((m) => ({ ...toMeetingRow(m), count: perMeeting[m.meeting_id] || 0 }));
  return {
    today, total,
    members: memberRows,
    meetings: meetings.map((m) => ({ ...toMeetingRow(m), count: perMeeting[m.meeting_id] || 0 })),
    heldCount: held.length,
    examRoutines: routines,
    todayMeetings,
    assignments: asg.map(({ dates, ...a }) => ({ ...a, dayCount: dates.length })),
    exams: [...exams.values()].map((e) => ({ date: e.date, subject: e.subject, count: e.count, avg: Math.round((e.sum / e.count) * 10) / 10 })),
  };
}
// 반복 과제는 교육 기간 안에서만(요일은 과제가 따로 정함)
const isClassDayForAssign = (c, d) => isClassDay({ ...c, days: '' }, d);

async function cohortDetail(body) {
  if (!owner(body)) return DENIED;
  const c = await findCohort(clip(body.cohortId, 40));
  if (!c) return { error: '교육 과정을 찾을 수 없어요.' };
  const free = await run(db().from('attend_meetings').select('*').eq('cohort_id', '').neq('status', '삭제').order('id', { ascending: false }).limit(20));
  return { cohort: c, ...crunch(c, await loadAll(c)), freeMeetings: free.map(toMeetingRow) };
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

// ── 출석 일정 ──

/**
 * 교육 기간·요일·시간대로 날짜마다 출석 모임을 맞춘다.
 * 없는 날은 만들고, 오늘 이후 모임은 시간을 새로 맞추며, 교육 날이 아니게 된 날의 모임은(출석 기록이 없으면) 지운다.
 */
async function cohortMakeSchedule(body) {
  if (!owner(body)) return DENIED;
  const c = await findCohort(clip(body.cohortId, 40));
  if (!c) return { error: '교육 과정을 찾을 수 없어요.' };
  if (!c.startDate || !c.endDate) return { error: '먼저 교육 기간(시작·끝 날짜)을 넣고 [설정 저장]을 눌러 주세요.' };
  if (!c.startTime || !c.endTime) return { error: '먼저 교육 시간(시작·끝)을 넣고 [설정 저장]을 눌러 주세요.' };
  const today = kstDate();
  const want = dateRange(c.startDate, c.endDate, 370).filter((d) => isClassDay(c, d));
  const have = await run(db().from('attend_meetings').select('meeting_id, date, start_time, end_time').eq('cohort_id', c.cohortId).neq('status', '삭제'));
  const haveDates = new Set(have.map((m) => m.date));
  const now = kstDateTime();
  const fresh = want.filter((d) => !haveDates.has(d) && d >= today).map((d) => ({
    meeting_id: newId('MT') + d.slice(8), title: `${c.title} ${mmdd(d)}(${weekdayOf(d)})`, date: d, start_time: c.startTime, end_time: c.endTime,
    place: '', open_before: 30, questions: [], status: '열림', org: '전체', district: '',
    created_by: clip(body.memberId, 40), created_at: now, cohort_id: c.cohortId,
  }));
  if (fresh.length) await run(db().from('attend_meetings').insert(fresh));
  // 오늘 이후 모임: 시간 맞추기 / 교육 날이 아니게 된 날은 지우기(출석 기록이 없을 때만)
  let retimed = 0, removed = 0;
  const wantSet = new Set(want);
  for (const m of have.filter((x) => x.date >= today)) {
    if (!wantSet.has(m.date)) {
      const { count } = await db().from('attend_records').select('*', { count: 'exact', head: true }).eq('meeting_id', m.meeting_id);
      if (!count) { await run(db().from('attend_meetings').update({ status: '삭제', updated_at: now }).eq('meeting_id', m.meeting_id)); removed++; }
    } else if (String(m.start_time).slice(0, 5) !== c.startTime || String(m.end_time).slice(0, 5) !== c.endTime) {
      await run(db().from('attend_meetings').update({ start_time: c.startTime, end_time: c.endTime, updated_at: now }).eq('meeting_id', m.meeting_id));
      retimed++;
    }
  }
  return { ok: true, created: fresh.length, retimed, removed, days: want.length };
}

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

/** 정기 일정 밖의 출석 모임 하나(보충·특별 교육 등). */
async function cohortCreateMeeting(body) {
  if (!owner(body)) return DENIED;
  const c = await findCohort(clip(body.cohortId, 40));
  if (!c) return { error: '교육 과정을 찾을 수 없어요.' };
  const m = body.meeting || {};
  const date = clip(m.date, 10);
  const start = hm(m.start), end = hm(m.end);
  if (!isDate(date)) return { error: '날짜를 골라 주세요.' };
  if (!start || !end || end <= start) return { error: '시작·끝 시간을 넣어 주세요(끝이 시작보다 뒤).' };
  const meetingId = newId('MT');
  await run(db().from('attend_meetings').insert({
    meeting_id: meetingId, title: clip(m.title, 80) || `${c.title} ${mmdd(date)}(${weekdayOf(date)})`, date, start_time: start, end_time: end,
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
  const repeat = REPEATS.includes(String(a.repeat)) ? String(a.repeat) : '한번';
  const days = repeat === '요일' ? cleanDays(a.days) : '';
  if (repeat === '요일' && !days) return { error: '과제 요일을 하나 이상 골라 주세요.' };
  const due = repeat === '한번' ? clip(a.due, 10) : '';
  if (due && !isDate(due)) return { error: '기한 날짜를 다시 골라 주세요.' };
  const fields = {
    title, guide: clip(a.guide, 1000), due, repeat, days, due_time: hm(a.dueTime),
    status: ['열림', '닫힘', '삭제'].includes(String(a.status)) ? String(a.status) : '열림',
  };
  const id = clip(a.assignmentId, 40);
  if (id) {
    await run(db().from('cohort_assignments').update(fields).eq('assignment_id', id).eq('cohort_id', c.cohortId));
    return { ok: true, assignmentId: id };
  }
  const assignmentId = newId('AS');
  await run(db().from('cohort_assignments').insert({ assignment_id: assignmentId, cohort_id: c.cohortId, ...fields, created_at: kstDateTime() }));
  const shown = toAssignment({ ...fields, assignment_id: assignmentId, cohort_id: c.cohortId });
  if (c.useAssign) runLater(sendAttendText(`📌 [${c.title}] 과제: ${title} (${repeatText(shown)})${fields.guide ? '\n' + fields.guide : ''}\n✍️ 내는 법: 제출 ${title.split(/\s+/).at(-1)} 내용…`, c.tgChat));
  return { ok: true, assignmentId };
}

/** 과제 한 개의 제출(반복 과제면 그날 것 — date 를 안 주면 오늘). */
async function cohortSubmissions(body) {
  if (!owner(body)) return DENIED;
  const id = clip(body.assignmentId, 40);
  const [row] = await run(db().from('cohort_assignments').select('*').eq('assignment_id', id).limit(1));
  if (!row) return { error: '과제를 찾을 수 없어요.' };
  const a = toAssignment(row);
  const date = a.repeat === '한번' ? '' : (isDate(clip(body.date, 10)) ? clip(body.date, 10) : kstDate());
  const [subs, members] = await Promise.all([
    run(db().from('cohort_submissions').select('*').eq('assignment_id', id).eq('work_date', date).order('id')),
    run(db().from('cohort_members').select('*').eq('cohort_id', row.cohort_id).order('church').order('name')),
  ]);
  const done = new Set(subs.map((s) => s.nid));
  return { assignment: { ...a, repeatText: repeatText(a) }, date, submissions: subs.map(toSubmission), missing: members.filter((m) => !done.has(m.nid)).map(toMember) };
}

// ── 시험 루틴 ──

/** 시험 루틴: 과목 + 요일(월~일, 비우면 한 번만: 날짜) + 점수 마감 시각. 점수는 텔레그램 "점수 과목 이름 점수…". */
async function cohortSaveExam(body) {
  if (!owner(body)) return DENIED;
  const c = await findCohort(clip(body.cohortId, 40));
  if (!c) return { error: '교육 과정을 찾을 수 없어요.' };
  const e = body.exam || {};
  const subject = clip(e.subject, 40).replace(/s+/g, ' ');
  if (!subject) return { error: '시험 과목을 넣어 주세요.' };
  if (/d/.test(subject.split(' ')[0])) return { error: '과목 이름은 글자로 시작해 주세요(예: 계시록).' };
  const days = cleanDays(e.days);
  const date = days ? '' : clip(e.date, 10);
  if (!days && !isDate(date)) return { error: '요일을 고르거나(정기 시험), 한 번 보는 시험이면 날짜를 골라 주세요.' };
  const fields = { subject, days, date, due_time: hm(e.dueTime), status: ['열림', '닫힘', '삭제'].includes(String(e.status)) ? String(e.status) : '열림' };
  const id = clip(e.examId, 40);
  if (id) {
    await run(db().from('cohort_exams').update(fields).eq('exam_id', id).eq('cohort_id', c.cohortId));
    return { ok: true, examId: id };
  }
  const examId = newId('EX');
  await run(db().from('cohort_exams').insert({ exam_id: examId, cohort_id: c.cohortId, ...fields, created_at: kstDateTime() }));
  runLater(sendAttendText(`🧪 [${c.title}] 시험: ${subject} (${examText(toExam(fields))})
✍️ 점수 올리는 법(방 관리자): 점수 ${subject} 홍길동 85 김영희 90`, c.tgChat));
  return { ok: true, examId };
}

// ── 집계 · 취합 ──

function summaryText(c, d) {
  const { members, assignments, exams, total, today, todayMeetings, heldCount } = d;
  const lines = [`📊 [${c.title}] ${mmdd(today)}(${weekdayOf(today)}) 집계`, `교육생 ${total}명${c.startDate ? ` · 기간 ${mmdd(c.startDate)}~${mmdd(c.endDate || c.startDate)}` : ''}`];
  const todayAsg = assignments.filter((a) => a.onToday);
  const todayExams = (d.examRoutines || []).filter((x) => x.onToday);
  if (todayMeetings.length || todayAsg.length || todayExams.length) {
    lines.push('', '📅 오늘');
    for (const m of todayMeetings) lines.push(`• 출석: ${m.count}/${total}명`);
    for (const a of todayAsg) lines.push(`• 과제 ${a.title}: ${a.doneToday}/${total}명`);
    for (const e of todayExams) lines.push(`• 시험 ${e.subject}: 점수 ${e.doneToday}/${total}명`);
  }
  if (exams.length) {
    lines.push('', '📊 시험(최근)');
    for (const e of exams.slice(-5)) lines.push(`• ${mmdd(e.date)} ${e.subject}: ${e.count}/${total}명 · 평균 ${e.avg}`);
  }
  lines.push('', `👤 누적 (출석 ${heldCount}회 기준)`);
  for (const m of members) {
    const parts = [];
    if (c.useAttend && m.held) parts.push(`출석 ${m.attended}/${m.held}`);
    if (c.useAssign && m.expected) parts.push(`과제 ${m.submitted}/${m.expected}`);
    lines.push(`• ${m.name}${m.church ? '(' + m.church + ')' : ''}${parts.length ? ' — ' + parts.join(' · ') : ''}`);
  }
  return lines.join('\n');
}

export const cohortSummaryText = async (c) => summaryText(c, crunch(c, await loadAll(c)));

async function cohortSendSummary(body) {
  if (!owner(body)) return DENIED;
  const c = await findCohort(clip(body.cohortId, 40));
  if (!c) return { error: '교육 과정을 찾을 수 없어요.' };
  const text = await cohortSummaryText(c);
  await sendAttendText(text, c.tgChat);
  return { ok: true, text };
}

/**
 * 취합 표(화면 + 엑셀): 교육생마다 누적 숫자, 날짜별 출석, 날짜별 과제 제출, 시험 점수, 과제 내용 목록.
 * 날짜 칸은 교육 시작일(없으면 첫 모임·첫 제출)부터 오늘(끝난 교육이면 끝나는 날)까지.
 */
async function cohortSheet(body) {
  if (!owner(body)) return DENIED;
  const c = await findCohort(clip(body.cohortId, 40));
  if (!c) return { error: '교육 과정을 찾을 수 없어요.' };
  const all = await loadAll(c);
  const d = crunch(c, all);
  const today = d.today;
  const nids = all.members.map((m) => m.nid);
  const firsts = [c.startDate, all.meetings[0]?.date, all.subs.map((s) => s.work_date).filter(Boolean).sort()[0]].filter(Boolean).sort();
  const last = c.endDate && c.endDate < today ? c.endDate : today;
  const dates = firsts.length && firsts[0] <= last ? dateRange(firsts[0], last, 400) : [];
  // 날짜별 출석
  const meetOfDate = new Map();
  for (const m of all.meetings) { if (!meetOfDate.has(m.date)) meetOfDate.set(m.date, []); meetOfDate.get(m.date).push(m.meeting_id); }
  const att = new Map();
  for (const r of all.records) att.set(r.meetingId + '|' + normId(r.memberId), r);
  const attendCell = (date, nid) => {
    const ms = meetOfDate.get(date);
    if (!ms) return null;   // 교육 없는 날
    const r = ms.map((id) => att.get(id + '|' + nid)).find(Boolean);
    return r ? (/지각/.test(r.late || '') ? r.late : '출석') : '';
  };
  // 날짜별 과제: 그날 낸 과제 이름들
  const short = (a) => a.title.split(/\s+/).at(-1);
  const asgById = new Map(all.assignments.map((a) => [a.assignmentId, a]));
  const subsByKey = new Map();
  for (const s of all.subs) {
    const key = (s.work_date || fmtTs(s.submitted_at).slice(0, 10)) + '|' + s.nid;
    if (!subsByKey.has(key)) subsByKey.set(key, []);
    subsByKey.get(key).push(s);
  }
  const scoreOf = new Map(all.scores.map((s) => [s.date + '|' + s.subject + '|' + s.nid, Number(s.score)]));
  const examCols = d.exams.map((e) => ({ date: e.date, subject: e.subject }));
  return {
    cohort: c, dates, classDates: dates.filter((x) => meetOfDate.has(x)), assignments: d.assignments, exams: examCols,
    rows: all.members.map((m, i) => ({
      ...d.members[i],
      attend: dates.map((x) => attendCell(x, nids[i])),
      daily: dates.map((x) => (subsByKey.get(x + '|' + nids[i]) || []).map((s) => short(asgById.get(s.assignment_id) || { title: '?' }) + (s.late ? '(늦음)' : '')).join('·')),
      perAssign: d.assignments.map((a) => all.subs.filter((s) => s.assignment_id === a.assignmentId && s.nid === nids[i]).length),
      scores: examCols.map((e) => scoreOf.get(e.date + '|' + e.subject + '|' + nids[i]) ?? null),
    })),
    submissions: all.subs.filter((s) => nids.includes(s.nid)).map((s) => {
      const m = all.members.find((x) => x.nid === s.nid) || {};
      return { ...toSubmission(s), title: asgById.get(s.assignment_id)?.title || '', church: m.church || '' };
    }),
  };
}

export default {
  cohortList, cohortSave, cohortDetail, cohortAddMembers, cohortRemoveMember, cohortMakeSchedule, cohortLinkMeeting, cohortCreateMeeting,
  cohortSaveAssignment, cohortSubmissions, cohortSaveExam, cohortSendSummary, cohortSheet,
};
