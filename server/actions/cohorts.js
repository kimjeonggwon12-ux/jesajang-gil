// 교육 과정(교육생 반): 앱 관리자(7777 = 김정권 계정)만 만들고 교육생을 넣는다.
// 2026-10-16(2차): 기간·요일이 있는 정기 교육 — 날짜마다 출석 모임(고정 QR 하나로 그날 모임에 출석),
// 과제는 한번/매일/요일 반복이고 날짜마다 따로 기록, 시험 점수는 텔레그램으로 수시로(cohort-bot.js).
import { db, run, selectAll, isDuplicate } from '../lib/db.js';
import { normId, kstDate, kstDateTime, fmtTs } from '../lib/util.js';
import { clip, newId, isDate } from '../lib/input.js';
import { runLater } from '../lib/background.js';
import { sendAttendText, sendAttendHtml, sendAttendPhoto } from '../lib/attend-bot.js';
import { scoreBoard, scoreSubjects, attendBoard, assignBoard, timetableBoard, boardHtml, boardPng } from '../lib/cohort-tables.js';
import { toCohort, findCohort, WEEK, weekdayOf, isClassDay, assignmentOn, cleanDates } from '../lib/cohort.js';
import { isOwner, memberInfo } from './roster.js';

const DENIED = { error: '교육 과정은 앱 관리자(7777)만 관리할 수 있어요.' };
const owner = (body) => isOwner(clip(body.memberId, 40));
const hm = (v) => (/^\d{1,2}:\d{2}$/.test(clip(v, 5)) ? clip(v, 5).padStart(5, '0') : '');
const cleanDays = (v) => [...WEEK].filter((d) => String(v || '').includes(d)).join('');
const mmdd = (d) => String(d).slice(5).replace('-', '/');
const REPEATS = ['한번', '매일', '요일', '날짜'];
const datesText = (list) => list.map((d) => mmdd(d)).join('·');

const toMember = (r) => ({ seq: r.seq || 0, memberId: r.member_id, name: r.name, church: r.church, addedAt: fmtTs(r.added_at) });
export const toAssignment = (r) => ({
  assignmentId: r.assignment_id, cohortId: r.cohort_id, title: r.title, guide: r.guide, due: r.due, status: r.status,
  repeat: r.repeat || '한번', days: r.days || '', dates: r.dates || '', dueTime: r.due_time || '', createdAt: fmtTs(r.created_at).slice(0, 10),
});
const toSubmission = (r) => ({
  assignmentId: r.assignment_id, memberId: r.member_id, name: r.name, content: r.content, workDate: r.work_date || '',
  late: !!r.late, source: r.source || '', at: fmtTs(r.updated_at || r.submitted_at),
});
export const toExam = (r) => ({ examId: r.exam_id, cohortId: r.cohort_id, subject: r.subject, days: r.days || '', dates: r.dates || '', date: r.date || '', dueTime: r.due_time || '', status: r.status });
/** 시험이 그날 있나: 날짜를 골랐으면 그 날짜들, 요일 루틴이면 요일, 한번 시험이면 그 날짜. */
export const examOn = (e, date) => e.status === '열림' && (e.dates ? cleanDates(e.dates).includes(date) : e.days ? e.days.includes(weekdayOf(date)) : e.date === date);
const examText = (e) => (e.dates ? datesText(cleanDates(e.dates)) : e.days ? (e.days.length === 7 ? '매일' : e.days) : (e.date ? mmdd(e.date) : '')) + ` · ${e.dueTime || '자정'}까지 점수`;
const toMeetingRow = (r) => ({ meetingId: r.meeting_id, title: r.title, date: r.date, start: String(r.start_time || '').slice(0, 5), end: String(r.end_time || '').slice(0, 5), status: r.status });

