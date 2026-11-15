import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {seedJungjin,ER,today} from './helpers/jungjin-fixture.mjs';
import {ids,PIN,sql,jwt} from './helpers/local-db.mjs';
const base='http://127.0.0.1:58434',params={meetingId:ER.meeting,phase:'최종',audience:'jungjin'};
async function api(action,data={},token){const r=await fetch(base+'/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...data,...(token?{_tk:token}:{})})});return{status:r.status,body:await r.json()};}
async function ok(action,data,token){const r=await api(action,data,token);assert.equal(r.status,200,action+': '+r.body.error);assert.ok(!r.body.error,action+': '+r.body.error);return r.body;}
async function deny(action,data,token){const r=await api(action,data,token);assert.ok(r.status>=400||r.body.error,action);return r;}
let reader,attender;
beforeEach(async()=>{seedJungjin();[reader,attender]=await Promise.all([[ids.admin,'테스트교육','청년회'],[ids.evangel,'테스트전도','전도부']].map(async([memberId,name,dept])=>(await ok('verifyLogin',{memberId,name,dept,pin:PIN})).token));});
test('보고 위임으로 중진과 기존 교육 보고를 조회하고 계산·PNG·전화면 계약을 유지한다',async()=>{
 const before=sql('select md5(jsonb_agg(to_jsonb(r) order by id)::text) from attend_records r'),r=await ok('getEduAttendanceReport',params,reader);
 assert.equal(r.summary.total.n,4);assert.equal(r.summary.total.came,2);assert.equal(r.summary.total.excused,1);assert.equal(r.summary.total.absent,1);assert.equal(r.summary.total.rate,'50.0%');assert.equal(r.summary.total.late,1);
 assert.deepEqual(r.audiences,['education','jungjin']);assert.equal(r.parts.length,2);assert.ok(r.parts.every(p=>p.room==='#중진'));assert.ok(!JSON.stringify(r).includes('9900000000201'));
 const asset=await ok('getEduAttendanceAsset',{...params,revision:r.revision,partId:0},reader);assert.equal(Buffer.from(asset.base64,'base64').subarray(1,4).toString(),'PNG');
 const am=await ok('getEduAttendanceReport',{...params,phase:'오전'},reader);assert.equal(am.summary.total.came,1);assert.equal(am.summary.total.excused,1);assert.equal(am.summary.total.absent,2);
 const ordinary=await ok('getEduAttendanceReport',{...params,audience:'education'},reader);assert.equal(ordinary.summary.total.n,10);assert.ok(ordinary.parts.some(p=>p.type==='excel'));assert.ok(!ordinary.parts.some(p=>p.room==='#중진'));
 assert.equal(sql('select md5(jsonb_agg(to_jsonb(r) order by id)::text) from attend_records r'),before);assert.equal(sql('select count(*) from edu_delivery_log'),'0');
 for(const token of [undefined,attender])await deny('getEduAttendanceReport',params,token);
 await deny('tsJungjinTest',{},reader);await deny('tsEduAttSend',{...params,jungjin:true,dry:true},reader);
});
test('단독 화전단과 운영 도구의 dry를 지원하고 재적/선택/수신/위임 변경 후 옛 확인을 거절한다',async()=>{
 const standalone=await ok('getEduAttendanceReport',{...params,meetingId:'MT193001'},reader);assert.equal(standalone.summary.total.n,4);assert.equal(standalone.summary.total.excused,0);assert.deepEqual(standalone.audiences,['jungjin']);
 const dry=await ok('tsEduAttSend',{meetingId:'MT193001',jungjin:true,dry:true,key:'local-only-education-webhook-key'});assert.equal(dry.ok,true);assert.equal(dry.summary.total.n,4);assert.equal(sql('select count(*) from edu_delivery_log'),'0');
 for(const mutate of [()=>sql("update edu_roster set affiliation='가짜변경부' where member_id='9900000000201'"),()=>sql("delete from cohort_summary_log where cohort_id='#excused'"),()=>sql("update report_rooms set chat_id='-990302' where dept='#중진'"),()=>sql(`update education_delegations set revoked=true where nid='${ids.admin}' and scope_id='${ER.series}'`)]){
  seedJungjin();const r=await ok('getEduAttendanceReport',params,reader);mutate();await deny('getEduAttendanceAsset',{...params,revision:r.revision,partId:0},reader);await deny('sendEduAttendanceReport',{...params,revision:r.revision,confirmed:true},reader);
 }
 seedJungjin();sql("delete from edu_roster_policy where roster_key='목요사명자'");await deny('getEduAttendanceReport',params,reader);
});
test('공무 선택 1,000건 뒤도 집계하고 이름을 빼먹지 않는다',async()=>{
 sql(`insert into edu_roster(roster_key,member_id,name,dept,affiliation,position,sort_order) select '목요사명자',(9900034000000+i)::text,'가짜공무대량'||i,'24부서','가짜한부서','담당',100+i from generate_series(1,1005)i;
 insert into cohort_summary_log(cohort_id,kind,ref_id,date) select '#excused','목사교',(9900034000000+i)::text,'${today()}' from generate_series(1,1005)i;`);
 const r=await ok('getEduAttendanceReport',params,reader);assert.equal(r.summary.total.n,1009);assert.equal(r.summary.total.excused,1006);assert.equal(r.summary.total.absent,1);assert.ok(r.parts.some(p=>p.text.includes('가짜공무대량1005')));assert.ok(r.parts.every(p=>p.text.length<=3900));
});
async function fakeNetwork(work){
 const fetchBefore=globalThis.fetch,keys=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','ATT_BOT_TOKEN','TEACHERSQUARE_BOT_TOKEN','TEACHERSQUARE_CRON_KEY','EDU_ATTENDANCE_TEST_CHAT'],saved=Object.fromEntries(keys.map(k=>[k,process.env[k]])),calls=[];let fault=()=>false;
 Object.assign(process.env,{SUPABASE_URL:'http://127.0.0.1:58433',SUPABASE_SERVICE_ROLE_KEY:jwt('service_role'),ATT_BOT_TOKEN:'fake-jungjin-only',TEACHERSQUARE_CRON_KEY:'fake-jungjin-key',EDU_ATTENDANCE_TEST_CHAT:'-990309'});delete process.env.TEACHERSQUARE_BOT_TOKEN;
 globalThis.fetch=async(input,init)=>{
  const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);
  if(u.origin==='https://api.telegram.org'){
   assert.ok(u.pathname.startsWith('/botfake-jungjin-only/'));const b=init.body instanceof FormData?Object.fromEntries(init.body):JSON.parse(init.body),method=u.pathname.split('/').at(-1);assert.match(String(b.chat_id),/^-990\d+$/);
   calls.push({method,chat:String(b.chat_id),text:b.text||b.caption||''});if(fault(calls.at(-1),calls.length))throw Error('가짜 전송 응답 중단');return Response.json({ok:true,result:{message_id:calls.length}});
  }
  if(u.hostname!=='127.0.0.1'||u.port!=='58433')throw Error('외부 호출 차단');return fetchBefore(input,{...init,redirect:'error'});
 };
 try{await work(calls,fn=>{fault=fn;});}finally{globalThis.fetch=fetchBefore;for(const k of keys)if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}
}
test('동시 자동 보고는 한 묶음만 전송하고 옛 완료 기록/시험 수신을 구분한다',async()=>{
 await fakeNetwork(async calls=>{
  const {postJungjin}=await import('../server/lib/edu-attendance.js'),{findMeeting}=await import('../server/actions/attendance.js'),m=await findMeeting(ER.meeting);
  const r=await Promise.all([postJungjin(m,'최종'),postJungjin(m,'최종')]);assert.equal(r.flat().length,1);assert.equal(calls.length,2);assert.deepEqual(calls.map(c=>c.method),['sendPhoto','sendMessage']);assert.equal(sql("select count(*) from cohort_summary_log where cohort_id='#jungjin'"),'1');await postJungjin(m,'최종');assert.equal(calls.length,2);
  sql(`insert into cohort_summary_log(cohort_id,kind,ref_id,date) values('#jungjin','오전','${ER.meeting}','${today()}')`);await postJungjin(m,'오전');assert.equal(calls.length,2);
  sql(`update attend_series set summary_to='test' where series_id='${ER.series}'`);await postJungjin(m,'저녁');assert.ok(calls.slice(2).every(c=>c.chat==='-990309'));assert.equal(sql("select count(*) from cohort_summary_log where cohort_id='#jungjin-test'"),'1');
  sql(`update attend_series set summary_to='live' where series_id='${ER.series}';delete from edu_roster_policy;`);await postJungjin(m,'최종');assert.equal(calls.length,4); // 완료 보고는 재적/카드를 다시 만들지 않음
 });
});
test('사진 응답 불명과 카드 뒤 명단 실패는 완료가 아니며 자동 반복하지 않는다',async()=>{
 await fakeNetwork(async(calls,setFault)=>{
  const {postJungjin}=await import('../server/lib/edu-attendance.js'),{findMeeting}=await import('../server/actions/attendance.js'),m=await findMeeting(ER.meeting);
  setFault(()=>true);assert.deepEqual(await postJungjin(m,'오전'),[]);assert.equal(calls.length,1);await postJungjin(m,'오전');assert.equal(calls.length,1); // 사진 후 글 대체도 없음
  setFault(c=>c.method==='sendMessage');assert.deepEqual(await postJungjin(m,'최종'),[]);assert.equal(calls.length,3);await postJungjin(m,'최종');assert.equal(calls.length,3);
  assert.equal(sql("select count(*) from cohort_summary_log where cohort_id='#jungjin'"),'0');assert.equal(sql("select count(*) from edu_delivery_log where status='unknown' and part_no=0"),'2');
 });
});
test('전송 뒤 옛 완료 기록 저장만 실패하면 재발송 없이 기록을 복구한다',async()=>{
 await fakeNetwork(async()=>{
  const {deliverReportBatch}=await import('../server/lib/report-delivery-batch.js');let calls=0;const c={namespace:'#jungjin',kind:'최종',ref:ER.meeting,date:today(),room:{dept:'#중진',chat_id:'-990301'}};
  sql("create function public.fake_report_log_failure() returns trigger language plpgsql as $$ begin if new.cohort_id='#jungjin' then raise exception 'fake failure'; end if; return new; end $$; create trigger fake_report_log_failure before insert on public.cohort_summary_log for each row execute function public.fake_report_log_failure();");
  try{await assert.rejects(deliverReportBatch(c,async()=>{calls++;}));assert.equal(sql("select count(*) from edu_delivery_log where status='sent'"),'1');}finally{sql('drop trigger fake_report_log_failure on public.cohort_summary_log;drop function public.fake_report_log_failure();');}
  assert.equal((await deliverReportBatch(c,async()=>{calls++;})).state,'sent');assert.equal(calls,1);assert.equal(sql("select count(*) from cohort_summary_log where cohort_id='#jungjin'"),'1');
 });
});
test('22시 뉴스 수신이 확인된 뒤에만 중진 등급을 보내고 같은 날 반복하지 않는다',async()=>{
 await fakeNetwork(async calls=>{
  const {sendJungjinTiers,default:bot}=await import('../server/actions/bot.js');assert.equal((await sendJungjinTiers(today())).wait,'뉴스 먼저');assert.equal(calls.length,0);
  sql(`delete from alert_log where dedup_key='news1_${today()}';insert into alert_log(kind,summary,ok,dedup_key) values('가짜뉴스','가짜',true,'news1_${today()}');`);
  const news=await bot.tsNewsSend({key:'fake-jungjin-key',date:today(),photo:false,text:'가짜 한 줄 데이터 뉴스'});assert.ok(news.rooms.includes('#중진'));const before=calls.length;
  assert.deepEqual((await sendJungjinTiers(today())).sent,['#중진']);assert.equal(calls.length,before+1);assert.match(calls.at(-1).text,/교자장부청 교사 등급 현황/);await sendJungjinTiers(today());assert.equal(calls.length,before+1);
  await bot.tsNewsSend({key:'fake-jungjin-key',date:today(),photo:false,text:'가짜 반복'});assert.equal(calls.length,before+1);assert.equal(sql("select count(*) from cohort_summary_log where cohort_id='#church-room' and ref_id='#중진'"),'2');
 });
});
test('중진 뉴스가 불명확하면 완료/등급 전송 없이 남기고 다른 방의 성공은 보존한다',async()=>{
 await fakeNetwork(async(calls,setFault)=>{
  const {sendJungjinTiers,default:bot}=await import('../server/actions/bot.js');
  sql(`delete from alert_log where dedup_key='news1_${today()}';insert into alert_log(kind,summary,ok,dedup_key) values('가짜뉴스','가짜',true,'news1_${today()}');`);
  setFault(c=>c.chat==='-990301');const result=await bot.tsNewsSend({key:'fake-jungjin-key',date:today(),photo:false,text:'가짜 실패 뉴스'});
  assert.ok(result.rooms.length>0);assert.ok(!result.rooms.includes('#중진'));assert.equal(sql("select count(*) from cohort_summary_log where cohort_id='#church-room' and ref_id='#중진'"),'0');assert.equal((await sendJungjinTiers(today())).wait,'뉴스 먼저');
  const before=calls.length;setFault(()=>false);await bot.tsNewsSend({key:'fake-jungjin-key',date:today(),photo:false,text:'가짜 자동 반복'});assert.equal(calls.length,before);assert.equal(sql("select count(*) from edu_delivery_log where room_key='#중진' and status='unknown'"),'1');
 });
});
