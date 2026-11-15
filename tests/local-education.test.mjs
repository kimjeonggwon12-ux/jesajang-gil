import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import XLSX from 'xlsx';
import {ids,sql,api,apiBase,login,jwt} from './helpers/local-db.mjs';
import {seedEducation,OWNER,A,B,MA,MB,FREE,SERIES} from './helpers/education-fixture.mjs';
const all=['settings','members','schedule','attendance','assignments','exams','reports'];
let owner,admin,member;
beforeEach(async()=>{
  seedEducation();
  owner=(await login(OWNER,'테스트앱관리')).body.token;
  admin=(await login(ids.admin,'테스트교육')).body.token;
  member=(await login()).body.token;
  assert.ok(owner && admin && member);
});
const grant=(permissions=['attendance'],scopeId=A,scopeType='cohort',targetId=ids.admin)=>api('educationSetDelegation',{scopeType,scopeId,targetId,permissions},owner);
const ok=r=>assert.equal(r.body.ok,true,JSON.stringify(r));
const denied=r=>assert.equal(r.status,403,JSON.stringify(r));
const score=(scope=A)=>({cohortId:scope,date:'2026-11-12',subject:'가짜시험',targetId:scope===A?ids.member:ids.other,score:85});
const secret=createHash('sha256').update('local-only-education-webhook-key|att-tg').digest('hex').slice(0,48);
let mid=0;
async function tg(text,user=990101,chat=-990001,extra={},key=secret) {
  const r=await fetch(apiBase+'/api/tg',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':key},body:JSON.stringify({update_id:++mid,message:{message_id:mid,chat:{id:chat,type:chat>0?'private':'supergroup'},from:{id:user,first_name:'가짜연결사용자'},text,...extra}})});
  return r.status;
}
async function link(user=990101,token=admin) {
  const r=await api('educationTelegramCode',{},token);ok(r);
  assert.equal(await tg('연결 '+r.body.code,user,user),200);return r.body.code;
}
test('위임은 앱 관리자만 지정·회수하고 현재 관리자만 대상으로 삼으며 이력을 함께 저장한다',async()=>{
  const body={scopeType:'cohort',scopeId:A,targetId:ids.admin,permissions:['attendance']};
  denied(await api('educationSetDelegation',body,admin));
  denied(await api('educationSetDelegation',{...body,memberId:OWNER},admin));
  denied(await grant(['attendance'],A,'cohort',ids.member));
  ok(await grant()); assert.equal(sql('select count(*) from education_access_events'), '1');
  ok(await grant([]));assert.equal(sql("select count(*) from education_access_events where event='위임 회수'"),'1');
  denied(await api('educationDelegations',{scopeType:'cohort',scopeId:A},admin));
});
test('출석 위임은 담당 과정에만 적용되고 다른 업무·새 과정·방 변경으로 확장되지 않는다',async()=>{
  ok(await grant());
  const list=await api('cohortList',{},admin);assert.deepEqual(list.body.cohorts.map(c=>c.cohortId),[A]);
  denied(await api('cohortDetail',{cohortId:B},admin));
  ok(await api('cohortSetAttendance',{cohortId:A,date:'2026-11-12',targetId:ids.member,status:'출석'},admin));
  for(const [action,body] of [['cohortSetScore',score()],['cohortSaveAssignment',{cohortId:A}],['cohortSaveItem',{cohortId:A}],['cohortRemoveMember',{cohortId:A,targetId:ids.member}],['cohortSendSummary',{cohortId:A}],['cohortSheet',{cohortId:A,content:true}],['cohortSave',{cohort:{title:'새 과정'}}]]) denied(await api(action,body,admin));
  ok(await grant(['settings']));
  denied(await api('cohortSave',{cohort:{cohortId:A,title:'가짜 교육 A',tgChat:'-990002'}},admin));
  denied(await api('cohortSave',{cohort:{cohortId:A,title:'가짜 교육 A',status:'삭제'}},admin));
  ok(await api('cohortSave',{cohort:{cohortId:A,title:'가짜 교육 A'}},admin));
  assert.equal(sql(`select tg_chat from cohorts where cohort_id='${A}'`),'-990001');
});
test('과정 담당자의 설정·명단·일정·출석·과제·시험 업무를 실제 DB에 저장한다',async()=>{
  ok(await grant(all));
  ok(await api('cohortSave',{cohort:{cohortId:A,title:'가짜 교육 수정',tgChat:'-990001'}},admin));
  ok(await api('cohortAddMembers',{cohortId:A,members:[{memberId:ids.other,name:'테스트대상'}]},admin));
  ok(await api('cohortSaveItem',{cohortId:A,item:{date:'2026-11-12',title:'가짜 일정',start:'10:00',end:'11:00'}},admin));
  ok(await api('cohortSaveAssignment',{cohortId:A,assignment:{title:'가짜 과제 추가'}},admin));
  ok(await api('cohortSaveExam',{cohortId:A,exam:{subject:'가짜 추가시험',date:'2026-11-12'}},admin));
  ok(await api('cohortSetScore',score(),admin));
  assert.equal(sql(`select actor_nid from cohort_scores where cohort_id='${A}'`),ids.admin);
  const detail=await api('cohortDetail',{cohortId:A},admin);assert.deepEqual(detail.body.permissions,all);assert.equal(detail.body.canDelegate,false);
  assert.equal((await api('cohortSheet',{cohortId:A,content:true},admin)).status,200);
});
test('과제·시험·일정의 다른 과정 식별자를 섞어도 변경과 제출 열람을 차단한다',async()=>{
  ok(await grant(all));
  denied(await api('cohortSubmissions',{cohortId:A,assignmentId:'AS990002'},admin));
  denied(await api('cohortSubmissions',{assignmentId:'AS990002'},admin));
  denied(await api('cohortSaveAssignment',{cohortId:A,assignment:{assignmentId:'AS990002',title:'변경시도'}},admin));
  denied(await api('cohortSaveExam',{cohortId:A,exam:{examId:'EX990002',subject:'변경시도',date:'2026-11-12'}},admin));
  denied(await api('cohortLinkMeeting',{cohortId:A,meetingId:MB,on:false},admin));
  assert.equal(sql("select title from cohort_assignments where assignment_id='AS990002'"),'가짜 과제 B');
});
test('일반 QR API와 마감 다운로드로 과정 출석 권한을 우회할 수 없다',async()=>{
  ok(await grant(['exams']));
  for(const [action,body] of [['deleteAttendMeeting',{meetingId:MA}],['deleteAttendRecord',{recordId:'AT990001'}],['attSetEveningStart',{meetingId:MA,start2:'18:00'}],['saveAttendMeeting',{meeting:{meetingId:MA,title:'가짜수정',date:'2026-11-12'}}],['attSendClosing',{meetingId:MA,dryRun:true}]])denied(await api(action,body,admin));
  ok(await grant(['attendance']));
  ok(await api('deleteAttendRecord',{recordId:'AT990001'},admin));
  denied(await api('deleteAttendRecord',{recordId:'AT990002'},admin));
  const r=await api('getAttendAdmin',{},admin);assert.deepEqual(r.body.meetings.map(m=>m.meetingId),[MA]);
  assert.equal(sql("select count(*) from attend_records where record_id='AT990002'"),'1');
  ok(await api('cohortSetAttendance',{cohortId:A,date:'2026-11-12',targetId:ids.member,status:'출석'},admin));
  ok(await grant(['reports']));
  const file=await api('attSendClosing',{meetingId:MA,dryRun:true},admin);ok(file);
  assert.ok(!file.body.caption.includes('가짜 B 출석'));assert.ok(!file.body.fileName.includes('가짜 B 출석'));
  const book=XLSX.read(Buffer.from(file.body.base64,'base64'),{type:'buffer'});
  const cells=book.SheetNames.map(name=>XLSX.utils.sheet_to_csv(book.Sheets[name])).join('\n');
  assert.match(cells,/테스트교사/);assert.doesNotMatch(cells,/테스트대상/);
});
test('단독·정기 QR 위임은 각 대상에 제한되고 연결 모임은 상위 교육 권한을 따른다',async()=>{
  ok(await grant(['attendance'],FREE,'meeting'));
  ok(await api('saveAttendMeeting',{meeting:{meetingId:FREE,title:'가짜 QR 수정',date:'2026-11-12'}},admin));
  denied(await api('deleteAttendMeeting',{meetingId:MA},admin));
  assert.equal((await grant(['attendance'],MA,'meeting')).status,400);
  ok(await grant(['attendance'],SERIES,'series'));
  ok(await api('setAttendSeriesStatus',{seriesId:SERIES,status:'멈춤'},admin));
  ok(await api('deleteAttendMeeting',{meetingId:'MT990004'},admin));
});
test('위임 회수와 관리자 자격 회수는 기존 로그인 표의 다음 요청부터 차단한다',async()=>{
  ok(await grant(['exams']));ok(await api('cohortSetScore',score(),admin));
  ok(await grant([]));denied(await api('cohortSetScore',{...score(),score:90},admin));
  ok(await grant(['exams']));sql(`delete from admins where nid='${ids.admin}'`);
  denied(await api('cohortSetScore',{...score(),score:95},admin));assert.equal(sql('select score from cohort_scores'),'85');
});
test('텔레그램 연결은 개인 대화·정상 웹훅만 받고 해시·만료·단회 소비를 적용한다',async()=>{
  const r=await api('educationTelegramCode',{},admin);ok(r);const code=r.body.code;
  assert.equal(await tg('연결 '+code,990101,990101,{},'wrong'),401);
  await tg('연결 '+code);assert.equal(sql('select count(*) from education_telegram_links'),'0');
  await Promise.all(Array.from({length:12},()=>tg('연결 '+code,990101,990101)));
  assert.equal(sql('select count(*) from education_telegram_links'),'1');assert.equal(sql("select count(*) from education_access_events where event='텔레그램 연결'"),'1');
  assert.equal(sql('select count(*) from education_telegram_challenges'),'0');
  const next=await api('educationTelegramCode',{},admin);sql("update education_telegram_challenges set expires_at=now()-interval '1 second'");
  await tg('연결 '+next.body.code,990102,990102);assert.equal(sql('select tg_user_id from education_telegram_links'),'990101');
  assert.equal((await api('educationAccess',{},admin)).body.telegramLinked,true);
});
test('텔레그램 점수는 연결된 과정 시험 담당자만 입력하며 방 관리자·학생 이름 연결로 우회하지 못한다',async()=>{
  ok(await grant(['exams']));
  sql(`insert into cohort_tg_links(cohort_id,tg_user_id,member_id,name) values('${A}','990101','${ids.admin}','가짜이름연결')`);
  await tg('점수 가짜시험 테스트교사 85');assert.equal(sql('select count(*) from cohort_scores'),'0');
  await link();await tg('점수 가짜시험 테스트교사 85');assert.equal(sql('select score from cohort_scores'),'85');assert.equal(sql('select actor_nid from cohort_scores'),ids.admin);
  await tg('점수 가짜시험 테스트대상 90',990101,-990002);assert.equal(sql('select count(*) from cohort_scores'),'1');
  await tg('점수 가짜시험 테스트교사 95',990101,-990001,{sender_chat:{id:-990001}});assert.equal(sql('select score from cohort_scores'),'85');
  ok(await grant([]));await tg('점수 가짜시험 테스트교사 99');assert.equal(sql('select score from cohort_scores'),'85');
});
test('연결 해제와 PIN 변경은 텔레그램의 기존 권한을 무효화한다',async()=>{
  ok(await grant(['exams']));await link();ok(await api('educationTelegramUnlink',{},admin));
  await tg('점수 가짜시험 테스트교사 85');assert.equal(sql('select count(*) from cohort_scores'),'0');
  await link();sql(`update member_pins set ver='changed' where nid='${ids.admin}'`);
  await tg('점수 가짜시험 테스트교사 95');assert.equal(sql('select count(*) from cohort_scores'),'0');
});
test('새 권한·연결 표와 연결 함수는 익명·일반 Supabase 계정에 공개되지 않는다',async()=>{
  for(const role of ['anon','authenticated'])for(const endpoint of ['education_delegations','education_telegram_links','education_telegram_challenges','education_access_events','rpc/education_telegram_consume']) {
    const rpc=endpoint.startsWith('rpc/');const r=await fetch('http://127.0.0.1:58432/'+endpoint,{method:rpc?'POST':'GET',headers:{Authorization:'Bearer '+jwt(role),'content-type':'application/json'},...(rpc?{body:JSON.stringify({p_hash:'x',p_user_id:'990101'})}:{})});assert.ok([401,403].includes(r.status),role+' '+endpoint+' '+r.status);
  }
  assert.equal(sql("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'education_%' and c.relkind='r' and not c.relrowsecurity"),'0');
});
test('연결 코드 재발급은 이전 코드를 폐기하고 이미 연결된 텔레그램 계정을 다른 앱 계정이 가져오지 못한다',async()=>{
  const first=await api('educationTelegramCode',{},admin),second=await api('educationTelegramCode',{},admin);
  await tg('연결 '+first.body.code,990101,990101);assert.equal(sql('select count(*) from education_telegram_links'),'0');
  await tg('연결 '+second.body.code,990101,990101);assert.equal(sql('select count(*) from education_telegram_links'),'1');
  const other=await api('educationTelegramCode',{},owner);await tg('연결 '+other.body.code,990101,990101);
  assert.equal(sql('select nid from education_telegram_links'),ids.admin);
  const bot=await api('cohortBotConnect',{},owner);assert.match(bot.body.error,/운영 환경/);
});
