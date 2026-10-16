// 교육 과정 점검: ZZTEST 과정을 만들고 교육생·출석 모임·과제·제출을 거친 뒤 모두 지운다.
// 텔레그램은 보내지 않는다(봇 토큰을 지우고 돌림). node --env-file=.env tools/smoke-cohorts.mjs
// 텔레그램은 가짜로 바꿔 둔다: 보낸 글은 sent 에 쌓이고, 방 관리자 확인은 TG_ADMIN 사용자만 통과.
process.env.ATT_BOT_TOKEN = 'TEST';
const sent = [];
const TG_ADMIN = 777, TG_STUDENT = 555, TG_CHAT = -100999000111;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (!String(url).startsWith('https://api.telegram.org/')) return realFetch(url, opts);
  const method = String(url).split('/').pop();
  const body = opts && typeof opts.body === 'string' ? JSON.parse(opts.body) : {};
  if (method === 'sendMessage') sent.push(body.text);
  const result = method === 'getChatMember' ? { status: body.user_id === TG_ADMIN ? 'administrator' : 'member' } : {};
  return new Response(JSON.stringify({ ok: true, result }), { headers: { 'Content-Type': 'application/json' } });
};
const { handleAttendUpdate } = await import('../server/actions/cohort-bot.js');
let msgId = 1;
const say = async (fromId, text, extra = {}) => {
  sent.length = 0;
  await handleAttendUpdate({ message: { message_id: msgId++, chat: { id: TG_CHAT, type: 'supergroup', title: 'ZZTEST방' }, from: { id: fromId, first_name: 'tg' + fromId }, text, ...extra } });
  return sent.join('\n');
};
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
  // ── 텔레그램 방 ──
  ok((await call('cohortSave', { cohort: { cohortId, title: 'ZZTEST 교육', useAttend: true, useAssign: true, tgChat: String(TG_CHAT) } })).ok, '과정에 텔레그램 방 연결');
  let r = await say(TG_STUDENT, '제출 오늘 배운 것');
  ok(/이름을 함께/.test(r), '처음엔 이름 없이 제출하면 이름을 물음');
  r = await say(TG_STUDENT, '제출 ZZTEST둘 ZZTEST 과제 텔레그램으로 냄');
  ok(/ZZTEST둘.*ZZTEST 과제 제출 기록/.test(r) && /2\/2명/.test(r), '이름+과제이름으로 제출 → 기록 (' + r.split('\n')[0] + ')');
  r = await say(TG_STUDENT, '제출 고친 내용');
  ok(/다시 제출/.test(r), '두 번째부터는 이름 없이 제출(연결됨)');
  const subs2 = await call('cohortSubmissions', { assignmentId: as.assignmentId });
  const tgSub = subs2.submissions.find((x) => x.name === 'ZZTEST둘');
  ok(tgSub && tgSub.content === '고친 내용', '제출 내용 저장 (' + (tgSub && tgSub.content) + ')');
  r = await say(TG_STUDENT, '점수 계시록 ZZTEST둘 100');
  ok(/관리자만/.test(r), '점수는 방 관리자만');
  r = await say(TG_ADMIN, '점수 계시록 ZZTEST교육생 85 ZZTEST둘 92.5 없는사람 70');
  ok(/계시록.*2명 기록/.test(r) && /없는사람/.test(r), '점수 한 줄 입력 (' + r.replace(/\n/g, ' / ') + ')');
  r = await say(TG_ADMIN, '점수 신학 10/15\nZZTEST교육생 77\nZZTEST둘: 88점');
  ok(/신학 \(10\/15\).*2명 기록/.test(r), '점수 여러 줄 + 날짜 (' + r.split('\n')[0] + ')');
  r = await say(TG_ADMIN, '점수 계시록 ZZTEST교육생 90');
  ok(/1명 기록/.test(r) && /2\/2명/.test(r), '같은 날 같은 과목 다시 올리면 고쳐짐');
  const sheet = await call('cohortSheet', { cohortId });
  const row = sheet.rows.find((x) => x.name === 'ZZTEST교육생');
  ok(sheet.exams.length === 2 && row.scores.includes(90) && row.scores.includes(77), '취합 표: 시험 2회, 점수 반영 (' + JSON.stringify(row.scores) + ')');
  r = await say(TG_ADMIN, '집계');
  ok(/시험/.test(r) && /평균/.test(r), '방에서 "집계"');
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
    await run(db().from('cohort_scores').delete().eq('cohort_id', cohortId));
    await run(db().from('cohort_tg_links').delete().eq('cohort_id', cohortId));
    await run(db().from('cohort_tg_chats').delete().eq('chat_id', String(TG_CHAT)));
    await run(db().from('cohorts').delete().eq('cohort_id', cohortId));
  }
  await run(db().from('roster_changes').delete().like('target_name', 'ZZTEST%'));
  console.log('정리 완료');
}
