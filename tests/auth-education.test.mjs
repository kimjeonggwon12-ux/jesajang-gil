import {test,beforeEach,afterEach,mock} from 'node:test';
import assert from 'node:assert/strict';
import * as fake from './helpers/fake-db.mjs';
for(const key of Object.keys(process.env))if(/SUPABASE|TEACHERSQUARE|GEMINI|TELEGRAM|R2_|ATT_|BOT_TOKEN|VERCEL/.test(key))delete process.env[key];
globalThis.fetch=async()=>{throw Error('외부 통신 차단');};
const sent=[];
mock.module('../server/lib/db.js',{exports:{db:fake.db,run:fake.run,selectAll:fake.selectAll,isDuplicate:fake.isDuplicate}});
mock.module('../server/lib/attend-bot.js',{exports:{
  attendBotCall:async(method,payload)=>{sent.push({method,payload});return {ok:true,result:{status:'administrator'}};},
  sendAttendText:async(...args)=>sent.push({method:'text',args}),sendAttendHtml:async()=>{},sendAttendPhoto:async()=>({ok:true}),sendAttendFile:async()=>({ok:true}),
}});
const {handleAttendUpdate}=await import('../server/actions/cohort-bot.js');
const {pinVersion}=await import('../server/lib/auth.js');
const {withActor}=await import('../server/lib/request-context.js');
const {default:cohorts}=await import('../server/actions/cohorts.js');
const {default:schedule}=await import('../server/actions/cohort-schedule.js');
const {cohortTick}=await import('../server/actions/cohort-tick.js');
const {kstDate}=await import('../server/lib/util.js');
const M='9900000000001',E='9900000000002',A='CH990001';
const pin={nid:E,pin_hash:'fake-only-hash',salt:'fake-only-salt',ver:'1'};
beforeEach(()=>{
  sent.length=0;fake.reset({
    teachers:[{nid:E,member_id:E,name:'가짜담당',dept:'청년회',position:'',note:''}],admins:[{nid:E,member_id:E,name:'가짜담당',dept:'교육부'}],member_pins:[pin],
    cohorts:[{id:1,cohort_id:A,title:'가짜 과정',status:'진행',tg_chat:'-990001',start_date:'2026-11-12',end_date:'2026-11-12'}],
    cohort_members:[{member_id:M,nid:M,name:'테스트교사',cohort_id:A,seq:1}],
    education_delegations:[{id:1,scope_type:'cohort',scope_id:A,nid:E,permissions:['exams'],revoked:false}],
    education_telegram_links:[{nid:E,tg_user_id:'990101',pin_version:pinVersion(pin)}],
  });
});
afterEach(()=>assert.equal(sent.filter(x=>x.method==='getChatMember').length,0,'텔레그램 방 관리자 조회를 권한 근거로 사용하지 않는다'));
const msg=(text,extra={})=>({message:{message_id:1,chat:{id:-990001,type:'supergroup'},from:{id:990101,first_name:'가짜담당'},text,...extra}});
test('텔레그램 방 관리자여도 앱 연결·과정 시험 위임이 없으면 점수를 저장하지 않는다',async()=>{
  fake.rows.education_telegram_links=[];
  await handleAttendUpdate(msg('점수 가짜시험 테스트교사 85'));
  assert.equal(fake.rows.cohort_scores.length,0);assert.match(sent.at(-1).payload.text,/시험 담당자/);
});
test('방 관리자 조회 없이 연결된 시험 담당자의 일반 문장·날짜별 표를 저장하고 실행 계정을 남긴다',async()=>{
  await handleAttendUpdate(msg('점수 가짜시험 테스트교사 85'));
  await handleAttendUpdate(msg('점수 가짜시험\n11.10 / 11.11\n1. 테스트교사 80 / 90'));
  assert.equal(fake.rows.cohort_scores.length,3);
  assert.ok(fake.rows.cohort_scores.every(s=>s.actor_nid===E));
});
test('텔레그램 집계는 시험 위임과 별개이며 집계 위임을 받은 계정에만 허용한다',async()=>{
  await handleAttendUpdate(msg('집계'));assert.match(sent.at(-1).payload.text,/집계 담당자/);
  fake.rows.education_delegations[0].permissions=['reports'];sent.length=0;
  await handleAttendUpdate(msg('집계'));assert.ok(sent.some(x=>x.payload?.text?.includes('가짜 과정')));
  await handleAttendUpdate(msg('점수 가짜시험 테스트교사 99'));assert.equal(fake.rows.cohort_scores.length,0);
});
test('텔레그램 익명 관리자·권한 회수·PIN 변경·중복 과정 방은 점수를 바꾸지 못한다',async()=>{
  await handleAttendUpdate(msg('점수 가짜시험 테스트교사 85',{sender_chat:{id:-990001}}));
  fake.rows.education_delegations[0].revoked=true;await handleAttendUpdate(msg('점수 가짜시험 테스트교사 85'));
  fake.rows.education_delegations[0].revoked=false;fake.rows.member_pins[0].ver='2';await handleAttendUpdate(msg('점수 가짜시험 테스트교사 85'));
  fake.rows.member_pins[0].ver='1';fake.rows.cohorts.push({...fake.rows.cohorts[0],id:2,cohort_id:'CH990002'});await handleAttendUpdate(msg('점수 가짜시험 테스트교사 85'));
  assert.equal(fake.rows.cohort_scores.length,0);
});
test('과정·일정 액션 전부는 위임 없는 관리자 요청을 거절한다',async()=>{
  fake.rows.education_delegations=[];
  await withActor({nid:E,memberId:E},async()=>{
    for(const [name,fn] of Object.entries({...cohorts,...schedule})) {
      if(name==='cohortList') {assert.deepEqual((await fn({})).cohorts,[]);continue;}
      await assert.rejects(()=>fn({cohortId:A,cohort:{cohortId:A},assignmentId:'AS990001'}),e=>e.status===403,name);
    }
  });
});
test('기존 교육생은 관리자 연결 없이 이름으로 과제를 제출하고 다음 제출도 이어간다',async()=>{
  fake.rows.cohort_assignments.push({assignment_id:'AS990001',cohort_id:A,title:'가짜과제',repeat:'한번',status:'열림',guide:''});
  await handleAttendUpdate(msg('제출 테스트교사 가짜과제 첫 내용',{from:{id:990202,first_name:'가짜학생'}}));
  assert.equal(fake.rows.cohort_submissions.length,1);assert.equal(fake.rows.cohort_submissions[0].nid,M);
  await handleAttendUpdate(msg('제출 가짜과제 수정 내용',{from:{id:990202,first_name:'가짜학생'}}));
  assert.equal(fake.rows.cohort_submissions.length,1);assert.match(fake.rows.cohort_submissions[0].content,/수정 내용/);
  assert.equal(fake.rows.education_telegram_links.length,1,'교육생 이름 연결을 운영자 연결로 승격하지 않는다');
});
test('기존 예약 집계는 사람의 새 위임 없이 출석·과제·시험 마감을 계속 처리한다',async()=>{
  const today=kstDate();Object.assign(fake.rows.cohorts[0],{use_attend:true,use_assign:true,start_date:today,end_date:today});
  fake.rows.education_delegations=[];fake.rows.education_telegram_links=[];
  fake.rows.attend_meetings.push({id:1,meeting_id:'MT990001',cohort_id:A,date:today,start_time:'00:00',end_time:'00:01',status:'열림'});
  fake.rows.cohort_assignments.push({assignment_id:'AS990001',cohort_id:A,title:'가짜과제',repeat:'한번',due:today,due_time:'00:01',status:'열림'});
  fake.rows.cohort_exams.push({exam_id:'EX990001',cohort_id:A,subject:'가짜시험',date:today,due_time:'00:01',status:'열림'});
  const result=await cohortTick(A);assert.equal(result.length,3);assert.equal(fake.rows.cohort_summary_log.length,3);
  assert.ok(sent.some(x=>x.method==='text' && /과제 제출 현황/.test(x.args[0])));
});
