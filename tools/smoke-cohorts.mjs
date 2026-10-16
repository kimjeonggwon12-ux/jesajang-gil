// 교육 과정 점검: ZZTEST 과정을 만들고 교육생·출석 모임·과제·제출을 거친 뒤 모두 지운다.
// 텔레그램은 보내지 않는다(봇 토큰을 지우고 돌림). node --env-file=.env tools/smoke-cohorts.mjs
delete process.env.ATT_BOT_TOKEN;
const { actions } = await import('../server/registry.js');
const { settled } = await import('../server/lib/background.js');
const { db, run } = await import('../server/lib/db.js');

const OWNER = { memberId: '0020113000010', name: '김정권' };
const call = async (action, body = {}, who = OWNER) => {
  const res = await actions[action]({ action, ...who, ...body });
  if (res && res.error) console.log(`  ${action} → 오류: ${res.error}`);
  return res;
};
const ok = (cond, label) => { console.log(`${cond ? '✔' : '✘'} ${label}`); if (!cond) process.exitCode = 1; };
const STUDENT = { memberId: '0099999000001', name: 'ZZTEST교육생' };

let cohortId;
try {
  ok((await call('cohortList', {}, { memberId: '0099999000002', name: 'x' })).error, '주인 아닌 사람은 막힘');
  const made = await call('cohortSave', { cohort: { title: 'ZZTEST 교육', useAttend: true, useAssign: true } });
  cohortId = made.cohortId;
  ok(made.ok && cohortId, '과정 만들기');
  const add = await call('cohortAddMembers', { cohortId, members: [{ church: '전주', ...STUDENT }, { church: '장수', name: 'ZZTEST둘', memberId: '0099999000003' }, { ...STUDENT, church: '전주' }, { name: '번호없음', memberId: '' }] });
  ok(add.added === 2 && add.skipped.length === 2, `교육생 2명 등록 + 2명 제외 (${add.added}, ${add.skipped.map((s) => s.why).join('/')})`);
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const mt = await call('cohortCreateMeeting', { cohortId, meeting: { date: today, title: '[TEST] ZZTEST 출석', start: '00:00', end: '23:59' } });
  ok(mt.ok, '과정 출석 모임 만들기');
  const att = await call('submitAttendance', { meetingId: mt.meetingId, method: 'qr' }, STUDENT);
  ok(att.ok, '명단 밖 교육생도 연결된 모임에 출석');
  const wrong = await actions.submitAttendance({ meetingId: mt.meetingId, memberId: STUDENT.memberId, name: '다른이름' });
  ok(wrong.badLogin || wrong.already, '이름 틀리면 막힘(또는 이미 출석)');
  const as = await call('cohortSaveAssignment', { cohortId, assignment: { title: 'ZZTEST 과제', guide: '설명', due: today } });
  ok(as.ok, '과제 내기');
  const sub = await call('submitCohortAssignment', { assignmentId: as.assignmentId, content: '첫 제출' }, STUDENT);
  const sub2 = await call('submitCohortAssignment', { assignmentId: as.assignmentId, content: '고친 제출' }, STUDENT);
  ok(sub.ok && sub2.updated, '과제 제출 + 고쳐 내기');
  ok((await call('submitCohortAssignment', { assignmentId: as.assignmentId, content: 'x' }, { memberId: '0099999000009', name: 'x' })).error, '교육생 아니면 제출 막힘');
  const mine = await call('getMyCohorts', {}, STUDENT);
  const mc = mine.cohorts.find((c) => c.cohortId === cohortId);
  ok(mc && mc.meetings[0].attended && mc.assignments[0].mine.content === '고친 제출', '교육생 화면: 출석·제출 보임');
  const d = await call('cohortDetail', { cohortId });
  ok(d.members.length === 2 && d.meetings[0].count === 1 && d.assignments[0].count === 1, '관리 화면 집계');
  const subs = await call('cohortSubmissions', { assignmentId: as.assignmentId });
  ok(subs.submissions.length === 1 && subs.missing.length === 1, '제출·미제출 명단');
  const sum = await call('cohortSendSummary', { cohortId });
  console.log(sum.text);
  ok((await call('cohortRemoveMember', { cohortId, targetId: '0099999000003' })).ok, '교육생 빼기');
  const log = await call('getRosterLog');
  ok((log.rows || []).some((r) => r.kind === '교육생 추가' && r.targetName === 'ZZTEST교육생'), '변경 기록에 교육생 추가');
} finally {
  await settled();
  if (cohortId) {
    const meetings = await run(db().from('attend_meetings').select('meeting_id').eq('cohort_id', cohortId));
    for (const m of meetings) await run(db().from('attend_records').delete().eq('meeting_id', m.meeting_id));
    await run(db().from('attend_meetings').delete().eq('cohort_id', cohortId));
    await run(db().from('cohort_submissions').delete().eq('cohort_id', cohortId));
    await run(db().from('cohort_assignments').delete().eq('cohort_id', cohortId));
    await run(db().from('cohort_members').delete().eq('cohort_id', cohortId));
    await run(db().from('cohorts').delete().eq('cohort_id', cohortId));
  }
  await run(db().from('roster_changes').delete().like('target_name', 'ZZTEST%'));
  console.log('정리 완료');
}
