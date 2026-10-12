// 전도 일정: 행사 · 스탭/참석 신청 · 전도부 공지 · 공지 질문과 답변
import { db, run, selectAll } from '../lib/db.js';
import { normId, kstDate, kstDateTime, fmtTs, sameId } from '../lib/util.js';
import { clip, newId, isDate } from '../lib/input.js';
import { findTeacher, isAdmin } from './roster.js';

const DEPTS = ['교', '자', '장', '부', '청'];            // 신청용 부서 약칭
const ATTENDEE_ROLES = ['인', '교', '섬', '협'];
const EVENT_TYPES = ['개강', '행사'];
const STAGES = ['섭외', '친분', '만남1', '만남2', '상담1', '상담2', '복음방', '센터소개', '센터수강'];
const CATEGORIES = ['공식', '부서', '내일정'];

// ── 행사 ──

const toEvent = (e) => ({
  eventId: e.event_id, type: e.type || '행사', title: e.title,
  startDate: e.start_date, endDate: e.end_date || e.start_date,
  dept: e.dept, place: e.place, desc: e.description,
  createdBy: e.created_by, createdAt: fmtTs(e.created_at),
  category: CATEGORIES.includes(e.category) ? e.category : '공식',
  region: e.region, repeatDays: e.repeat_days, repeatUntil: e.repeat_until,
});

/** 모든 행사(시작일 순). */
async function allEvents() {
  const rows = await selectAll(() => db().from('calendar_events').select('*').order('id'));
  return rows.map(toEvent).sort((a, b) => (a.startDate < b.startDate ? -1 : (a.startDate > b.startDate ? 1 : 0)));
}

async function countByEvent(table) {
  const rows = await selectAll(() => db().from(table).select('event_id').neq('event_id', '').order('id'));
  const counts = new Map();
  for (const r of rows) counts.set(r.event_id, (counts.get(r.event_id) || 0) + 1);
  return counts;
}

/** 부서 일정은 같은 부서(첫 글자) 사람에게만 보인다. */
const sameDept = (event, viewer) => {
  const d = String(viewer.dept || '').trim().charAt(0);
  return !!d && String(event.dept || '').trim().charAt(0) === d;
};

/**
 * 내가 볼 수 있는 행사: 공식은 모두, 부서 일정은 같은 부서(관리자·등록자는 전부), 내 일정은 본인만.
 * memberId 없이 부르면 공식·부서 일정을 모두 준다.
 */
async function getCalendarEvents(body) {
  const me = clip(body.memberId, 40);
  const seeAll = me ? await isAdmin(me) : false;
  const viewer = me && !seeAll ? (await findTeacher(me)) || {} : null;
  const [events, staff, attendees] = await Promise.all([allEvents(), countByEvent('event_staff'), countByEvent('event_attendees')]);
  const rows = events.filter((e) => {
    if (e.category === '내일정') return !!me && sameId(e.createdBy, me);
    if (e.category === '부서' && viewer && !sameId(e.createdBy, me)) return sameDept(e, viewer);
    return true;
  }).map((e) => ({ ...e, staffCount: staff.get(e.eventId) || 0, attendeeCount: attendees.get(e.eventId) || 0 }));
  return { rows };
}

async function saveCalendarEvent(body) {
  const ev = body.event || {};
  const category = CATEGORIES.includes(ev.category) ? ev.category : '공식';
  const title = clip(ev.title, 80);
  const start = clip(ev.startDate, 10);
  let end = clip(ev.endDate, 10) || start;
  // 부서·내 일정은 유형 칸에 분류 이름을 그대로 적는다.
  const type = category === '공식' ? (EVENT_TYPES.includes(ev.type) ? ev.type : '') : category;
  if (!type) return { error: '유형(개강/행사)을 선택해주세요.' };
  if (!title) return { error: '제목을 입력해주세요.' };
  if (!isDate(start) || !isDate(end)) return { error: '날짜를 입력해주세요.' };
  if (end < start) return { error: '종료일은 시작일보다 빠를 수 없습니다.' };
  const dept = clip(ev.dept, 10);
  if (category === '부서' && !dept) return { error: '부서를 선택해주세요.' };

  // 매주 반복: 요일(0~6)과 끝나는 날(시작일에서 최대 1년)
  const repeatDays = (Array.isArray(ev.repeatDays) ? ev.repeatDays : []).map(Number)
    .filter((d, i, all) => d >= 0 && d <= 6 && all.indexOf(d) === i).sort();
  let repeatUntil = '';
  if (repeatDays.length) {
    repeatUntil = clip(ev.repeatUntil, 10);
    const limit = kstDate(new Date(new Date(start + 'T00:00:00+09:00').getTime() + 365 * 864e5));
    if (!isDate(repeatUntil)) return { error: '반복 끝나는 날을 선택해주세요.' };
    if (repeatUntil < start) return { error: '반복 끝나는 날은 시작일보다 빠를 수 없습니다.' };
    if (repeatUntil > limit) repeatUntil = limit;
    end = start;
  }

  const fields = {
    type, title, start_date: start, end_date: end, dept, place: clip(ev.place, 60), description: clip(ev.desc, 1000),
    category, region: clip(ev.region, 20),
  };
  const eventId = clip(ev.eventId, 40);
  if (eventId) {
    const [row] = await run(db().from('calendar_events').select('id, repeat_days').eq('event_id', eventId).limit(1));
    if (row) {
      // 옛 화면은 repeatDays 를 보내지 않는다 — 그때는 반복 설정을 그대로 두고, 반복 일정이면 하루짜리로 유지한다.
      const repeat = Array.isArray(ev.repeatDays)
        ? { repeat_days: repeatDays, repeat_until: repeatUntil }
        : (row.repeat_days.length ? { end_date: start } : {});
      await run(db().from('calendar_events').update({ ...fields, ...repeat }).eq('id', row.id));
      return { ok: true, eventId };
    }
  }
  const fresh = newId('EV');
  await run(db().from('calendar_events').insert({
    event_id: fresh, ...fields, created_by: clip(body.by, 40), created_at: kstDateTime(),
    repeat_days: repeatDays, repeat_until: repeatUntil,
  }));
  return { ok: true, eventId: fresh };
}

