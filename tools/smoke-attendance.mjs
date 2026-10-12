// 출석 쓰기 기능 연습 점검([TEST] 모임이라 알림은 가지 않는다. 시험 계정으로 만들고 끝에 지운다).
//   node --env-file=.env tools/smoke-attendance.mjs
import assert from 'node:assert/strict';
import { db, run } from '../server/lib/db.js';
import { kstDate, kstDateTime } from '../server/lib/util.js';
import { actions as a } from '../server/registry.js';

const ADMIN = 'ZZTEST-9000041', T1 = 'ZZTEST-9000042', T2 = 'ZZTEST-9000043';
const made = [];
try {
  await run(db().from('admins').insert({ member_id: ADMIN, name: '시험관리자', dept: '전도부', position: '서기' }));
  await a.upsertRosterLeader({ memberId: T1, name: '시험교사1', dept: '부녀회', region: '03지역', position: '' });

  const today = kstDate();
  const now = kstDateTime().slice(11, 16);
  assert.match((await a.saveAttendMeeting({ memberId: T1, meeting: { title: 'x', date: today } })).error, /관리자만/);
  assert.match((await a.saveAttendMeeting({ memberId: ADMIN, meeting: { title: 'x', date: today, district: 3 } })).error, /부서를 먼저/);
  const meeting = await a.saveAttendMeeting({ memberId: ADMIN, meeting: {
    title: '[TEST] 시험 모임', date: today, start: '00:01', end: '23:58', openBefore: 30, org: '부녀', district: '3지역',
    askDistrict: true, askDept: true,
    questions: [{ label: '식사', type: 'choice', options: ['예', '아니오'], required: true }, { label: '한마디', type: 'text' }, { label: '보기 없음', type: 'multi', options: [] }],
  } });
  made.push(meeting.meetingId);

  let info = await a.getAttendMeeting({ meetingId: meeting.meetingId, memberId: T1 });
  assert.equal(info.meeting.open, true); assert.equal(info.meeting.district, 3); assert.equal(info.meeting.questions.length, 2);
  assert.equal(info.mine, null); assert.deepEqual([info.me.org, info.me.district, info.me.label], ['부녀', 3, '부녀회 3지역']);

  assert.match((await a.submitAttendance({ memberId: T1, meetingId: meeting.meetingId, answers: {} })).error, /"식사" 항목/);
  assert.match((await a.submitAttendance({ memberId: T1, meetingId: meeting.meetingId, answers: { q1: '예' }, dept24: '기타' })).error, /부서 기타 칸/);
  const first = await a.submitAttendance({ memberId: T1, meetingId: meeting.meetingId, answers: { q1: '예', q2: ' 감사 ' }, pickDistrict: '5', dept24: '교육', method: 'scan' });
  assert.equal(first.ok, true);
  assert.deepEqual([first.record.name, first.record.dept, first.record.pickOrg, first.record.pickDistrict, first.record.dept24, first.record.method],
    ['시험교사1', '부녀회', '부녀', 5, '교육', '앱스캔']);
  assert.match(first.record.late, /분 지각/); assert.deepEqual(first.record.answers, { q1: '예', q2: '감사' });
  const again = await a.submitAttendance({ memberId: T1, meetingId: meeting.meetingId, answers: { q1: '아니오' } });
  assert.equal(again.already, true); assert.equal(again.record.recordId, first.record.recordId);

  // 명단에 없는 사람: 보낸 이름을 쓰고, 지역을 안 고르면 고르지 않은 것으로
  const second = await a.submitAttendance({ memberId: T2, name: '손님', meetingId: meeting.meetingId, answers: { q1: '아니오' }, dept24: '기타', dept24Etc: '안내' });
  assert.deepEqual([second.record.name, second.record.pickOrg, second.record.pickDistrict, second.record.dept24], ['손님', '부녀', '', '기타(안내)']);

  // 동시에 여러 번 눌러도 한 번만 기록된다
  const burst = await Promise.all(Array.from({ length: 5 }, () => a.submitAttendance({ memberId: 'ZZTEST-9000044', name: '동시', meetingId: meeting.meetingId, answers: { q1: '예' } })));
  assert.equal(burst.every((r) => r.ok), true); assert.equal(new Set(burst.map((r) => r.record.recordId)).size, 1);
  assert.equal((await a.getAttendCount({ meetingId: meeting.meetingId })).count, 3);

  info = await a.getAttendMeeting({ meetingId: meeting.meetingId, memberId: T1 });
  assert.equal(info.mine.recordId, first.record.recordId);
  const mine = await a.getMyAttendance({ memberId: T1 });
  assert.equal(mine.records.length, 1); assert.equal(mine.meetings.some((m) => m.meetingId === meeting.meetingId), true);
  const admin = await a.getAttendAdmin({ memberId: ADMIN, filterOrg: '부녀', filterDistrict: '3' });
  assert.equal(admin.meetings.find((m) => m.meetingId === meeting.meetingId).count, 3);

  // 저녁 시작을 지금 이후로 잡으면(15시 이후에 돌릴 때) 지각이 풀린다 — 어느 쪽이든 다시 계산은 돌아야 한다
  const evening = await a.attSetEveningStart({ memberId: ADMIN, meetingId: meeting.meetingId, start2: '23:59' });
  assert.equal(evening.start2, '23:59'); assert.equal(evening.recalculated, now >= '15:00' ? 3 : 0);

  // 마감 파일(보내지 않음)
  const file = await a.attSendClosing({ memberId: ADMIN, meetingId: meeting.meetingId, dryRun: true });
  assert.match(file.fileName, /^출석_\d{4}-\d\d-\d\d_.*시험 모임\.xlsx$/); assert.match(file.caption, /부녀 3/);
  assert.equal(Buffer.from(file.base64, 'base64').subarray(0, 2).toString(), 'PK');

  // 닫으면 출석이 막힌다
  await a.saveAttendMeeting({ memberId: ADMIN, meeting: { meetingId: meeting.meetingId, title: '[TEST] 시험 모임', date: today, start: '00:01', end: '23:58', status: '닫힘' } });
  assert.match((await a.submitAttendance({ memberId: 'ZZTEST-9000045', meetingId: meeting.meetingId })).error, /마감했어요/);

  assert.equal((await a.deleteAttendRecord({ memberId: ADMIN, recordId: second.record.recordId })).ok, true);
  assert.equal((await a.getAttendCount({ meetingId: meeting.meetingId })).count, 2);
  assert.equal((await a.attAutoSummary({ key: 'wrong' })).error, 'key');
  assert.equal((await a.attTestCleanup({ memberId: ADMIN, meetingId: meeting.meetingId })).removed, 2);
  assert.match((await a.getAttendMeeting({ meetingId: meeting.meetingId })).error, /찾을 수 없어요/);
  console.log('쓰기 점검 통과');
} finally {
  if (made.length) {
    await run(db().from('attend_records').delete().in('meeting_id', made));
    await run(db().from('attend_meetings').delete().in('meeting_id', made));
  }
  await run(db().from('admins').delete().eq('member_id', ADMIN));
  await run(db().from('teachers').delete().eq('member_id', T1));
}
