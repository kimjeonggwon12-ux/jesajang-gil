import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {prepare,at,atInstant,day,sql,A,MA,FREE,calls,blocked,setFault} from './helpers/delivery-fixture.mjs';
import {cohortTick} from '../server/actions/cohort-tick.js';
import attendance from '../server/actions/attendance.js';
import bot,{sendJungjinTiers} from '../server/actions/bot.js';
import {reportInstant} from '../server/lib/report-schedule.js';
const next=new Date(Date.parse(day+'T12:00:00+09:00')+864e5).toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'});
beforeEach(prepare);
afterEach(()=>{process.env.TZ='Asia/Seoul';assert.deepEqual(blocked,[]);});
const tick=()=>attendance.attAutoSummary({key:process.env.TEACHERSQUARE_CRON_KEY});
function onlyAttendance(end='23:55'){
  sql(`update cohorts set use_assign=false;update cohort_exams set status='닫힘';update attend_meetings set end_time='${end}' where meeting_id='${MA}';`);
}
function general(status='열림'){
  sql(`update cohorts set status='중지';update attend_meetings set status='삭제';update attend_meetings set title='[TEST] 가짜 시각',date='${day}',start_time='10:00',end_time='11:00',status='${status}' where meeting_id='${FREE}'`);
}
test('과정 자정 경계는 조기 보고 없이 원래 교육 날짜로 다음 날 한 번 전달한다',async()=>{
  onlyAttendance();assert.deepEqual(await cohortTick(A),[]);assert.equal(calls.length,0);
  atInstant(next+'T00:04:59.999+09:00');assert.deepEqual(await cohortTick(A),[]);
  atInstant(next+'T00:05:00+09:00');assert.equal((await cohortTick(A)).length,1);assert.equal(calls.length,2);
  assert.match(calls[0].text,new RegExp(day.slice(5).replace('-','/')));
  assert.equal(sql(`select date from cohort_summary_log where ref_id='${MA}'`),day);
  assert.equal(sql(`select status from attend_meetings where meeting_id='${MA}'`),'집계완료');
  await cohortTick(A);assert.equal(calls.length,2);
});
test('전날 낮의 누락 보고·미래 모임을 자정 보완으로 소급 전달하지 않는다',async()=>{
  onlyAttendance('18:00');atInstant(next+'T00:10:00+09:00');assert.deepEqual(await cohortTick(A),[]);
  sql(`update attend_meetings set date='${next}',end_time='23:55' where meeting_id='${MA}'`);assert.deepEqual(await cohortTick(A),[]);assert.equal(calls.length,0);
});
test('23:50 종료의 정각 자정 전달과 연말 날짜 경계도 보존한다',async()=>{
  onlyAttendance('23:50');atInstant(next+'T00:00:00+09:00');assert.equal((await cohortTick(A)).length,1);
  await prepare();onlyAttendance();sql(`update attend_meetings set date='2026-12-31' where meeting_id='${MA}'`);
  atInstant('2027-01-01T00:05:00+09:00');assert.equal((await cohortTick(A)).length,1);assert.equal(sql('select date from cohort_summary_log'),'2026-12-31');
});
test('일반 마감은 1밀리초 전에도 닫지 않고 정각부터 한 번 처리한다',async()=>{
  general();atInstant(day+'T10:59:40+09:00');assert.deepEqual((await tick()).closed,[]);
  atInstant(day+'T10:59:59.999+09:00');assert.deepEqual((await tick()).closed,[]);assert.equal(calls.length,0);
  atInstant(day+'T11:00:00+09:00');assert.deepEqual((await tick()).closed,[FREE]);assert.equal(calls.length,1);
});
test('관리자의 조기 마감은 유지하고 자동 마감 6시간 유효 범위 밖은 제외한다',async()=>{
  general('닫힘');at('10:30');assert.deepEqual((await tick()).closed,[FREE]);
  await prepare();general();atInstant(day+'T17:00:00.001+09:00');assert.deepEqual((await tick()).closed,[]);assert.equal(calls.length,0);
});
test('호스트 UTC·미국 시간대에서도 한국 시각의 과정·일반 마감 결과가 같다',async()=>{
  for(const timezone of ['UTC','America/Los_Angeles']){
    await prepare();process.env.TZ=timezone;onlyAttendance();atInstant(next+'T00:05:00+09:00');assert.equal((await cohortTick(A)).length,1);
    await prepare();process.env.TZ=timezone;general();atInstant(day+'T11:00:00+09:00');assert.deepEqual((await tick()).closed,[FREE]);
  }
  assert.ok(Number.isNaN(reportInstant('2026-02-30','10:00')));assert.ok(Number.isNaN(reportInstant(day,'24:01')));
});
test('과제·시험은 기존 당일 마감과 계산을 유지하고 다음 날 소급하지 않는다',async()=>{
  sql(`update cohorts set use_attend=false;update cohort_assignments set due_time='23:55';update cohort_exams set due_time='23:55'`);
  at('23:54');assert.deepEqual(await cohortTick(A),[]);at('23:55');assert.equal((await cohortTick(A)).length,2);
  assert.equal(calls.length,2);assert.ok(calls.some(c=>c.text.includes('제출 0/1명')));assert.ok(calls.some(c=>c.text.includes('점수 0/1명')));
  atInstant(next+'T00:05:00+09:00');assert.deepEqual(await cohortTick(A),[]);assert.equal(calls.length,2);
});
function mainConfig(){Object.assign(process.env,{TEACHERSQUARE_BOT_TOKEN:'990123:local-only',TEACHERSQUARE_CHAT_ID:'-990401'});sql('truncate alert_log;');}
const news=extra=>bot.tsNewsSend({key:process.env.TEACHERSQUARE_CRON_KEY,date:day,photo:false,...extra});
test('부서 방 실패는 다음 예약에서도 확인 필요이며 AI 재생성 없이 남는다',async()=>{
  mainConfig();sql("insert into report_rooms(dept,chat_id,active) values('청년회','-990301',true)");setFault(c=>c.chat==='-990301'?'reject':'');
  const first=await news({text:'가짜 뉴스'});assert.equal(first.ok,false);assert.equal(first.needsReview,true);assert.equal(calls.length,2);
  const second=await bot.tsNewsSend({key:process.env.TEACHERSQUARE_CRON_KEY,date:day,get text(){throw Error('완료/확인 중 대상에는 AI 재생성 금지');}});
  assert.equal(second.ok,false);assert.equal(second.skipped,false);assert.equal(second.needsReview,true);assert.equal(calls.length,2);
  sql("insert into report_rooms(dept,chat_id,active) values('장년회','-990302',true)");setFault(()=> '');const third=await news({text:'가짜 뉴스'});
  assert.deepEqual(third.rooms,['장년회']);assert.equal(third.ok,false);assert.equal(calls.length,3);
});
test('소통방 결과 불명과 중진 처리 중도 정상 건너뛰기로 감추지 않는다',async()=>{
  mainConfig();setFault(()=> 'network');assert.equal((await news({text:'가짜 뉴스'})).needsReview,true);
  const r=await bot.tsNewsSend({key:process.env.TEACHERSQUARE_CRON_KEY,date:day,get text(){throw Error('AI 다시 실행 금지');}});assert.equal(r.needsReview,true);assert.equal(r.skipped,false);assert.equal(calls.length,1);
  sql("insert into report_rooms(dept,chat_id,active) values('#중진','-990303',true)");
  const {deliverReportBatch}=await import('../server/lib/report-delivery-batch.js');
  await deliverReportBatch({namespace:'#church-room',kind:'등급',ref:'#중진',date:day,room:{dept:'#중진',chat_id:'-990303'}},async()=>{throw Error('가짜 부분 실패');});
  sql("update edu_delivery_log set status='sending' where room_key='#중진'");const tiers=await sendJungjinTiers(day);assert.equal(tiers.ok,false);assert.equal(tiers.needsReview,true);assert.equal(calls.length,1);
});