/** 반복 설명: "매일 · 21:00까지", "월수금 · 자정까지", "~10/20" */
export const repeatText = (a) => (a.repeat === '매일' ? '매일' : a.repeat === '요일' ? `${a.days || '요일'}` : a.repeat === '날짜' ? datesText(cleanDates(a.dates)) : (a.due ? `~${mmdd(a.due)}` : '한 번'))
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
  if (a.repeat === '날짜') { const to = c.endDate && c.endDate < today ? c.endDate : today; return cleanDates(a.dates).filter((d) => d <= to); }
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

// 2026-10-16 점검: 과정 자료는 "쓰는 부분 · 쓰는 칸"만 받는다(Supabase 전송량 아끼기).
//   과제 제출 내용(content, 최대 4000자)은 엑셀·하루 제출 보기에서만 받는다 — 숫자 셀 때는 빼고.
export const FULL = ['members', 'assignments', 'meetings', 'subs', 'scores', 'exams', 'schedule', 'records'];
/** 결과물별로 필요한 부분 */
export const NEED = {
  attend: ['members', 'meetings', 'records'],
  assign: ['members', 'assignments', 'meetings', 'subs'],
  score: ['members', 'scores'],
  timetable: ['schedule'],
  absence: ['members', 'meetings', 'records', 'schedule'],
};
const COLS = {
  members: 'seq, member_id, nid, name, church, added_at',
  assignments: 'assignment_id, cohort_id, title, guide, due, status, repeat, days, dates, due_time, created_at',
  meetings: 'meeting_id, title, date, start_time, end_time, status',
  subs: 'assignment_id, nid, member_id, name, work_date, late, source, submitted_at, updated_at',
  scores: 'date, subject, nid, name, score',
  schedule: 'date, start_time, end_time, title, sub, kind',
};
/** 과정 자료. parts = 받을 부분(기본 전부), content = 과제 제출 내용까지 */
export async function loadAll(c, parts = FULL, { content = false } = {}) {
  const has = (p) => parts.includes(p);
  const none = Promise.resolve([]);
  const id = c.cohortId;
  const [members, assignments, meetings, subs, scores, examRows, schedule] = await Promise.all([
    has('members') ? run(db().from('cohort_members').select(COLS.members).eq('cohort_id', id).order('seq').order('id')) : none,
    has('assignments') ? run(db().from('cohort_assignments').select(COLS.assignments).eq('cohort_id', id).neq('status', '삭제').order('id')) : none,
    has('meetings') || has('records') ? run(db().from('attend_meetings').select(COLS.meetings).eq('cohort_id', id).neq('status', '삭제').order('date').order('start_time')) : none,
    has('subs') ? selectAll(() => db().from('cohort_submissions').select(content ? COLS.subs + ', content' : COLS.subs).eq('cohort_id', id).order('id')) : none,
    has('scores') ? selectAll(() => db().from('cohort_scores').select(COLS.scores).eq('cohort_id', id).order('date').order('subject').order('id')) : none,
    has('exams') ? run(db().from('cohort_exams').select('*').eq('cohort_id', id).neq('status', '삭제').order('id')) : none,
    has('schedule') ? run(db().from('cohort_schedule').select(COLS.schedule).eq('cohort_id', id).order('date').order('start_time')) : none,
  ]);
  let records = [];
  if (has('records') && meetings.length) {
    // 출석 기록: 표에 쓰는 칸만(설문 답 등 제외), 같은 모임·같은 사람은 첫 기록만
    const rows = await selectAll(() => db().from('attend_records').select('id, meeting_id, member_id, nid, late, at').in('meeting_id', meetings.map((m) => m.meeting_id)).neq('record_id', '').order('id'));
    const seen = new Set();
    records = rows.filter((r) => { const k = r.meeting_id + '|' + r.nid; if (seen.has(k)) return false; seen.add(k); return true; })
      .map((r) => ({ meetingId: r.meeting_id, memberId: r.member_id, late: r.late, at: fmtTs(r.at) }));
  }
  return { members, assignments: assignments.map(toAssignment), meetings, subs, scores, records, examRoutines: examRows.map(toExam), schedule };
}

