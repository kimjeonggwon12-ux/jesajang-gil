// 출석 부하 시험: [TEST] 모임을 만들어 여러 명이 한꺼번에 출석하는 상황을 실제 서버에 건다.
// [TEST] 모임이라 알림은 가지 않고, 끝나면 모임·기록·시험용 관리자를 지운다.
//   node --env-file=.env tools/load-attendance.mjs [사람 수=300] [동시에=60] [서버 주소]
import { db, run } from '../server/lib/db.js';
import { kstDate } from '../server/lib/util.js';

const PEOPLE = Number(process.argv[2] || 300);
const CONCURRENCY = Number(process.argv[3] || 60);
const API = process.argv[4] || 'https://jesajang-gil.vercel.app/api';
const ADMIN = 'ZZTEST-9900000000001';

async function call(payload) {
  const t = Date.now();
  try {
    const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
    return { json: await r.json(), ms: Date.now() - t, status: r.status };
  } catch (e) {
    return { json: { error: String(e.message || e) }, ms: Date.now() - t, status: 0 };
  }
}
const pick = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
const summary = (times) => { const s = [...times].sort((a, b) => a - b); return `중간 ${pick(s, 0.5)}ms · 95% ${pick(s, 0.95)}ms · 최대 ${s.at(-1)}ms`; };

let meetingId = null;
try {
  await run(db().from('admins').insert({ member_id: ADMIN, name: '부하시험', dept: '전도부', position: '서기' }));
  const made = await call({ action: 'saveAttendMeeting', memberId: ADMIN, meeting: {
    title: '[TEST] 부하 시험', date: kstDate(), start: '00:01', end: '23:58', openBefore: 30, askDept: true,
    questions: [{ label: '식사', type: 'choice', options: ['예', '아니오'], required: true }],
  } });
  meetingId = made.json.meetingId;
  if (!meetingId) throw new Error('모임을 만들지 못했습니다: ' + JSON.stringify(made.json));
  console.log(`서버 ${API}\n모임 ${meetingId} — ${PEOPLE}명이 동시에 ${CONCURRENCY}명씩 출석`);

  // 1) 출석 화면 열기 → 2) 출석 누르기 (한 사람이 실제로 하는 순서)
  const people = Array.from({ length: PEOPLE }, (_, i) => 'ZZTEST-99000' + String(i + 1).padStart(6, '0'));
  const opens = [], submits = [], failures = [];
  const queue = [...people];
  const started = Date.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (let memberId; (memberId = queue.shift());) {
      const open = await call({ action: 'getAttendMeeting', meetingId, memberId });
      opens.push(open.ms);
      const sent = await call({ action: 'submitAttendance', meetingId, memberId, name: '시험' + memberId.slice(-4), answers: { q1: '예' }, dept24: '교육' });
      submits.push(sent.ms);
      if (!sent.json.ok) failures.push(sent.json.error || 'HTTP ' + sent.status);
    }
  }));
  const seconds = (Date.now() - started) / 1000;

  // 같은 사람들이 한 번 더 누른다 → 전부 "이미 출석"이어야 한다
  const again = await Promise.all(people.slice(0, 50).map((memberId) => call({ action: 'submitAttendance', meetingId, memberId, answers: { q1: '예' } })));
  const count = (await call({ action: 'getAttendCount', meetingId })).json.count;

  console.log(`걸린 시간 ${seconds.toFixed(1)}초 (초당 ${(PEOPLE / seconds).toFixed(1)}명)`);
  console.log(`화면 열기  ${summary(opens)}`);
  console.log(`출석 누르기 ${summary(submits)}`);
  console.log(`실패 ${failures.length}건${failures.length ? ' — ' + [...new Set(failures)].slice(0, 3).join(' / ') : ''}`);
  console.log(`기록된 출석 ${count}명 (기대 ${PEOPLE}명) · 다시 누른 50명 중 "이미 출석" ${again.filter((r) => r.json.already).length}명`);
} finally {
  if (meetingId) {
    const cleaned = await call({ action: 'attTestCleanup', memberId: ADMIN, meetingId });
    console.log('정리: 기록', cleaned.json.removed ?? cleaned.json.error, '건 삭제');
    await run(db().from('attend_records').delete().eq('meeting_id', meetingId));
    await run(db().from('attend_meetings').delete().eq('meeting_id', meetingId));
  }
  await run(db().from('admins').delete().eq('member_id', ADMIN));
}
