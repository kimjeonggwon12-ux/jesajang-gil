// 교육 권한은 현재 관리자 자격 + 과정/모임별 명시 위임으로 판단한다.
// 담당자 이름·전화, 과정 생성자, 텔레그램 방 관리자 여부는 권한 근거가 아니다.
import { db, run } from './db.js';
import { requireActor, AccessError } from './request-context.js';
import { isAdmin, isOwner } from '../actions/roster.js';

export const EDUCATION_TASKS = Object.freeze({ settings: '과정 설정', members: '교육생', schedule: '일정표', attendance: '출석', assignments: '과제', exams: '시험·점수', reports: '자료 다운로드·집계 전달' });
export const educationTasksForScope = type => type === 'cohort' ? EDUCATION_TASKS : type === 'series' ? {attendance:EDUCATION_TASKS.attendance,reports:EDUCATION_TASKS.reports,members:'교육 재적',settings:'집계 기준'} : {attendance:EDUCATION_TASKS.attendance,reports:EDUCATION_TASKS.reports};
export const requireEducationOwner = () => {
  const actor = requireActor();
  if (!isOwner(actor.nid)) throw new AccessError('앱 관리자만 담당자를 지정하거나 새 교육을 만들 수 있어요.');
  return actor;
};
export async function educationGrants(actor = requireActor()) {
  if (isOwner(actor.nid)) return null;
  if (!(await isAdmin(actor.nid))) return [];
  return run(db().from('education_delegations').select('scope_type, scope_id, permissions').eq('nid', actor.nid).eq('revoked', false));
}
export const permits = (grants, type, id, task) => grants === null || grants.some(g => g.scope_type === type && g.scope_id === id && (task === 'view' ? g.permissions.length : g.permissions.includes(task)));
export async function requireEducationScope(type, id, task, actor = requireActor()) {
  if (!id || !permits(await educationGrants(actor), type, id, task)) throw new AccessError('이 교육의 해당 업무를 맡은 담당자만 할 수 있어요.');
  const def = {cohort:['cohorts','cohort_id'],meeting:['attend_meetings','meeting_id'],series:['attend_series','series_id']}[type];
  if (!def) throw new AccessError('교육 종류를 확인해 주세요.');
  const [scope] = await run(db().from(def[0]).select(def[1]).eq(def[1],id).neq('status','삭제').limit(1));
  if (!scope) throw new AccessError('교육을 찾을 수 없어요.',404);
  return actor;
}
export async function meetingScope(meetingId) {
  const [m] = await run(db().from('attend_meetings').select('meeting_id, cohort_id, series_id').eq('meeting_id', meetingId).neq('status', '삭제').limit(1));
  if (!m) throw new AccessError('출석 모임을 찾을 수 없어요.', 404);
  return m.cohort_id ? ['cohort', m.cohort_id] : m.series_id ? ['series', m.series_id] : ['meeting', m.meeting_id];
}
export async function requireMeetingTask(id, task = 'attendance') {
  const [type, scope] = await meetingScope(id);
  return requireEducationScope(type, scope, task);
}

const COURSE_TASK = {
  cohortDetail:'view', cohortTimetable:'view', cohortSheet:'view',
  cohortAddMembers:'members', cohortSetOrder:'members', cohortRemoveMember:'members',
  cohortMakeSchedule:'attendance', cohortCreateMeeting:'attendance', cohortLinkMeeting:'attendance', cohortSetAttendance:'attendance',
  cohortSaveAssignment:'assignments', cohortSubmissions:'assignments', cohortDayWork:'assignments',
  cohortSaveExam:'exams', cohortSetScore:'exams',
  cohortSaveItem:'schedule', cohortDeleteItem:'schedule', cohortImportTimetable:'schedule', cohortCopyDay:'schedule',
  cohortSendSummary:'reports', cohortSendBoard:'reports', cohortSendText:'reports', cohortBoardImage:'view',
};
// export된 웹 액션 각각에 적용한다. cron/봇의 내부 자료 함수에는 별도 진입점 검사를 둔다.
export function protectCourses(actions) {
  return Object.fromEntries(Object.entries(actions).map(([name, fn]) => [name, async body => {
    if (name === 'cohortList') return fn(body);
    let id = String(body.cohortId || ''), task = COURSE_TASK[name];
    if (name === 'cohortSave') {
      id = String(body.cohort?.cohortId || ''); task = 'settings';
      if (!id) { requireEducationOwner(); return fn(body); }
      // 발송 대상 방 변경은 자료 유출에 영향: 위임받은 과정 설정에 포함하지 않는다.
      if (!isOwner(requireActor().nid)) {
        const [c] = await run(db().from('cohorts').select('tg_chat, status').eq('cohort_id', id).limit(1));
        if (!c || (body.cohort.tgChat != null && String(body.cohort.tgChat) !== c.tg_chat) || body.cohort.status === '삭제') throw new AccessError('텔레그램 방 변경과 과정 삭제는 앱 관리자만 할 수 있어요.');
        body = {...body, cohort: {...body.cohort, tgChat:c.tg_chat}}; // 생략도 빈 방으로 덮어쓰는 우회가 되지 않게 보존한다.
      }
    }
    if (name === 'cohortSubmissions') {
      const [a] = await run(db().from('cohort_assignments').select('cohort_id').eq('assignment_id', String(body.assignmentId || '')).limit(1));
      if (!a || (id && id !== a.cohort_id)) throw new AccessError('이 교육의 과제가 아니에요.');
      id = a.cohort_id;
    }
    if (name === 'cohortSheet' && body.content) task = 'reports';
    if (!task) throw new AccessError('교육 권한 설정을 확인해 주세요.');
    await requireEducationScope('cohort', id, task);
    const [c] = await run(db().from('cohorts').select('cohort_id').eq('cohort_id', id).neq('status', '삭제').limit(1));
    if (!c) throw new AccessError('교육 과정을 찾을 수 없어요.', 404);
    const nested = name === 'cohortSaveAssignment' ? ['cohort_assignments','assignment_id',body.assignment?.assignmentId]
      : name === 'cohortSaveExam' ? ['cohort_exams','exam_id',body.exam?.examId]
      : name === 'cohortSaveItem' ? ['cohort_schedule','item_id',body.item?.itemId] : null;
    if (nested?.[2]) {
      const [item] = await run(db().from(nested[0]).select('cohort_id').eq(nested[1],String(nested[2])).limit(1));
      if (!item || item.cohort_id !== id) throw new AccessError('다른 교육의 항목은 변경할 수 없어요.');
    }
    if (name === 'cohortLinkMeeting') {
      const [type, scope] = await meetingScope(String(body.meetingId || ''));
      if (type === 'cohort' && scope !== id) throw new AccessError('다른 과정의 출석 모임이에요.');
      if (!body.on && (type !== 'cohort' || scope !== id)) throw new AccessError('이 과정에 연결된 모임만 해제할 수 있어요.');
      // 연결/해제로 권한 경계를 바꾸는 일은 지정 권한을 가진 앱 관리자만 한다.
      requireEducationOwner();
    }
    return fn(body);
  }]));
}
