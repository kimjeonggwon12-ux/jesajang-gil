// 비교사 출석(교사 명단에 없는 분이 교자장부청 부서·지역·이름을 적고 출석) 점검 — [TEST] 모임을 만들고 끝에 지운다.
//   node --env-file=.env tools/smoke-attend-guest.mjs
import assert from 'node:assert/strict';
import { db, run } from '../server/lib/db.js';
import { kstDate } from '../server/lib/util.js';
import { actions as a } from '../server/registry.js';
import { closingData, regionCharts } from '../server/actions/attendance-closing.js';
import { findMeeting } from '../server/actions/attendance.js';

const HQ = { memberId: '20113000010', name: '관리자' };
const G = { memberId: '99999999-91234', name: '시험비교사' };   // 명단에 없는 번호
let meetingId = null;
try {
  const saved = await a.saveAttendMeeting({ ...HQ, meeting: { title: '[TEST] 비교사 출석 점검', date: kstDate(), start: '00:00', end: '23:59', openBefore: 0 } });
  meetingId = saved.meetingId; assert.ok(meetingId);

  // 명단에 없는 분 → 막지 않고 비교사로 안내
  const g = await a.getAttendMeeting({ ...G, meetingId });
  assert.ok(!g.badLogin, g.error); assert.equal(g.me.guest, true); assert.equal(g.mine, null);
  assert.ok(Array.isArray(g.me.sameName));

  // 고유번호 13자리가 아니면 예전처럼 다시 입력
  assert.equal((await a.getAttendMeeting({ memberId: '1234', name: 'x', meetingId })).badLogin, true);

  // 부서·지역·이름이 빠지면 오류
  assert.match((await a.submitAttendance({ ...G, meetingId })).error, /부서/);
  assert.match((await a.submitAttendance({ ...G, meetingId, guestOrg: '부녀' })).error, /지역/);
  assert.match((await a.submitAttendance({ ...G, name: ' ', meetingId, guestOrg: '부녀', guestDistrict: '3' })).error || '', /이름|명단/);

  const ok = await a.submitAttendance({ ...G, name: '시험 비교사', meetingId, guestOrg: '부녀', guestDistrict: '3' });
  assert.ok(ok.ok, ok.error);
  assert.equal(ok.record.position, '비교사'); assert.equal(ok.record.dept, '부녀회');
  assert.equal(ok.record.pickOrg, '부녀'); assert.equal(ok.record.pickDistrict, 3); assert.equal(ok.record.name, '시험비교사');
  assert.equal((await a.submitAttendance({ ...G, meetingId, guestOrg: '부녀', guestDistrict: '3' })).already, true);
  assert.equal((await a.getAttendMeeting({ ...G, meetingId })).mine.name, '시험비교사');
  console.log('✓ 명단에 없는 분 = 부서·지역·이름 적고 출석');

  // 마감 집계: 부녀회로 세고, 3지역에 비교사로 들어감
  const m = await findMeeting(meetingId, { fresh: true });
  const data = await closingData(m);
  const row = data.rows.find((r) => r.name === '시험비교사');
  assert.ok(row.guest); assert.equal(row.org, '부녀회'); assert.equal(row.region, '3지역'); assert.equal(row.fixed, false);
  assert.equal(data.box[data.sessions[0]]['부녀회'], 1);
  const charts = await regionCharts({ ...m, title: '교사교육', org: '부녀' }, data);
  const c = charts.find((x) => x.dept === '부녀회');
  assert.ok(c, '부녀회 그래프'); assert.match(c.caption, /3지역 0\/\d+명 \(0%\) \+ 비교사 1명/);
  console.log('✓ 마감: 교자장부청 부녀회 1 · 부녀회 3지역 + 비교사 1명');
  // 11/3: 네 부서 '새신자' 지역, 장년회 13지역, 청년회는 6지역까지
  const G2 = { memberId: '99999999-91235', name: '시험새신자' }, G3 = { memberId: '99999999-91236', name: '시험장년' };
  assert.match((await a.submitAttendance({ ...G2, meetingId, guestOrg: '청년', guestDistrict: '7' })).error, /지역/);
  const n2 = await a.submitAttendance({ ...G2, meetingId, guestOrg: '자문', guestDistrict: '새신자' });
  assert.ok(n2.ok, n2.error); assert.equal(n2.record.pickDistrict, '새신자');
  const n3 = await a.submitAttendance({ ...G3, meetingId, guestOrg: '장년', guestDistrict: '13' });
  assert.ok(n3.ok, n3.error); assert.equal(n3.record.pickDistrict, 13);
  const d2 = await closingData(m);
  assert.equal(d2.rows.find((r) => r.name === '시험새신자').region, '새신자');
  assert.equal(d2.rows.find((r) => r.name === '시험장년').region, '13지역');
  console.log('✓ 자문회 새신자 · 장년회 13지역 비교사');
  console.log('비교사 출석 점검 통과');
} finally {
  if (meetingId) {
    await run(db().from('attend_records').delete().eq('meeting_id', meetingId));
    await run(db().from('attend_meetings').delete().eq('meeting_id', meetingId));
  }
}
