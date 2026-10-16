// 교육 관리 점검: ZZTEST 과정으로 루틴(출석·과제·시험) → 고정 QR 출석 → 텔레그램 제출·점수 → 자동 서머리 → 취합을 거친 뒤 모두 지운다.
// 텔레그램은 가짜(실제 방에 안 감). node --env-file=.env tools/smoke-cohorts.mjs
process.env.ATT_BOT_TOKEN = 'TEST';
process.env.ATT_ADMIN_CHAT = '-1';   // 가짜 기본 방(보내는 글은 아래 가짜 fetch 가 받음)
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
const { actions } = await import('../server/registry.js');
const { settled } = await import('../server/lib/background.js');
const { db, run } = await import('../server/lib/db.js');
const { kstDate } = await import('../server/lib/util.js');
const { handleAttendUpdate } = await import('../server/actions/cohort-bot.js');
const { cohortTick } = await import('../server/actions/cohort-tick.js');

const OWNER = { memberId: '0020113000010', name: '김정권' };
const call = async (action, body = {}, who = OWNER) => {
  const res = await actions[action]({ action, ...who, ...body });
  if (res && res.error) console.log(`  ${action} → 오류: ${res.error}`);
  return res;
};
const ok = (cond, label) => { console.log(`${cond ? '✔' : '✘'} ${label}`); if (!cond) process.exitCode = 1; };
let msgId = 1;
const say = async (fromId, text) => {
  sent.length = 0;
  await handleAttendUpdate({ message: { message_id: msgId++, chat: { id: TG_CHAT, type: 'supergroup', title: 'ZZTEST방' }, from: { id: fromId, first_name: 'tg' + fromId }, text } });
  return sent.join('\n');
};
const A = { memberId: '0099999000001', name: 'ZZTEST하나' };
const B = { memberId: '0099999000003', name: 'ZZTEST둘' };
const today = kstDate();
const shift = (n) => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const WD = '일월화수목금토';
const todayWd = WD[new Date(today + 'T00:00:00Z').getUTCDay()];