/** 행사와 그 신청 내역까지 지운다. 공식 일정이 아니면 등록한 본인만. */
async function deleteCalendarEvent(body) {
  const eventId = clip(body.eventId, 40);
  const mid = clip(body.memberId, 40);
  if (!eventId) return { error: 'eventId 가 필요합니다.' };
  if (mid) {
    const [row] = await run(db().from('calendar_events').select('*').eq('event_id', eventId).limit(1));
    if (row && toEvent(row).category !== '공식' && !sameId(row.created_by, mid)) {
      return { error: '본인이 등록한 일정만 삭제할 수 있습니다.' };
    }
  }
  await run(db().from('calendar_events').delete().eq('event_id', eventId));
  await run(db().from('event_staff').delete().eq('event_id', eventId));
  await run(db().from('event_attendees').delete().eq('event_id', eventId));
  return { ok: true };
}

// ── 스탭·참석 신청 ──

const myStaffRows = async (eventId, mid) =>
  (await run(db().from('event_staff').select('*').eq('event_id', eventId).order('id'))).filter((s) => sameId(s.member_id, mid));

async function applyEventStaff(body) {
  const eventId = clip(body.eventId, 40);
  const mid = clip(body.memberId, 40);
  const dept = clip(body.dept, 4);
  if (!eventId || !mid) return { error: 'eventId, memberId 가 필요합니다.' };
  if (!DEPTS.includes(dept)) return { error: '부서(교/자/장/부/청)를 선택해주세요.' };
  const fields = { name: clip(body.name, 30), dept, note: clip(body.note, 100), applied_at: kstDateTime() };
  const [mine] = await myStaffRows(eventId, mid);
  if (mine) {
    await run(db().from('event_staff').update(fields).eq('id', mine.id));
    return { ok: true, updated: true };
  }
  await run(db().from('event_staff').insert({ signup_id: newId('ST'), event_id: eventId, member_id: mid, ...fields }));
  return { ok: true };
}

async function cancelEventStaff(body) {
  const ids = (await myStaffRows(clip(body.eventId, 40), clip(body.memberId, 40))).map((s) => s.id);
  if (ids.length) await run(db().from('event_staff').delete().in('id', ids));
  return { ok: true };
}

async function applyEventAttendee(body) {
  const eventId = clip(body.eventId, 40);
  const mid = clip(body.applicantId, 40);
  if (!eventId || !mid) return { error: 'eventId, applicantId 가 필요합니다.' };
  const applicantDept = clip(body.applicantDept, 4);
  const applicantRole = clip(body.applicantRole, 4);
  if (!DEPTS.includes(applicantDept)) return { error: '신청자 부서를 선택해주세요.' };
  if (!ATTENDEE_ROLES.includes(applicantRole)) return { error: '신청자 역할(인/교/섬/협)을 선택해주세요.' };
  const guestName = clip(body.guestName, 30);
  const guestDept = clip(body.guestDept, 4);
  const guestAge = clip(body.guestAge, 10);
  const guestStage = clip(body.guestStage, 10);
  if (!guestName) return { error: '섭외자 이름을 입력해주세요.' };
  if (!DEPTS.includes(guestDept)) return { error: '섭외자 부서를 선택해주세요.' };
  if (!guestAge) return { error: '섭외자 나이를 입력해주세요.' };
  if (!STAGES.includes(guestStage)) return { error: '섭외자 전도단계를 선택해주세요.' };
  const id = newId('AT');
  await run(db().from('event_attendees').insert({
    signup_id: id, event_id: eventId, applicant_id: mid, applicant_name: clip(body.applicantName, 30),
    applicant_dept: applicantDept, applicant_role: applicantRole, guest_name: guestName, guest_dept: guestDept,
    guest_age: guestAge, guest_stage: guestStage, applied_at: kstDateTime(),
  }));
  return { ok: true, id };
}

