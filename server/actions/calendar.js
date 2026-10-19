// 전도 일정: 행사 · 스탭/참석 신청 · 전도부 공지 · 공지 질문과 답변
import { db, run, selectAll } from '../lib/db.js';
import { normId, kstDate, kstDateTime, fmtTs, sameId } from '../lib/util.js';
import { clip, newId, isDate } from '../lib/input.js';
import { findTeacher, isAdmin } from './roster.js';
import { storeImage } from '../lib/images.js';

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
  hostDept: e.host_dept || '', contactName: e.contact_name || '', contactPhone: e.contact_phone || '',
  highlight: !!e.highlight && (CATEGORIES.includes(e.category) ? e.category : '공식') === '공식',
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
  const [events, staff, attendees, cheers, weeks] = await Promise.all([
    allEvents(), countByEvent('event_staff'), countByEvent('event_attendees'), cheerCounts(), allWeeks(),
  ]);
  const rows = events.filter((e) => {
    if (e.category === '내일정') return !!me && sameId(e.createdBy, me);
    if (e.category === '부서' && viewer && !sameId(e.createdBy, me)) return sameDept(e, viewer);
    return true;
  }).map((e) => ({
    ...e, staffCount: staff.get(e.eventId) || 0, attendeeCount: attendees.get(e.eventId) || 0, cheerCount: cheers.get(e.eventId) || 0,
  }));
  return { rows, weeks };
}

// ── 주간 서머리 (2026-10-19) ── 달력 한 줄(일~토)마다 '주간:' 이름과 메모. 보기는 누구나, 쓰기는 관리자(전도부).

async function allWeeks() {
  let rows = [];
  try { rows = await selectAll(() => db().from('calendar_weeks').select('*').order('week_start')); } catch (e) { return []; }   // 표가 아직 없으면(0021 적용 전) 달력은 그대로
  return rows.map((w) => ({ weekStart: String(w.week_start).slice(0, 10), theme: w.theme, memo: w.memo, updatedBy: w.updated_by, updatedAt: fmtTs(w.updated_at) }));
}