let cohortId;
try {
  ok((await call('cohortList', {}, { memberId: '0099999000002', name: 'x' })).error, '7777 아니면 막힘');
  cohortId = (await call('cohortSave', { cohort: { title: 'ZZTEST 교육', tgChat: String(TG_CHAT) } })).cohortId;
  ok(!!cohortId, '과정 만들기');
  const add = await call('cohortAddMembers', { cohortId, members: [{ church: '전주', ...A }, { church: '장수', ...B }] });
  ok(add.added === 2, '교육생 2명');

  // ① 출석 루틴: 어제~6일 뒤, 오늘 요일 포함 매일, 00:00~23:59
  ok((await call('cohortSave', { cohort: { cohortId, title: 'ZZTEST 교육', tgChat: String(TG_CHAT), startDate: shift(-1), endDate: shift(6), days: '월화수목금토일', startTime: '00:00', endTime: '23:59' } })).ok, '출석 루틴 저장');
  const sch = await call('cohortMakeSchedule', { cohortId });
  ok(sch.ok && sch.created === 7 && sch.days === 8, `일정 만들기 (교육 ${sch.days}일, 새로 ${sch.created}개 — 어제는 지난날이라 안 만듦)`);
  const sch2 = await call('cohortMakeSchedule', { cohortId });
  ok(sch2.created === 0, '다시 눌러도 중복 안 생김');
  const att = await call('submitAttendance', { meetingId: cohortId, method: 'qr' }, A);
  ok(att.ok, '고정 QR(과정 번호)로 오늘 모임에 출석');
  const info = await call('getAttendMeeting', { meetingId: cohortId }, B);
  ok(info.meeting && info.meeting.date === today, '고정 QR → 오늘 모임 정보');

  // ② 과제 루틴 2개(매일) + 한번 과제
  const a1 = await call('cohortSaveAssignment', { cohortId, assignment: { title: '천국 가는 항해자', repeat: '매일', dueTime: '00:00' } });
  const a2 = await call('cohortSaveAssignment', { cohortId, assignment: { title: '노트 정리', repeat: '요일', days: todayWd, dueTime: '00:00' } });
  ok(a1.ok && a2.ok, '과제 루틴 2개(매일·요일)');
  let r = await say(TG_STUDENT, '제출 ZZTEST하나 오늘 내용');
  ok(/어느 과제/.test(r) && /항해자/.test(r) && /노트/.test(r), '과제가 둘이면 어느 과제인지 물음');
  r = await say(TG_STUDENT, '제출 항해자 오늘 항해 내용');
  ok(/ZZTEST하나.*천국 가는 항해자.*제출 기록/.test(r) && /1\/2명/.test(r), '이름 연결 뒤 "제출 항해자 …" (' + r.split('\n')[0] + ')');
  r = await say(TG_STUDENT, '제출 노트 정리했어요');
  ok(/노트 정리.*제출 기록/.test(r), '"제출 노트 …"');
  r = await say(TG_STUDENT, '제출 어제 항해자 어제 것');
  ok(/항해자.*제출 기록/.test(r) && /늦게 냄/.test(r), '"제출 어제 항해자 …" → 어제 날짜·늦음 (' + r.split('\n')[0] + ')');

  // ③ 시험 루틴 + 점수
  const ex = await call('cohortSaveExam', { cohortId, exam: { subject: '계시록', days: todayWd, dueTime: '00:00' } });
  ok(ex.ok, '시험 루틴');
  r = await say(TG_ADMIN, '점수 계 시 록 ZZTEST하나 85 ZZTEST둘 92');
  ok(/계시록.*2명 기록/.test(r), '점수(띄어쓰기 달라도 루틴 과목으로) (' + r.split('\n')[0] + ')');

  // 상세 숫자
  const d = await call('cohortDetail', { cohortId });
  const h = d.assignments.find((x) => x.title === '천국 가는 항해자');
  ok(d.todayMeetings.length === 1 && d.todayMeetings[0].count === 1, '오늘 출석 1/2');
  ok(h.onToday && h.doneToday === 1 && h.dayCount >= 1, `항해자 오늘 1/2 (누적 ${h.doneAll}/${h.expectAll})`);
  ok(d.examRoutines[0].doneToday === 2, '오늘 시험 점수 2/2');

  // 자동 서머리: 오늘 모임을 00:00에 끝난 것으로 바꾸고 돌림
  const todayMt = d.todayMeetings[0].meetingId;
  await run(db().from('attend_meetings').update({ end_time: '00:00' }).eq('meeting_id', todayMt));
  sent.length = 0;
  const done = await cohortTick();
  const all = sent.join('\n---\n');
  if (process.env.DEBUG) console.log(all, done);
  ok(/출석 마감/.test(all) && /출석 1\/2명/.test(all) && /결석 1명: ZZTEST둘/.test(all), '자동 서머리: 출석 결과·결석 명단');
  ok(/과제 마감 — 천국 가는 항해자/.test(all) && /미제출 1명: ZZTEST둘/.test(all), '자동 서머리: 과제 제출·미제출');
  ok(/시험 결과 — 계시록/.test(all) && /1\. ZZTEST둘 92/.test(all), '자동 서머리: 시험 순위');
  sent.length = 0;
  await cohortTick();
  ok(!sent.some((t) => /\[ZZTEST 교육\]/.test(t)), '같은 서머리는 한 번만 (' + done.filter((x) => x.startsWith('ZZTEST')).length + '건 보냄)');

  // 취합
  const sh = await call('cohortSheet', { cohortId });
  const rowA = sh.rows.find((x) => x.name === 'ZZTEST하나');
  const ti = sh.dates.indexOf(today);
  ok(rowA.daily[ti].includes('항해자') && rowA.daily[ti].includes('정리') && /출석|지각/.test(rowA.attend[ti]), '취합 표: 오늘 출석·과제 칸 (' + rowA.daily[ti] + ')');
  ok(sh.submissions.length === 3, '과제 내용 목록 3건');
  const sum = await call('cohortSendSummary', { cohortId });
  ok(/오늘/.test(sum.text) && /시험 계시록/.test(sum.text), '집계 글');
  console.log(sum.text);
} finally {
  await settled();
  if (cohortId) {
    const meetings = await run(db().from('attend_meetings').select('meeting_id').eq('cohort_id', cohortId));
    for (const m of meetings) await run(db().from('attend_records').delete().eq('meeting_id', m.meeting_id));
    for (const t of ['attend_meetings', 'cohort_submissions', 'cohort_assignments', 'cohort_members', 'cohort_scores', 'cohort_tg_links', 'cohort_exams', 'cohort_summary_log', 'cohorts']) {
      await run(db().from(t).delete().eq('cohort_id', cohortId));
    }
  }
  await run(db().from('cohort_tg_chats').delete().eq('chat_id', String(TG_CHAT)));
  await run(db().from('roster_changes').delete().like('target_name', 'ZZTEST%'));
  console.log('정리 완료');
}