async function deleteEventAttendee(body) {
  const mid = clip(body.memberId, 40);
  const rows = await run(db().from('event_attendees').select('id, applicant_id').eq('signup_id', clip(body.id, 40)).order('id'));
  const row = rows.find((r) => !mid || sameId(r.applicant_id, mid));
  if (!row) return { error: '삭제할 신청을 찾지 못했습니다.' };
  await run(db().from('event_attendees').delete().eq('id', row.id));
  return { ok: true };
}

const toAttendee = (a) => ({
  id: a.signup_id, eventId: a.event_id, applicantId: a.applicant_id, applicantName: a.applicant_name,
  applicantDept: a.applicant_dept, applicantRole: a.applicant_role, guestName: a.guest_name, guestDept: a.guest_dept,
  guestAge: a.guest_age, guestStage: a.guest_stage, at: fmtTs(a.applied_at),
});

/** 한 행사에 대한 내 신청(스탭 1건 + 참석자 여러 명)과 전체 참석 신청 수. */
async function getMyEventSignups(body) {
  const eventId = clip(body.eventId, 40);
  const mid = clip(body.memberId, 40);
  const [staffRows, attendees] = await Promise.all([
    myStaffRows(eventId, mid),
    run(db().from('event_attendees').select('*').eq('event_id', eventId).order('id')),
  ]);
  const staff = staffRows.at(-1);
  return {
    staff: staff ? { dept: staff.dept, note: staff.note } : null,
    attendees: attendees.filter((a) => sameId(a.applicant_id, mid)).map((a) => {
      const { id, applicantDept, applicantRole, guestName, guestDept, guestAge, guestStage } = toAttendee(a);
      return { id, applicantDept, applicantRole, guestName, guestDept, guestAge, guestStage };
    }),
    totalAttendees: attendees.length,
  };
}

const tally = (rows, key, keys) => {
  const counts = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const r of rows) if (counts[r[key]] != null) counts[r[key]]++;
  return counts;
};

/** 관리자 집계: 행사별(또는 전체) 스탭·참석 신청 명단과 부서·역할·단계별 수. */
async function getCalendarReport(body) {
  const eventId = clip(body.eventId, 40);
  const only = (q) => (eventId ? q.eq('event_id', eventId) : q);
  const [{ rows: events }, attendeeRows, staffRows] = await Promise.all([
    getCalendarEvents({}),
    selectAll(() => only(db().from('event_attendees').select('*')).order('id')),
    selectAll(() => only(db().from('event_staff').select('*')).order('id')),
  ]);
  const titleOf = new Map(events.map((e) => [e.eventId, e.title]));
  const attendees = attendeeRows.map((a) => ({ ...toAttendee(a), eventTitle: titleOf.get(a.event_id) || '' }));
  const staff = staffRows.map((s) => ({
    id: s.signup_id, eventId: s.event_id, memberId: s.member_id, name: s.name, dept: s.dept, note: s.note,
    at: fmtTs(s.applied_at), eventTitle: titleOf.get(s.event_id) || '',
  }));
  return {
    events, staff, attendees, total: attendees.length,
    byApplicantDept: tally(attendees, 'applicantDept', DEPTS),
    byApplicantRole: tally(attendees, 'applicantRole', ATTENDEE_ROLES),
    byGuestDept: tally(attendees, 'guestDept', DEPTS),
    byStage: tally(attendees, 'guestStage', STAGES),
    staffByDept: tally(staff, 'dept', DEPTS),
  };
}

// ── 전도부 공지 ──

async function getCalendarAds() {
  const data = await selectAll(() => db().from('calendar_ads').select('*').order('id'));
  const rows = data.map((a) => ({ adId: a.ad_id, title: a.title, body: a.body, sort: Number(a.sort_no), updatedAt: fmtTs(a.updated_at) }))
    .sort((a, b) => a.sort - b.sort);
  return { rows };
}