async function saveCalendarWeek(body) {
  const mid = clip(body.memberId, 40);
  if (!mid || !(await isAdmin(mid))) return { error: '주간 서머리는 관리자(전도부)만 쓸 수 있어요.' };
  const weekStart = clip(body.weekStart, 10);
  if (!isDate(weekStart) || new Date(weekStart + 'T00:00:00Z').getUTCDay() !== 0) return { error: '주 시작(일요일) 날짜가 올바르지 않아요.' };
  const theme = clip(body.theme, 40), memo = clip(body.memo, 1000);
  if (!theme && !memo) {   // 둘 다 비우면 지운다
    await run(db().from('calendar_weeks').delete().eq('week_start', weekStart));
    return { ok: true, removed: true };
  }
  const who = (await findTeacher(mid))?.name || clip(body.name, 20) || mid;
  await run(db().from('calendar_weeks').upsert({ week_start: weekStart, theme, memo, updated_by: who, updated_at: kstDateTime() }, { onConflict: 'week_start' }));
  return { ok: true };
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
  // 2026-10-15: 주관 부서 · 문의(이름·전화) — 보내는 화면에서만 고친다(옛 화면이 지우지 않게).
  if ('hostDept' in ev) fields.host_dept = clip(ev.hostDept, 30);
  if ('contactName' in ev) fields.contact_name = clip(ev.contactName, 20);
  if ('contactPhone' in ev) fields.contact_phone = clip(String(ev.contactPhone || '').replace(/[^0-9-]/g, ''), 20);
  // 2026-10-19: 강조(빨간 불빛 점)는 공식 일정만. 보내는 화면에서만 고친다.
  if ('highlight' in ev) fields.highlight = category === '공식' && !!ev.highlight;
  const mid = clip(body.memberId, 40);
  // 앱 화면(memberId 를 보냄)에서 공식 일정은 관리자만 — 일반 교사에게는 관리자 페이지 안내.
  if (mid && category === '공식' && !(await isAdmin(mid))) return { error: '공식 일정은 관리자 페이지에서 등록·수정해요.' };
  const eventId = clip(ev.eventId, 40);
  if (eventId) {
    const [row] = await run(db().from('calendar_events').select('id, repeat_days, category, created_by').eq('event_id', eventId).limit(1));
    if (row) {
      // 삭제와 같은 규칙: 공식 일정이 아니면 등록한 본인만 고친다(memberId 를 보내는 화면에서만 확인).
      if (mid && toEvent(row).category === '공식' && !(await isAdmin(mid))) return { error: '공식 일정은 관리자 페이지에서 수정해요.' };
      if (mid && toEvent(row).category !== '공식' && !sameId(row.created_by, mid)) {
        return { error: '본인이 등록한 일정만 수정할 수 있습니다.' };
      }
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
  await run(db().from('event_cheers').update({ status: '삭제' }).eq('event_id', eventId));
  return { ok: true };
}

// ── 응원 댓글 + 행사 사진 (2026-10-15) ── 공식·부서 일정마다. 사진은 R2 에 올리고 주소만 저장.

const CHEER_PHOTO_MAX = 44000;   // 앱이 줄여 보내는 사진(data:image) 한 장 한도 — 광장 글 사진과 같음

async function cheerCounts() {
  const rows = await selectAll(() => db().from('event_cheers').select('event_id').eq('status', '게시').order('id'));
  const counts = new Map();
  for (const r of rows) counts.set(r.event_id, (counts.get(r.event_id) || 0) + 1);
  return counts;
}

const toCheer = (c, viewer) => ({
  cheerId: c.cheer_id, memberId: c.member_id, name: c.name, dept: c.dept, body: c.body, photos: c.photos || [],
  createdAt: fmtTs(c.created_at), isMine: !!viewer && sameId(c.member_id, viewer),
});

/** 응원·사진을 달 수 있는 일정인가(내 일정은 혼자 보는 것이라 없음). */
async function cheerableEvent(eventId) {
  const [row] = await run(db().from('calendar_events').select('event_id, category').eq('event_id', eventId).limit(1));
  return row && toEvent(row).category !== '내일정' ? row : null;
}

async function getEventCheers(body) {
  const eventId = clip(body.eventId, 40);
  const me = clip(body.memberId, 40);
  const rows = await selectAll(() => db().from('event_cheers').select('*').eq('event_id', eventId).eq('status', '게시').order('id'));
  return { rows: rows.map((c) => toCheer(c, me)) };
}

async function saveEventCheer(body) {
  const me = clip(body.memberId, 40);
  const eventId = clip(body.eventId, 40);
  if (!me) return { error: '로그인 정보가 없습니다.' };
  if (!(await cheerableEvent(eventId))) return { error: '응원을 남길 수 없는 일정이에요.' };
  const text = clip(body.body, 500);
  const raw = (Array.isArray(body.photos) ? body.photos : []).slice(0, 4)
    .filter((p) => /^data:image\//.test(String(p || '')) && String(p).length <= CHEER_PHOTO_MAX);
  if (!text && !raw.length) return { error: '응원 글이나 사진을 넣어 주세요.' };
  const photos = (await Promise.all(raw.map((p) => storeImage(p, 'event')))).filter(Boolean);
  const t = (await findTeacher(me)) || {};
  const row = {
    cheer_id: newId('CH'), event_id: eventId, member_id: me, name: clip(t.name || body.name, 30), dept: t.dept || '',
    body: text, photos, created_at: kstDateTime(),
  };
  const [saved] = await run(db().from('event_cheers').insert(row).select());
  return { ok: true, cheer: toCheer(saved, me) };
}

/** 내가 쓴 응원만(관리자는 모두) 지운다. */
async function deleteEventCheer(body) {
  const me = clip(body.memberId, 40);
  const [row] = await run(db().from('event_cheers').select('id, member_id').eq('cheer_id', clip(body.cheerId, 40)).limit(1));
  if (!row) return { error: '응원을 찾지 못했어요.' };
  if (!me || (!sameId(row.member_id, me) && !(await isAdmin(me)))) return { error: '내가 쓴 응원만 지울 수 있어요.' };
  await run(db().from('event_cheers').update({ status: '삭제' }).eq('id', row.id));
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
  getCalendarEvents, saveCalendarEvent, deleteCalendarEvent, saveCalendarWeek, getEventCheers, saveEventCheer, deleteEventCheer,
  applyEventStaff, cancelEventStaff, applyEventAttendee, deleteEventAttendee, getMyEventSignups, getCalendarReport,
  getCalendarAds, saveCalendarAd, deleteCalendarAd,
  getAdQuestions, saveAdQuestion, deleteAdQuestion, answerAdQuestion,
};