// ── 결석·빠진 교육 ──
// 출석 기록과 일정표를 맞춰, 교육생마다 결석한 날·지각·부분 결석과 그때 빠진 교육(일정표 항목)을 찾는다.
const NOT_CLASS = ['식사', '주간메모', '기타'];   // 빠진 교육으로 세지 않는 것
const toMin = (t) => { const [h, m] = String(t).slice(0, 5).split(':').map(Number); return h * 60 + m; };
/** 출석 기록의 빠진 시간대 [시작, 끝) 분 — 지각: 0~온 시각, "15:00부터": 15:00~끝, "09:00~17:00": 그 사이 */
function missedWindow(rec) {
  const t = String(rec.late || '');
  if (/지각/.test(t)) return [0, toMin(String(rec.at).slice(11, 16))];
  const range = /(\d{1,2}:\d{2})\s*[~\-–]\s*(\d{1,2}:\d{2})/.exec(t);
  if (range) return [toMin(range[1]), toMin(range[2])];
  const from = /(\d{1,2}:\d{2})\s*(?:부터|이후)/.exec(t);
  if (from) return [toMin(from[1]), 24 * 60];
  const until = /(\d{1,2}:\d{2})\s*(?:까지)/.exec(t);
  if (until) return [0, toMin(until[1])];
  return null;
}
/** 교육생 nid → { absentDays:[날짜], partial:[{date, text}], missed:[{date, start, title}] } (오늘까지) */
export function absenceOf(all, today) {
  const att = new Map(all.records.map((r) => [r.meetingId + '|' + normId(r.memberId), r]));
  const dayMeetings = new Map();
  for (const m of all.meetings) if (m.date <= today) { if (!dayMeetings.has(m.date)) dayMeetings.set(m.date, []); dayMeetings.get(m.date).push(m.meeting_id); }
  const classItems = (date) => (all.schedule || []).filter((x) => x.date === date && x.start_time && !NOT_CLASS.includes(x.kind));
  const out = new Map();
  for (const mem of all.members) {
    const a = { absentDays: [], partial: [], missed: [] };
    for (const [date, ids] of [...dayMeetings].sort()) {
      const rec = ids.map((id) => att.get(id + '|' + mem.nid)).find(Boolean);
      if (!rec) {
        a.absentDays.push(date);
        for (const x of classItems(date)) a.missed.push({ date, start: x.start_time, title: x.title });
        continue;
      }
      const w = missedWindow(rec);
      if (!w) continue;
      a.partial.push({ date, text: rec.late });
      for (const x of classItems(date)) {
        const s = toMin(x.start_time), e = x.end_time ? toMin(x.end_time) : s + 1;
        if (s < w[1] && e > w[0]) a.missed.push({ date, start: x.start_time, title: x.title });
      }
    }
    out.set(mem.nid, a);
  }
  return out;
}
/** 텔레그램용 결석 누적 줄들(빠진 게 있는 사람만) */
export function absenceLines(all, today) {
  const abs = absenceOf(all, today);
  const lines = [];
  for (const mem of all.members) {
    const a = abs.get(mem.nid);
    if (!a.absentDays.length && !a.partial.length) continue;
    const parts = [];
    if (a.absentDays.length) parts.push(`결석 ${a.absentDays.length}일(${a.absentDays.map(mmdd).join('·')})`);
    for (const p of a.partial) parts.push(`${mmdd(p.date)} ${p.text}`);
    lines.push(`• ${mem.name}${mem.church ? '(' + mem.church + ')' : ''} — ${parts.join(' / ')}`);
    if (a.missed.length) lines.push(`   빠진 교육 ${a.missed.length}개: ${a.missed.map((x) => `${mmdd(x.date)} ${x.title}`).join(', ')}`);
  }
  return lines;
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
    const k = String(e.subject).replace(/\s/g, '');
    const todayScores = scores.filter((s) => s.date === today && nids.has(s.nid) && String(s.subject).replace(/\s/g, '') === k);
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
  const [all, free] = await Promise.all([
    loadAll(c),
    run(db().from('attend_meetings').select(COLS.meetings).eq('cohort_id', '').neq('status', '삭제').order('id', { ascending: false }).limit(20)),
  ]);
  const d = crunch(c, all);
  return { cohort: c, ...d, freeMeetings: free.map(toMeetingRow), sheet: buildSheet(c, all, d, false) };
}

