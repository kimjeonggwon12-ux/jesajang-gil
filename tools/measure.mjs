// action 하나가 DB 를 몇 번 부르고, 얼마나 받아 오고, 얼마나 걸리는지 잰다(읽기 전용 action 만).
//   node --env-file=.env tools/measure.mjs
import { db, run } from '../server/lib/db.js';
import { actions } from '../server/registry.js';

let calls = 0, bytes = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  const res = await realFetch(...args);
  if (String(args[0]?.url || args[0]).includes('supabase.co')) {
    calls++;
    bytes += Number(res.headers.get('content-length')) || (await res.clone().arrayBuffer()).byteLength;
  }
  return res;
};

const [admin] = await run(db().from('admins').select('member_id').order('id').limit(1));
const [meeting] = await run(db().from('attend_meetings').select('meeting_id').neq('status', '삭제').order('id', { ascending: false }).limit(1));
const [attendee] = await run(db().from('attend_records').select('member_id').eq('meeting_id', meeting.meeting_id).limit(1));
const member = '00230901-00011';

const cases = [
  ['로그인(checkAdmin)', { action: 'checkAdmin', memberId: member }],
  ['나의 교실 등급(getMyTierStatus)', { action: 'getMyTierStatus', memberId: member }],
  ['출석 화면 열기(getAttendMeeting)', { action: 'getAttendMeeting', meetingId: meeting.meeting_id, memberId: attendee.member_id }],
  ['출석 인원 수(getAttendCount)', { action: 'getAttendCount', meetingId: meeting.meeting_id }],
  ['명단 전체(getRoster)', { action: 'getRoster' }],
  ['부서별 현황(getDistrictReport 부녀회)', { action: 'getDistrictReport', dept: '부녀회' }],
  ['조직 요약(getOrgSummary)', { action: 'getOrgSummary' }],
  ['교사 명단 보고서(getTeacherListReport)', { action: 'getTeacherListReport' }],
  ['결산(getSettlementReport)', { action: 'getSettlementReport' }],
  ['지역 TOP3(getChurchTopRegions)', { action: 'getChurchTopRegions' }],
  ['출석 관리자 화면(getAttendAdmin)', { action: 'getAttendAdmin', memberId: admin.member_id }],
  ['광장 목록(listPlazaPosts)', { action: 'listPlazaPosts', memberId: member }],
];

await actions.checkAdmin({ memberId: member });   // 첫 연결 시간은 빼고 잰다
for (const [label, payload] of cases) {
  calls = 0; bytes = 0;
  const t = Date.now();
  await actions[payload.action](payload);
  console.log(`${label.padEnd(34)} DB ${String(calls).padStart(2)}번  ${String(Math.round(bytes / 1024)).padStart(5)}KB  ${String(Date.now() - t).padStart(5)}ms`);
}
