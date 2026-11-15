import {test,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {spawn} from 'node:child_process';
import {prepare,at,day,MEETING,request,body,sql,quote,ids,blocked} from './helpers/attendance-session-fixture.mjs';
import {PIN} from './helpers/local-db.mjs';
import {findMeeting,loadRecordsForMeetings,lateText,surveySummary} from '../server/actions/attendance.js';
import {closingData} from '../server/actions/attendance-closing.js';
import {attendancePeople,meetingCsvRows,peopleCsvRows,attendanceTallies} from '../next-app/lib/attendance-admin.ts';
let token;
beforeEach(async()=>{token=await prepare();});
after(()=>assert.deepEqual(blocked,[]));
const submit=(answer,extra={},tk=token)=>request('submitAttendance',{...body(answer),...extra},tk).then(r=>{assert.equal(r.status,200);return r.body;});
const row=()=>JSON.parse(sql(`select row_to_json(r) from attend_records r where meeting_id='${MEETING}'`));
async function both(){assert.equal((await submit('오전 답변')).ok,true);at('18:02');assert.equal((await submit('저녁 답변')).ok,true);}
async function admin(){return (await request('verifyLogin',{memberId:ids.admin,name:'테스트교육',dept:'청년회',pin:PIN})).body.token;}

test('같은 번호의 오전·저녁 원문을 보존하고 일일 인원·모임 횟수는 한 번이다',async()=>{
 await both();const r=row();assert.equal(r.answers.q1,'오전 답변');assert.equal(r.additional_records.length,1);assert.equal(r.additional_records[0].answers.q1,'저녁 답변');assert.equal(r.additional_records[0].late,'2분 지각');
 assert.equal(sql(`select count(*)||':'||count(distinct meeting_id) from attend_records where meeting_id='${MEETING}'`),'1:1');
 const daily=await loadRecordsForMeetings([MEETING]),sessions=await loadRecordsForMeetings([MEETING],{sessions:true});assert.equal(daily.length,1);assert.equal(sessions.length,2);
 const m=await findMeeting(MEETING),people=attendancePeople([m],daily,day);assert.equal(people.rows[0].n,1);assert.equal(peopleCsvRows([m],daily,day)[1][4],1);
 const survey=surveySummary(m.questions,daily);assert.match(survey,/오전 답변/);assert.match(survey,/저녁 답변/);assert.match(survey,/타임별 응답/);
 const csv=meetingCsvRows(m,daily);assert.equal(csv.length,3);assert.equal(csv[1].at(-1),'오전 답변');assert.equal(csv[2].at(-1),'저녁 답변');
 const close=await closingData(m,{onlyMeeting:true});assert.equal(close.rows.filter(r=>!r.dup).length,2);assert.deepEqual(close.rows.map(r=>r.session),['오전','저녁']);
});
test('오전·저녁 각각 동시 제출 12개는 첫 답변 하나만 남긴다',async()=>{
 for(const hm of ['09:00','18:00']){at(hm);const all=await Promise.all(Array.from({length:12},(_,i)=>submit(hm+'-'+i)));assert.equal(all.filter(r=>!r.already&&r.ok).length,1);assert.equal(new Set(all.map(r=>r.record.answers.q1)).size,1);}
 assert.equal(row().additional_records.length,1);
});
test('본인 세션만 현재 타임 답변을 보고 익명 재제출은 원문을 받지 않는다',async()=>{
 await submit('비공개 오전');at('18:00');const before=await request('getAttendMeeting',body(),token);assert.equal(before.body.mine,null);assert.equal(before.body.meeting.sessionStart,'18:00');
 await submit('비공개 저녁');const own=await request('getAttendMeeting',body(),token);assert.equal(own.body.mine.answers.q1,'비공개 저녁');assert.ok(!own.body.mine.additionalRecords);
 const anon=await request('getAttendMeeting',body());assert.equal(anon.body.mine,null);const repeat=await submit('다른 답변',{},'');assert.deepEqual(repeat.record,{meetingId:MEETING,limited:true});
 assert.ok(!JSON.stringify(repeat).includes('비공개'));assert.equal(row().answers.q1,'비공개 오전');assert.equal(row().additional_records[0].answers.q1,'비공개 저녁');
});
test('저녁 필수 답변 누락은 오전 완료로 속이지 않고 오래 열린 오전 양식은 다시 확인하게 한다',async()=>{
 await submit();at('18:00');assert.ok((await submit('',{answers:{}})).error);assert.ok((await submit('저녁',{sessionStart:'09:00'})).error);assert.equal(row().additional_records.length,0);
 assert.equal((await submit('저녁',{sessionStart:'18:00',at:day+' 09:00:00',slot:0})).ok,true);assert.equal(row().additional_records[0].at.slice(11,16),'18:00');
});
test('캐시 뒤 마감·설문 변경은 저장 직전 DB에서 막는다',async()=>{
 await findMeeting(MEETING,{fresh:true});sql(`update attend_meetings set status='닫힘' where meeting_id='${MEETING}'`);assert.ok((await submit()).error);assert.equal(sql(`select count(*) from attend_records where meeting_id='${MEETING}'`),'0');
 sql(`update attend_meetings set status='열림' where meeting_id='${MEETING}'`);await findMeeting(MEETING,{fresh:true});sql(`update attend_meetings set questions='[]' where meeting_id='${MEETING}'`);assert.ok((await submit()).error);
});
test('타임 사이·종료 후에는 제출하지 못하며 시간 수정 후에도 이미 낸 원문을 보존한다',async()=>{
 await submit();at('13:00');assert.ok((await submit('틈')).error);at('21:00');assert.ok((await submit('종료')).error);
 sql(`update attend_meetings set slots='[{"start":"08:55","end":"11:00"},{"start":"18:00","end":"20:00"}]' where meeting_id='${MEETING}'`);await findMeeting(MEETING,{fresh:true});at('09:00');assert.equal((await submit('변경')).already,true);assert.equal(row().answers.q1,'오전 답변');
});
test('지각 기준 재계산은 추가 타임·설문을 함께 보존한다',async()=>{
 await both();sql(`update attend_records set late='오류',additional_records=jsonb_set(additional_records,'{0,late}','"오류"') where meeting_id='${MEETING}'`);
 const r=await request('attSetEveningStart',{meetingId:MEETING,start2:'18:30'},await admin());assert.ok(!r.body.error,r.body.error);assert.equal(r.body.recalculated,1);assert.equal(row().late,'정상 출석');assert.equal(row().additional_records[0].late,'2분 지각');assert.equal(row().additional_records[0].answers.q1,'저녁 답변');
});
test('관리자·본인 조회와 설문 집계는 추가 타임을 보존하고 삭제는 모든 타임을 함께 지운다',async()=>{
 await both();const own=await request('getMyAttendance',{},token);assert.equal(own.body.records.find(r=>r.meetingId===MEETING).additionalRecords.length,1);
 const tk=await admin(),adm=await request('getAttendAdmin',{},tk);const m=adm.body.meetings.find(m=>m.meetingId===MEETING);assert.equal(m.count,1);const records=adm.body.records.filter(r=>r.meetingId===MEETING);assert.equal(records.length,1);assert.equal(records[0].additionalRecords.length,1);
 const tally=attendanceTallies({...m,questions:[{id:'q1',label:'방식',type:'choice',options:[]}]},records);assert.equal(tally.departments[0].count,1);assert.equal(tally.tallies[0].values.reduce((n,r)=>n+r.count,0),2);
 const denied=await request('deleteAttendRecord',{recordId:records[0].recordId},token);assert.ok(denied.status>=400||denied.body.error);assert.equal(row().additional_records.length,1);
 const del=await request('deleteAttendRecord',{recordId:records[0].recordId},tk);assert.equal(del.body.ok,true);assert.equal(sql(`select count(*) from attend_records where meeting_id='${MEETING}'`),'0');
});
test('새 DB 함수는 공개 역할에서 실행할 수 없고 보안 정의자 권한을 쓰지 않는다',()=>{
 assert.equal(sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('attendance_slot_start','attendance_late_text','attendance_session_submit','attendance_evening_start') and (p.prosecdef or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute') or not has_function_privilege('service_role',p.oid,'execute'))"),'0');
});
test('SQL과 서버 지각 계산은 자정 이전 입장·경계·복수 타임에서 같다',async()=>{
 const m=await findMeeting(MEETING);
 for(const [start,end] of [['09:00','18:00'],['00:05','18:00']]){
  const config={...m,start,slots:[{start,end:'11:00'},{start:end,end:'20:00'}]};
  const state={...m._attendanceState,start_time:start,slots:config.slots};
  for(const stamp of [day+' 00:00:00',day+' 08:30:00',day+' 09:00:01',day+' 18:00:59',day+' 18:02:00',new Date(Date.parse(day+'T00:00:00Z')-86400000).toISOString().slice(0,10)+' 23:50:00'])assert.equal(sql(`select attendance_late_text(${quote(JSON.stringify(state))}::jsonb,${quote(stamp)}::timestamp)`),lateText(config,stamp),stamp);
 }
});
test('백업 원문에 두 타임을 담고 복원 시 첫 행과 추가 답변이 그대로 되살아난다',async()=>{
 await both();const expected=row();const {buildBackup}=await import('../server/actions/backup.js');const snapshot=JSON.parse(gunzipSync((await buildBackup()).bytes));const stored=snapshot.data.attend_records.find(r=>r.meeting_id===MEETING);assert.deepEqual(stored,expected);
 // 현재 DB를 건드리지 않는 임시 표 복원. 전체 DB 복원 리허설은 별도 단계다.
 const result=JSON.parse(sql(`begin; create temp table attendance_restore (like public.attend_records including all); insert into attendance_restore (record_id,meeting_id,member_id,name,dept,position,answers,at,method,pick_org,pick_district,dept24,late,additional_records) select record_id,meeting_id,member_id,name,dept,position,answers,at,method,pick_org,pick_district,dept24,late,additional_records from jsonb_populate_record(null::public.attend_records,${quote(JSON.stringify(stored))}::jsonb); select json_build_object('answers',answers,'additional_records',additional_records) from attendance_restore; rollback;`).split('\n').find(x=>x.startsWith('{')));assert.deepEqual(result,{answers:expected.answers,additional_records:expected.additional_records});
});

test('같은 고유번호로 두 번 제출한 실제 저장 결과가 교육 보고에서 오전1·저녁1·하루1로 반영된다',async()=>{
 const {seedEduReport,ER}=await import('./helpers/edu-report-fixture.mjs');seedEduReport();
 const {forgetRoster}=await import('../server/actions/roster.js');forgetRoster();
 sql(`delete from attend_records where record_id in ('AT190001','AT190002')`);await findMeeting(ER.meeting,{fresh:true});
 at('09:01');assert.equal((await submit('',{meetingId:ER.meeting,answers:{}})).ok,true);
 at('19:30');assert.equal((await submit('',{meetingId:ER.meeting,answers:{}})).ok,true);
 const tk=await admin(),r=await request('getEduAttendanceReport',{meetingId:ER.meeting,phase:'최종'},tk);
 assert.ok(!r.body.error,r.body.error);assert.equal(r.body.summary.total.came,4);assert.deepEqual(r.body.summary.total.by,{오전:3,저녁:3});
 assert.equal(sql(`select count(*) from attend_records where meeting_id='${ER.meeting}' and nid='${ids.member}'`),'1');
 const pm=await request('getEduAttendanceReport',{meetingId:ER.meeting,phase:'저녁'},tk);assert.equal(pm.body.summary.total.came,3);
});

test('DB에서 마감을 진행 중인 요청은 잠금이 끝난 뒤 새 상태를 확인하며 추가 출석을 저장하지 않는다',async()=>{
 await submit();at('18:00');await findMeeting(MEETING,{fresh:true});
 const child=spawn('/opt/homebrew/bin/psql',['-h','/tmp/jesajang-auth-pg-socket','-p','58431','-U','postgres','-d','jesajang_auth_local','-v','ON_ERROR_STOP=1','-At'],{stdio:['pipe','pipe','pipe']});
 let out='';const ready=new Promise((resolve,reject)=>{child.stdout.on('data',chunk=>{out+=chunk;if(out.includes('LOCKED'))resolve();});child.on('error',reject);child.on('exit',code=>{if(!out.includes('LOCKED'))reject(Error('로컬 잠금 준비 실패 '+code));});});
 const closed=new Promise(resolve=>child.on('exit',resolve));
 child.stdin.write(`begin; update attend_meetings set status='닫힘' where meeting_id='${MEETING}';\n\\echo LOCKED\n`);
 await ready;let pending;
 try{
  pending=submit('차단되어야 할 저녁');let waiting=false;
  for(let i=0;i<60;i++){if(sql("select count(*) from pg_stat_activity where datname='jesajang_auth_local' and wait_event_type='Lock' and query like '%attendance_session_submit%'")!=='0'){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,20));}
  assert.equal(waiting,true,'요청이 실제 DB 잠금에서 대기한다');
 }finally{child.stdin.end('commit;\n');await closed;}
 assert.ok((await pending).error);assert.equal(row().additional_records.length,0);
});