// ── 교육생 ──

/** 교육생 넣기: [{ church, name, memberId }] — 여러 명을 한 번에(붙여 넣기). 변경 기록에 '교육생 추가'로 남는다. */
async function cohortAddMembers(body) {
  if (!owner(body)) return DENIED;
  const c = await findCohort(clip(body.cohortId, 40));
  if (!c) return { error: '교육 과정을 먼저 고르거나 만들어 주세요.' };
  const list = (Array.isArray(body.members) ? body.members : []).slice(0, 500);
  const added = [], skipped = [];
  const [last] = await run(db().from('cohort_members').select('seq').eq('cohort_id', c.cohortId).order('seq', { ascending: false }).limit(1));
  let seq = last ? last.seq : 0;
  for (const raw of list) {
    const p = { church: clip(raw?.church, 40), name: clip(raw?.name, 30), memberId: clip(raw?.memberId, 40) };
    if (!p.name || p.memberId.replace(/\D/g, '').length < 5) { skipped.push({ ...p, why: '이름·고유번호 확인' }); continue; }
    if (!p.church) {
      const { teacher } = await memberInfo(p.memberId);   // 교회를 비우면 명단의 부서·지역으로
      p.church = teacher ? [teacher.dept, teacher.region].filter(Boolean).join(' ') : '';
    }
    const { error } = await db().from('cohort_members').insert({
      cohort_id: c.cohortId, member_id: p.memberId, name: p.name, church: p.church, added_by: clip(body.memberId, 40), added_at: kstDateTime(), seq: seq + 1,
    });
    if (!error) seq++;
    if (error) { skipped.push({ ...p, why: isDuplicate(error) ? '이미 등록됨' : error.message }); continue; }
    added.push(p);
    await logChange(body, '교육생 추가', p, { 교육: c.title, 교회: p.church });
  }
  if (added.length) {
    runLater(sendAttendText(`🎓 [${c.title}] 교육생 ${added.length}명 등록\n${added.map((p) => `• ${p.name}${p.church ? ' (' + p.church + ')' : ''}`).join('\n')}`, c.tgChat));
  }
  return { ok: true, added: added.length, skipped };
}

