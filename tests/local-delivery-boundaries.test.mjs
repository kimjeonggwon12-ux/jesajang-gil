import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {prepare,setFault,calls,blocked,webhook,update,sql,A,MA,FREE,day,at,ids} from './helpers/delivery-fixture.mjs';
import {jwt} from './helpers/local-db.mjs';
import {cohortTick} from '../server/actions/cohort-tick.js';
import attendance,{findMeeting,loadRecords} from '../server/actions/attendance.js';
import {receiveTelegramUpdate} from '../server/lib/telegram-receipt.js';
import {postRollCalls,reportDailyTick} from '../server/lib/report-room.js';
import {postRoomAttendance} from '../server/lib/room-attendance.js';
import {sendMainSummary} from '../server/lib/summary-delivery.js';
import {deliverReportBatch} from '../server/lib/report-delivery-batch.js';
beforeEach(async()=>{await prepare();sql('truncate telegram_update_receipts;');});
afterEach(()=>assert.equal(blocked.length,0));

test('웹훅의 인증/형식 거절은 DB와 답장을 바꾸지 않는다',async()=>{
 assert.equal((await webhook(update(),'invalid')).status,401);
 for(const value of ['{',{}, {update_id:-1}, {update_id:'1'}])assert.equal((await webhook(value)).status,400);
 assert.equal(sql('select count(*) from telegram_update_receipts'),'0');assert.equal(calls.length,0);
});
test('동일 웹훅 동시 수신·재수신은 답장 한 번, 수정 글은 새 요청으로 처리한다',async()=>{
 const r=await Promise.all([webhook(update()),webhook(update())]);assert.ok(r.some(x=>x.body.ok));
 assert.equal(calls.length,1);assert.equal(sql("select status from telegram_update_receipts"),'done');
 assert.equal((await webhook(update())).body.duplicate,true);assert.equal(calls.length,1);
 const edited=update(99002);edited.edited_message=edited.message;delete edited.message;
 assert.equal((await webhook(edited)).body.ok,true);assert.equal(calls.length,2);
 assert.equal((await webhook(update(99001,'도움말'))).body.needsReview,true);assert.equal(calls.length,2);
});
test('처리 전 DB 실패는 503이며 DB가 회복되면 같은 요청을 안전하게 시작한다',async()=>{
 sql("create function public.fake_receipt_fail() returns trigger language plpgsql as $$ begin raise exception 'fake';end $$;create trigger fake_receipt_fail before insert on telegram_update_receipts for each row execute function fake_receipt_fail();");
 try{assert.equal((await webhook(update())).status,503);assert.equal(calls.length,0);}finally{sql('drop trigger fake_receipt_fail on telegram_update_receipts;drop function fake_receipt_fail();');}
 assert.equal((await webhook(update())).body.ok,true);assert.equal(calls.length,1);
});
test('과제 저장 후 답장 불명은 저장 보존·확인 필요이며 자동 재저장/답장하지 않는다',async()=>{
 setFault(()=> 'network');const u=update(99003,'제출 테스트교사 가짜 과제 A 첫 내용');
 assert.equal((await webhook(u)).body.needsReview,true);assert.equal(sql('select count(*) from cohort_submissions'),'1');
 assert.equal(sql('select status from telegram_update_receipts'),'unknown');setFault(()=> '');
 assert.equal((await webhook(u)).body.needsReview,true);assert.equal(calls.length,1);assert.equal(sql('select count(*) from cohort_submissions'),'1');
});
test('처리 뒤 완료 기록 실패·프로세스 중단 흔적은 성공으로 표시하거나 자동 반복하지 않는다',async()=>{
 sql("create function public.fake_receipt_done_fail() returns trigger language plpgsql as $$ begin if new.status='done' then raise exception 'fake';end if;return new;end $$;create trigger fake_receipt_done_fail before update on telegram_update_receipts for each row execute function fake_receipt_done_fail();");
 try{assert.equal((await webhook(update())).body.needsReview,true);}finally{sql('drop trigger fake_receipt_done_fail on telegram_update_receipts;drop function fake_receipt_done_fail();');}
 assert.equal((await webhook(update())).body.needsReview,true);assert.equal(calls.length,1);
 sql("update telegram_update_receipts set status='processing';");assert.equal((await webhook(update())).body.needsReview,true);assert.equal(calls.length,1);
});
test('웹훅 순번은 최댓값이 아닌 개별 키로 처리하고 JSON 키 순서에는 영향받지 않는다',async()=>{
 let n=0;const handle=async()=>{n++;};
 for(const id of [900,800,900])await receiveTelegramUpdate({update_id:id,unused:{b:1,a:2}},handle);
 await receiveTelegramUpdate({unused:{a:2,b:1},update_id:800},handle);assert.equal(n,2);
});
test('과정 전송 거절은 완료 0건, 다음 호출도 자동 재발송 0건이다',async()=>{
 setFault(()=> 'reject');const failures=[];assert.deepEqual(await cohortTick(A,failures),[]);assert.equal(failures.length,3);
 assert.equal(sql('select count(*) from cohort_summary_log'),'0');assert.equal(sql(`select status from attend_meetings where meeting_id='${MA}'`),'열림');
 assert.equal(calls.length,3);setFault(()=> '');await cohortTick(A,[]);assert.equal(calls.length,3);
});
test('동시 과정 집계도 출석·과제·시험을 각각 한 번만 완료한다',async()=>{
 const r=await Promise.all([cohortTick(A,[]),cohortTick(A,[])]);assert.equal(r.flat().length,3);
 assert.equal(sql('select count(*) from cohort_summary_log'),'3');assert.equal(sql("select count(*) from edu_delivery_log where status='sent'"),'3');
 const before=calls.length;await cohortTick(A);assert.equal(calls.length,before);assert.equal(sql(`select status from attend_meetings where meeting_id='${MA}'`),'집계완료');
});
test('출석 사진 수신 불명은 글 대체/재전송 없이 남기고 다른 과제·시험은 완료한다',async()=>{
 setFault(c=>c.method==='sendPhoto'?'network':'');const failures=[];const r=await cohortTick(A,failures);
 assert.equal(r.length,2);assert.equal(failures.length,1);assert.equal(sql('select count(*) from cohort_summary_log'),'2');
 assert.equal(calls.filter(c=>c.method==='sendMessage').length,3);const n=calls.length;await cohortTick(A,[]);assert.equal(calls.length,n);
});
test('사진의 확정 거절은 글로 대체하고 성공 결과만 완료한다',async()=>{
 setFault(c=>c.method==='sendPhoto'?'reject':'');assert.equal((await cohortTick(A,[])).length,3);
 assert.equal(sql('select count(*) from cohort_summary_log'),'3');assert.ok(calls.filter(c=>c.method==='sendMessage').length>3);
});
async function general(title='[TEST] 가짜 마감'){
 at('11:00');sql(`update cohorts set status='중지';update attend_meetings set status='삭제';update attend_meetings set title='${title}',date='${day}',start_time='10:00',end_time='10:59',status='열림' where meeting_id='${FREE}';`);
}
test('일반 출석 접수 마감은 보존하고 전달 실패를 집계완료로 표시하지 않는다',async()=>{
 await general();setFault(()=> 'reject');const r=await attendance.attAutoSummary({key:process.env.TEACHERSQUARE_CRON_KEY});
 assert.equal(r.ok,false);assert.deepEqual(r.closed,[]);assert.ok(r.failures.some(x=>x.ref===FREE));assert.equal(sql(`select status from attend_meetings where meeting_id='${FREE}'`),'닫힘');
 const n=calls.length;await attendance.attAutoSummary({key:process.env.TEACHERSQUARE_CRON_KEY});assert.equal(calls.length,n);
});
test('일반 출석 동시 마감은 보고 하나만 만들고 완료 뒤 반복하지 않는다',async()=>{
 await general();await Promise.all([attendance.attAutoSummary({key:process.env.TEACHERSQUARE_CRON_KEY}),attendance.attAutoSummary({key:process.env.TEACHERSQUARE_CRON_KEY})]);
 assert.equal(calls.length,1);assert.equal(sql(`select status from attend_meetings where meeting_id='${FREE}'`),'집계완료');
 await attendance.attAutoSummary({key:process.env.TEACHERSQUARE_CRON_KEY});assert.equal(calls.length,1);
});
test('마감 글 성공 후 엑셀 전송 실패도 미완료로 보존한다',async()=>{
 await general('가짜 일반 교육');sql(`update attend_records set meeting_id='${FREE}' where meeting_id='${MA}';`);setFault(c=>c.method==='sendDocument'?'network':'');
 const r=await attendance.attAutoSummary({key:process.env.TEACHERSQUARE_CRON_KEY});assert.equal(r.ok,false);assert.ok(calls.some(c=>c.method==='sendDocument'));
 assert.equal(sql(`select status from attend_meetings where meeting_id='${FREE}'`),'닫힘');const n=calls.length;await attendance.attAutoSummary({key:process.env.TEACHERSQUARE_CRON_KEY});assert.equal(calls.length,n);
});
test('일반 지역 출석 보고는 방별 실패를 구분하고 성공 방을 다시 보내지 않는다',async()=>{
 await general('가짜 일반 교육');sql(`update attend_records set meeting_id='${FREE}',dept='청년회',at='${day} 10:00:00' where meeting_id='${MA}';insert into report_rooms(dept,chat_id,title,active) values('청년회/01지역','-990301','가짜 지역',true),('청년회#총합','-990302','가짜 총합',true);`);
 const m=await findMeeting(FREE,{fresh:true});setFault(c=>c.chat==='-990301'?'reject':'');const failures=[];
 await postRoomAttendance(m,'최종','',failures);assert.ok(calls.length>0);assert.ok(failures.length>0);
 assert.equal(sql("select count(*) from cohort_summary_log where ref_id like '청년회/01지역|%'"),'0');const n=calls.length;await postRoomAttendance(m,'최종','',[]);assert.equal(calls.length,n);
});
test('수신 기록의 익명/로그인 직접 조회·쓰기를 차단한다',async()=>{
 for(const role of ['anon','authenticated']){
  const headers={Authorization:'Bearer '+jwt(role),'content-type':'application/json'};
  for(const method of ['GET','POST']){const r=await fetch('http://127.0.0.1:58433/rest/v1/telegram_update_receipts',{method,headers,...(method==='POST'?{body:JSON.stringify({bot_key:'fake',update_id:1,payload_hash:'a'.repeat(64),status:'done'})}:{})});assert.equal(r.status,role==='anon'?401:403);}
 }
 assert.equal(sql("select relrowsecurity from pg_class where oid='public.telegram_update_receipts'::regclass"),'t');
});
test('출결 취합의 전달 실패도 완료 기록을 남기지 않는다',async()=>{
 sql(`update teachers set dept='부녀회',region='기타' where nid='${ids.member}';insert into report_rooms(dept,chat_id,title,active) values('부녀회/기타#출결','-990301/11','가짜 출결',true);`);
 const m=await findMeeting(MA,{fresh:true}),records=await loadRecords(q=>q.eq('meeting_id',MA));setFault(()=> 'reject');const failures=[];
 assert.deepEqual(await postRollCalls(m,records,failures),[]);assert.equal(failures.length,1);assert.equal(sql('select count(*) from cohort_summary_log'),'0');
 setFault(()=> '');await postRollCalls(m,records,[]);assert.equal(calls.length,1);
});
test('일일 보고의 사진 결과가 불명확하면 글 대체·5분 재전송을 하지 않는다',async()=>{
 at('22:10');sql(`truncate activities;insert into activities(member_id,name,submitted_at,activities,roles,target_name,target_stage,today_work) values('${ids.member}','테스트교사','${day} 09:00','{상담1}','{교사}','가짜대상','상담1','가짜 보고');insert into report_rooms(dept,chat_id,title,active) values('청년회/1지역','-990301','가짜 지역',true),('청년회#총합:활동현황','-990302','가짜 총합',true);`);
 setFault(c=>c.chat==='-990302'?'network':'');const failures=[];const result=await reportDailyTick(failures);
 assert.ok(result.length>0);assert.ok(failures.length>0);assert.ok(calls.some(c=>c.method==='sendPhoto'));const n=calls.length;
 await reportDailyTick([]);assert.equal(calls.length,n);assert.equal(sql("select count(*) from cohort_summary_log where ref_id='청년회#총합:활동현황'"),'0');
});
function mainConfig(){Object.assign(process.env,{TEACHERSQUARE_BOT_TOKEN:'990123:local-only',TEACHERSQUARE_CHAT_ID:'-990401'});sql('truncate alert_log;');}
test('소통방 여러 통 보고의 부분 성공은 전체 완료가 아니며 자동 반복하지 않는다',async()=>{
 mainConfig();const parts=[{text:'가짜 첫 글'},{text:'가짜 둘째 글'}];setFault((c,n)=>n===2?'network':'');
 assert.equal(await sendMainSummary(parts,'local-multi','가짜 일일'),false);assert.equal(sql('select count(*) from alert_log'),'0');
 setFault(()=> '');assert.equal(await sendMainSummary(parts,'local-multi','가짜 일일'),false);assert.equal(calls.length,2);
});
test('소통방 사진의 확정 거절은 글 대체, 응답 불명은 중단한다',async()=>{
 mainConfig();const parts=[{png:new Uint8Array([1]),caption:'가짜 사진',text:'가짜 대체 글'}];setFault(c=>c.method==='sendPhoto'?'reject':'');
 assert.equal(await sendMainSummary(parts,'local-photo','가짜 보고'),true);assert.deepEqual(calls.map(c=>c.method),['sendPhoto','sendMessage']);
 setFault(()=> 'invalid');assert.equal(await sendMainSummary(parts,'local-unknown','가짜 보고'),false);assert.equal(calls.length,3);
 await sendMainSummary(parts,'local-unknown','가짜 보고');assert.equal(calls.length,3);
});
test('소통방 동시 보고와 전송 후 옛 로그 저장 실패는 재발송 없이 복구한다',async()=>{
 mainConfig();const parts=[{text:'가짜 소통방 보고'}];const r=await Promise.all([sendMainSummary(parts,'local-concurrent','가짜 보고'),sendMainSummary(parts,'local-concurrent','가짜 보고')]);assert.ok(r.some(Boolean));assert.equal(calls.length,1);
 const c={namespace:'#fake',kind:'최종',ref:'local',date:day,room:{dept:'#fake',chat_id:'-990301'}};let n=0;
 sql("create function public.fake_report_done_fail() returns trigger language plpgsql as $$ begin if new.cohort_id='#fake' then raise exception 'fake';end if;return new;end $$;create trigger fake_report_done_fail before insert on cohort_summary_log for each row execute function fake_report_done_fail();");
 try{await assert.rejects(deliverReportBatch(c,async()=>{n++;}));}finally{sql('drop trigger fake_report_done_fail on cohort_summary_log;drop function fake_report_done_fail();');}
 assert.equal((await deliverReportBatch(c,async()=>{n++;})).state,'sent');assert.equal(n,1);
});