async function saveCalendarAd(body) {
  const ad = body.ad || {};
  const title = clip(ad.title, 60);
  if (!title) return { error: '제목을 입력해주세요.' };
  const text = clip(ad.body, 600);
  const sort = Number(ad.sort || 0) || 0;
  const now = kstDateTime();
  const adId = clip(ad.adId, 40);
  if (adId) {
    const [row] = await run(db().from('calendar_ads').select('id, sort_no').eq('ad_id', adId).limit(1));
    if (row) {
      await run(db().from('calendar_ads').update({ title, body: text, sort_no: sort || Number(row.sort_no), updated_at: now }).eq('id', row.id));
      return { ok: true, adId };
    }
  }
  // 정렬 값을 안 주면 맨 뒤에 붙인다.
  const { count } = await db().from('calendar_ads').select('*', { count: 'exact', head: true });
  const fresh = newId('AD');
  await run(db().from('calendar_ads').insert({ ad_id: fresh, title, body: text, sort_no: sort || (count || 0) + 1, updated_at: now }));
  return { ok: true, adId: fresh };
}

async function deleteCalendarAd(body) {
  await run(db().from('calendar_ads').delete().eq('ad_id', clip(body.adId, 40)));
  return { ok: true };
}

// ── 공지 질문·답변 ── 질문은 누구나, 고치기·지우기·답변은 관리자만.

async function getAdQuestions(body) {
  const adId = clip(body.adId, 40);
  const data = await selectAll(() => {
    const q = db().from('ad_questions').select('*').neq('status', '삭제');
    return (adId ? q.eq('ad_id', adId) : q).order('id');
  });
  const rows = data.map((q) => ({
    questionId: q.question_id, adId: q.ad_id, authorId: q.author_id, authorName: q.author_name,
    text: q.body, createdAt: fmtTs(q.created_at),
    answer: q.answer, answererName: q.answerer_name, answeredAt: fmtTs(q.answered_at), updatedAt: fmtTs(q.updated_at),
  })).sort((a, b) => (a.createdAt < b.createdAt ? -1 : (a.createdAt > b.createdAt ? 1 : 0)));
  return { rows };
}

const findQuestion = async (questionId) => (questionId
  ? (await run(db().from('ad_questions').select('id').eq('question_id', questionId).neq('status', '삭제').limit(1)))[0]
  : null);

async function saveAdQuestion(body) {
  const mid = clip(body.memberId, 40);
  const text = clip(body.text, 1000);
  const questionId = clip(body.questionId, 40);
  if (!mid) return { error: '로그인 정보가 없습니다.' };
  if (!text) return { error: '질문 내용을 입력해주세요.' };
  if (questionId) {
    if (!(await isAdmin(mid))) return { error: '질문 수정은 관리자만 할 수 있어요.' };
    const row = await findQuestion(questionId);
    if (!row) return { error: '질문을 찾을 수 없습니다.' };
    await run(db().from('ad_questions').update({ body: text, updated_at: kstDateTime() }).eq('id', row.id));
    return { ok: true, questionId };
  }
  const adId = clip(body.adId, 40);
  if (!adId) return { error: '공지 정보가 없습니다.' };
  const fresh = newId('AQ');
  await run(db().from('ad_questions').insert({
    question_id: fresh, ad_id: adId, author_id: mid, author_name: clip(body.name, 40), body: text,
    created_at: kstDateTime(), status: '게시',
  }));
  return { ok: true, questionId: fresh };
}

async function deleteAdQuestion(body) {
  const mid = clip(body.memberId, 40);
  if (!mid || !(await isAdmin(mid))) return { error: '질문 삭제는 관리자만 할 수 있어요.' };
  const row = await findQuestion(clip(body.questionId, 40));
  if (!row) return { error: '질문을 찾을 수 없습니다.' };
  await run(db().from('ad_questions').update({ status: '삭제', updated_at: kstDateTime() }).eq('id', row.id));
  return { ok: true };
}

/** 답변을 달거나(빈 답변이면) 지운다. */
async function answerAdQuestion(body) {
  const mid = clip(body.memberId, 40);
  if (!mid || !(await isAdmin(mid))) return { error: '답변은 관리자만 할 수 있어요.' };
  const row = await findQuestion(clip(body.questionId, 40));
  if (!row) return { error: '질문을 찾을 수 없습니다.' };
  const answer = clip(body.answer, 1500);
  await run(db().from('ad_questions').update(answer
    ? { answer, answerer_id: mid, answerer_name: clip(body.name, 40), answered_at: kstDateTime() }
    : { answer: '', answerer_id: '', answerer_name: '', answered_at: null }).eq('id', row.id));
  return { ok: true };
}

export default {
  getCalendarEvents, saveCalendarEvent, deleteCalendarEvent,
  applyEventStaff, cancelEventStaff, applyEventAttendee, deleteEventAttendee, getMyEventSignups, getCalendarReport,
  getCalendarAds, saveCalendarAd, deleteCalendarAd,
  getAdQuestions, saveAdQuestion, deleteAdQuestion, answerAdQuestion,
};