/** 교육생 번호 순서: memberIds 를 1번부터 차례로 */
async function cohortSetOrder(body) {
  if (!owner(body)) return DENIED;
  const c = await findCohort(clip(body.cohortId, 40));
  if (!c) return { error: '교육 과정을 찾을 수 없어요.' };
  const ids = (Array.isArray(body.memberIds) ? body.memberIds : []).map((x) => normId(x));
  const members = await run(db().from('cohort_members').select('id, nid').eq('cohort_id', c.cohortId).order('seq').order('id'));
  const ordered = [...ids.map((nid) => members.find((m) => m.nid === nid)).filter(Boolean), ...members.filter((m) => !ids.includes(m.nid))];
  for (const [i, m] of ordered.entries()) await run(db().from('cohort_members').update({ seq: i + 1 }).eq('id', m.id));
  return { ok: true, count: ordered.length };
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
/**
 * 출석 수기 입력(관리자): 그날 과정 출석 모임이 없으면 만들고, 교육생 한 명(또는 여럿)의 출석을 정한다.
 *   status: 출석 | 지각(note = 몇 시에 왔는지, 예 '10:20') | 부분(note = 예 '15:00부터 결석', '09:00~17:00 결석') | 결석(기록 지움)
 * 알림은 보내지 않는다.
 */
async function cohortSetAttendance(body) {
  if (!owner(body)) return DENIED;
  const c = await findCohort(clip(body.cohortId, 40));
  if (!c) return { error: '교육 과정을 찾을 수 없어요.' };
  const date = clip(body.date, 10);
  if (!isDate(date)) return { error: '날짜를 골라 주세요.' };
  const status = ['출석', '지각', '부분', '결석'].includes(String(body.status)) ? String(body.status) : '';
  if (!status) return { error: '출석·지각·부분·결석 중에서 골라 주세요.' };
  const note = clip(body.note, 40);
  const ids = (Array.isArray(body.memberIds) ? body.memberIds : [body.targetId]).map((x) => normId(x)).filter((x) => x !== '0');
  const members = (await run(db().from('cohort_members').select('*').eq('cohort_id', c.cohortId))).filter((m) => ids.includes(m.nid));
  if (!members.length) return { error: '교육생을 찾을 수 없어요.' };
  // 그날 모임(없으면 과정 시간으로 만들고, 지난날이면 마감 처리)
  let [m] = await run(db().from('attend_meetings').select('*').eq('cohort_id', c.cohortId).eq('date', date).neq('status', '삭제').order('start_time').limit(1));
  if (!m) {
    if (status === '결석') return { ok: true, changed: 0 };
    const start = c.startTime || '09:00', end = c.endTime || '18:00';
    m = { meeting_id: newId('MT') + date.slice(8), title: `${c.title} ${mmdd(date)}(${weekdayOf(date)})`, date, start_time: start, end_time: end,
      place: '', open_before: 30, questions: [], status: date < kstDate() ? '집계완료' : '열림', org: '전체', district: '',
      created_by: clip(body.memberId, 40), created_at: kstDateTime(), cohort_id: c.cohortId };
    await run(db().from('attend_meetings').insert(m));
  }
  const start = String(m.start_time || '09:00').slice(0, 5);
  const toMin = (t) => { const [h, mm] = t.split(':').map(Number); return h * 60 + mm; };
  let late = '', at = `${date} ${start}:00`;
  if (status === '지각') {
    const came = hm(note);
    if (!came) return { error: '지각은 온 시각을 넣어 주세요(예: 10:20).' };
    late = `${Math.max(1, toMin(came) - toMin(start))}분 지각`;
    at = `${date} ${came}:00`;
  } else if (status === '부분') {
    if (!note) return { error: '부분 결석은 결석한 시간을 적어 주세요(예: 15:00부터 결석).' };
    late = /결석|조퇴|외출/.test(note) ? note : note + ' 결석';
  }
  const nids = members.map((x) => x.nid);
  await run(db().from('attend_records').delete().eq('meeting_id', m.meeting_id).in('nid', nids));
  if (status !== '결석') {
    await run(db().from('attend_records').insert(members.map((x) => ({
      record_id: newId('AT') + x.nid.slice(-4), meeting_id: m.meeting_id, member_id: x.member_id, name: x.name, dept: x.church,
      position: '교육생', answers: {}, at, method: '수기', pick_org: '', pick_district: '', dept24: '', late,
    }))));
  }
  return { ok: true, changed: members.length, meetingId: m.meeting_id };
}

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
  const dates = repeat === '날짜' ? cleanDates(a.dates).join(',') : '';
  if (repeat === '날짜' && !dates) return { error: '과제 날짜를 하나 이상 골라 주세요.' };
  const due = repeat === '한번' ? clip(a.due, 10) : '';
  if (due && !isDate(due)) return { error: '기한 날짜를 다시 골라 주세요.' };
  const fields = {
    title, guide: clip(a.guide, 1000), due, repeat, days, dates, due_time: hm(a.dueTime),
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
    run(db().from('cohort_members').select('*').eq('cohort_id', row.cohort_id).order('seq').order('id')),
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
  const subject = clip(e.subject, 40).replace(/\s+/g, ' ');
  if (!subject) return { error: '시험 과목을 넣어 주세요.' };
  if (/^\d/.test(subject.split(' ')[0])) return { error: '과목 이름은 글자로 시작해 주세요(예: 계시록).' };
  const dates = cleanDates(e.dates).join(',');
  const days = dates ? '' : cleanDays(e.days);
  const date = days || dates ? '' : clip(e.date, 10);
  if (!days && !dates && !isDate(date)) return { error: '시험 날짜(또는 요일)를 골라 주세요.' };
  const fields = { subject, days, dates, date, due_time: hm(e.dueTime), status: ['열림', '닫힘', '삭제'].includes(String(e.status)) ? String(e.status) : '열림' };
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

function summaryText(c, d, all) {
  const { members, assignments, exams, total, today, todayMeetings, heldCount } = d;
  const lines = [`📊 ${c.title} 종합 보고 · ${mmdd(today)}(${weekdayOf(today)})`, `교육생 ${total}명${c.startDate ? ` · 기간 ${mmdd(c.startDate)}~${mmdd(c.endDate || c.startDate)}` : ''}`];
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
  const abs = all ? absenceLines(all, today) : [];
  if (abs.length) lines.push('', '🚫 결석 누적 · 빠진 교육', ...abs);
  lines.push('', `👤 누적 (출석 ${heldCount}회 기준)`);
  for (const m of members) {
    const parts = [];
    if (c.useAttend && m.held) parts.push(`출석 ${m.attended}/${m.held}`);
    if (c.useAssign && m.expected) parts.push(`과제 ${m.submitted}/${m.expected}`);
    lines.push(`• ${m.name}${m.church ? '(' + m.church + ')' : ''}${parts.length ? ' — ' + parts.join(' · ') : ''}`);
  }
  return lines.join('\n');
}

/** 결석 누적 줄들(매일 출석 마감 요약에 붙임) */
export const cohortAbsenceLines = async (c) => absenceLines(await loadAll(c, NEED.absence), kstDate());

export const cohortSummaryText = async (c) => { const all = await loadAll(c); return summaryText(c, crunch(c, all), all); };

/** 월요일 */
const mondayOf = (d) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
/** 결과물 하나: 일정표(week) · 출석부 · 과제 제출 현황 · 시험 결과 및 순위(subject) — 모두 맨 위에 "교육 이름 + 무엇" */
function makeBoard(all, c, kind, { subject = '', week = '', maxCols = 12 } = {}) {
  if (kind === 'timetable') return timetableBoard(all, mondayOf(isDate(week) ? week : kstDate()), c.title, c.days);
  if (kind === 'attend') return attendBoard(all, kstDate(), maxCols, c.title);
  if (kind === 'assign') return assignBoard(all, kstDate(), maxCols, c.title);
  if (kind === 'score') return scoreBoard(all, subject, maxCols, c.title);
  return null;
}

/** 표를 과정 방으로. kind: attend | assign | score | timetable | all(출석부 + 과제 제출 현황 + 과목별 시험 결과 및 순위) */
export async function sendBoards(c, { kind = 'all', subject = '', week = '', all = null, caption = '' } = {}) {
  const kinds = kind === 'all' ? ['attend', 'assign', 'score'] : [kind];
  all = all || await loadAll(c, [...new Set(kinds.flatMap((k) => NEED[k] || []))]);
  const boards = [];
  for (const k of kinds) {
    if (k === 'score') { for (const s of subject ? [subject] : scoreSubjects(all)) { const b = makeBoard(all, c, 'score', { subject: s }); if (b) boards.push([s, b]); } continue; }
    const b = makeBoard(all, c, k, { week }); if (b) boards.push([k, b]);
  }
  for (const [i, [, b]] of boards.entries()) await sendBoard(c, b, i === 0 ? caption : '');
  return boards.map(([name]) => name);
}

/** 표 한 장: 이미지(사진)로, 안 되면 글 표로 */
export async function sendBoard(c, b, caption = '') {
  const png = boardPng(b);
  if (png) {
    const r = await sendAttendPhoto(png, [caption, b.foot].filter(Boolean).join('\n').slice(0, 1000) || b.title, c.tgChat);
    if (r && r.ok) return;
  }
  await sendAttendHtml(boardHtml(b, caption), c.tgChat);
}

/** 앱 화면용 표 이미지(data URL) — 우클릭으로 복사·저장 */
async function cohortBoardImage(body) {
  if (!owner(body)) return DENIED;
  const c = await findCohort(clip(body.cohortId, 40));
  if (!c) return { error: '교육 과정을 찾을 수 없어요.' };
  const kind = clip(body.kind, 20);
  if (!NEED[kind]) return { error: '표 종류를 알 수 없어요.' };
  const all = await loadAll(c, NEED[kind]);
  const b = makeBoard(all, c, kind, { subject: clip(body.subject, 40), week: clip(body.week, 10), maxCols: 31 });
  if (!b) return { error: '아직 표에 넣을 기록이 없어요.' };
  const png = boardPng(b);
  if (!png) return { error: '이미지를 만들지 못했어요.' };
  return { ok: true, title: b.title, image: 'data:image/png;base64,' + png.toString('base64') };
}

async function cohortSendSummary(body) {
  if (!owner(body)) return DENIED;
  const c = await findCohort(clip(body.cohortId, 40));
  if (!c) return { error: '교육 과정을 찾을 수 없어요.' };
  const all = await loadAll(c);
  const text = summaryText(c, crunch(c, all), all);
  await sendAttendText(text, c.tgChat);
  await sendBoards(c, { all });
  return { ok: true, text };
}

/** 표만 보내기(앱의 [텔레그램으로 출석표·점수표 보내기]) */
async function cohortSendBoard(body) {
  if (!owner(body)) return DENIED;
  const c = await findCohort(clip(body.cohortId, 40));
  if (!c) return { error: '교육 과정을 찾을 수 없어요.' };
  const sent = await sendBoards(c, { kind: ['attend', 'assign', 'score', 'timetable'].includes(body.kind) ? body.kind : 'all', subject: clip(body.subject, 40), week: clip(body.week, 10) });
  return sent.length ? { ok: true, sent } : { error: '보낼 표가 없어요(아직 기록이 없음).' };
}

/** 점수 하나 고치기(앱 시험 결과표 칸): score 가 비면 지움(미응시) */
async function cohortSetScore(body) {
  if (!owner(body)) return DENIED;
  const c = await findCohort(clip(body.cohortId, 40));
  if (!c) return { error: '교육 과정을 찾을 수 없어요.' };
  const date = clip(body.date, 10), subject = clip(body.subject, 40);
  if (!isDate(date) || !subject) return { error: '날짜와 과목이 필요해요.' };
  const [m] = await run(db().from('cohort_members').select('*').eq('cohort_id', c.cohortId).eq('nid', normId(body.targetId)).limit(1));
  if (!m) return { error: '교육생을 찾을 수 없어요.' };
  const raw = String(body.score ?? '').trim();
  if (raw === '') {
    await run(db().from('cohort_scores').delete().eq('cohort_id', c.cohortId).eq('date', date).eq('subject', subject).eq('nid', m.nid));
    return { ok: true, removed: true };
  }
  const score = Number(raw);
  if (!Number.isFinite(score) || score < 0 || score > 1000) return { error: '점수는 0~1000 숫자로 넣어 주세요.' };
  await run(db().from('cohort_scores').upsert({ cohort_id: c.cohortId, date, subject, member_id: m.member_id, name: m.name, score, by_name: '앱', at: kstDateTime() }, { onConflict: 'cohort_id,date,subject,nid' }));
  return { ok: true };
}

/**
 * 취합 표(화면 + 엑셀): 교육생마다 누적 숫자, 날짜별 출석, 날짜별 과제 제출, 시험 점수, 과제 내용 목록.
 * 날짜 칸은 교육 시작일(없으면 첫 모임·첫 제출)부터 오늘(끝난 교육이면 끝나는 날)까지.
 */
async function cohortSheet(body) {
  if (!owner(body)) return DENIED;
  const c = await findCohort(clip(body.cohortId, 40));
  if (!c) return { error: '교육 과정을 찾을 수 없어요.' };
  const all = await loadAll(c, FULL, { content: !!body.content });
  return buildSheet(c, all, crunch(c, all), true);
}

/** 그날 한 교육생이 낸 과제(내용 포함) — 앱 과제 현황표 칸 */
async function cohortDayWork(body) {
  if (!owner(body)) return DENIED;
  const c = await findCohort(clip(body.cohortId, 40));
  if (!c) return { error: '교육 과정을 찾을 수 없어요.' };
  const date = clip(body.date, 10);
  if (!isDate(date)) return { error: '날짜가 필요해요.' };
  const [subs, asg] = await Promise.all([
    run(db().from('cohort_submissions').select('assignment_id, content, late, source, submitted_at, updated_at, work_date').eq('cohort_id', c.cohortId).eq('nid', normId(body.targetId)).or(`work_date.eq.${date},and(work_date.eq.,submitted_at.gte.${date}T00:00:00,submitted_at.lte.${date}T23:59:59)`).order('id')),
    run(db().from('cohort_assignments').select('assignment_id, title').eq('cohort_id', c.cohortId)),
  ]);
  const title = new Map(asg.map((a) => [a.assignment_id, a.title]));
  return { items: subs.map((s) => ({ title: title.get(s.assignment_id) || '', content: s.content, late: !!s.late, at: fmtTs(s.updated_at || s.submitted_at) })) };
}

/** 취합 표 자료. withSubs = 과제 제출 목록까지(엑셀) */
function buildSheet(c, all, d, withSubs) {
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
    return r ? (/지각|결석|조퇴|외출/.test(r.late || '') ? r.late : '출석') : '';
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
    // 결석·빠진 교육(엑셀 시트 + 화면)
    absences: (() => {
      const abs = absenceOf(all, today);
      const out = [];
      for (const m of all.members) {
        const a = abs.get(m.nid);
        const missedOn = (date) => a.missed.filter((x) => x.date === date).map((x) => x.title).join(', ');
        for (const date of a.absentDays) out.push({ date, church: m.church, name: m.name, type: '결석', text: '하루 결석', missed: missedOn(date) });
        for (const p of a.partial) out.push({ date: p.date, church: m.church, name: m.name, type: /지각/.test(p.text) ? '지각' : '부분 결석', text: p.text, missed: missedOn(p.date) });
      }
      return out.sort((x, y) => (x.date + x.name < y.date + y.name ? -1 : 1));
    })(),
    submissions: !withSubs ? [] : all.subs.filter((s) => nids.includes(s.nid)).map((s) => {
      const m = all.members.find((x) => x.nid === s.nid) || {};
      return { ...toSubmission(s), title: asgById.get(s.assignment_id)?.title || '', church: m.church || '' };
    }),
  };
}

export default {
  cohortList, cohortSave, cohortDetail, cohortAddMembers, cohortRemoveMember, cohortMakeSchedule, cohortLinkMeeting, cohortCreateMeeting,
  cohortSaveAssignment, cohortSubmissions, cohortSaveExam, cohortSendSummary, cohortSheet, cohortSetAttendance, cohortSendBoard, cohortSetScore, cohortBoardImage, cohortSetOrder, cohortDayWork,
};
