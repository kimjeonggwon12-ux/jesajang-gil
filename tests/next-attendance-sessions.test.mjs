import {test} from 'node:test';
import assert from 'node:assert/strict';
import {surveySummary} from '../server/actions/attendance.js';
import {attendancePeople,attendanceTallies,meetingCsvRows} from '../next-app/lib/attendance-admin.ts';
test('추가 타임은 설문·모임 CSV에 포함하고 사람·부서 인원은 한 번 센다',()=>{
 const questions=[{id:'q1',label:'방법',type:'choice',options:['현장','온라인']},{id:'q2',label:'후기',type:'text',options:[]}];
 const meeting={meetingId:'MT-LOCAL',date:'2026-11-14',questions,org:'청년',district:1},first={recordId:'AT-1',meetingId:meeting.meetingId,memberId:'9900000000001',name:'가짜교사',dept:'청년회',position:'교사',at:'2026-11-14 09:00:00',answers:{q1:'현장',q2:'오전 내용'},late:'정상 출석'},second={...first,recordId:'AT-2',at:'2026-11-14 18:00:00',answers:{q1:'온라인',q2:'저녁 내용'}},records=[{...first,additionalRecords:[second]}];
 const summary=surveySummary(questions,records);assert.match(summary,/현장 1 · 온라인 1/);assert.match(summary,/가짜교사 \(09:00\): 오전 내용/);assert.match(summary,/가짜교사 \(18:00\): 저녁 내용/);
 assert.equal(attendancePeople([meeting],records,'2026-11-14').rows[0].n,1);assert.equal(attendanceTallies(meeting,records).departments[0].count,1);assert.equal(meetingCsvRows(meeting,records).length,3);
 assert.equal(surveySummary(questions,[first]),'📝 설문 결과\n▪ 방법 — 현장 1 · 온라인 0\n▪ 후기\n  - 가짜교사: 오전 내용');
});
