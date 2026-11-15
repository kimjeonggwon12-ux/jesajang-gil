import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {sql,ids,login} from './helpers/local-db.mjs';
import {seedEducation,OWNER,A} from './helpers/education-fixture.mjs';
const bases=['http://127.0.0.1:58433','http://127.0.0.1:58434'];
let owner,admin,member;
async function review(base,params={},token=owner){const r=await fetch(base+'/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'getDeliveryReview',...params,...(token?{_tk:token}:{})})});return{status:r.status,body:await r.json()};}
beforeEach(async()=>{
  seedEducation();sql(`truncate edu_delivery_log,cohort_summary_log;insert into education_delegations(scope_type,scope_id,nid,permissions,actor_nid) values('cohort','${A}','${ids.admin}','{reports}','${OWNER}');
  insert into edu_delivery_log(delivery_key,meeting_id,phase,room_key,part_no,mode,status,created_at) select 'fake-review-'||i,'MT990001','최종','가짜 보고방',i,'auto',case when i%2=0 then 'unknown' else 'sending' end,'2026-11-14T01:00:00Z' from generate_series(1,1005) i;
  insert into edu_delivery_log(delivery_key,meeting_id,phase,room_key,part_no,mode,status) values('fake-done','MT990001','최종','가짜 보고방',0,'auto','sent');
  insert into telegram_update_receipts(bot_key,update_id,payload_hash,status,received_at) select '990123',i,repeat('a',64),case when i%2=0 then 'unknown' else 'processing' end,'2026-11-14T01:00:00Z' from generate_series(1,1005) i;
  insert into telegram_update_receipts(bot_key,update_id,payload_hash,status) values('990123',1006,repeat('b',64),'done');`);
  owner=(await login(OWNER,'테스트앱관리')).body.token;admin=(await login(ids.admin,'테스트교육')).body.token;member=(await login()).body.token;assert.ok(owner&&admin&&member);
});
const snapshot=()=>sql("select md5(string_agg(row_to_json(x)::text,'|' order by delivery_key)) from edu_delivery_log x;select md5(string_agg(row_to_json(x)::text,'|' order by bot_key,update_id)) from telegram_update_receipts x;");
test('구/신 API 모두 앱 관리자만 전체 기록을 보며 과정 위임·사칭은 거절한다',async()=>{
  for(const base of bases){for(const token of ['',admin,member]){const r=await review(base,{memberId:OWNER},token);assert.ok([401,403].includes(r.status));assert.ok(!r.body.rows);}}
  sql(`update member_pins set ver='review-revoked' where nid='${OWNER}'`);
  for(const base of bases)assert.equal((await review(base)).status,401);
});
test('완료 건 제외·1000건 초과 총계·쪽 이동·구/신 응답과 읽기 전용 상태가 일치한다',async()=>{
  const before=snapshot();
  for(const source of ['reports','webhooks'])for(const page of [1,2,21,22]){
    const results=[];
    for(const base of bases){const {status,body}=await review(base,{source,page,op:'replay',confirmed:true});assert.equal(status,200);assert.equal(body.total,1005);assert.equal(body.rows.length,page===22?0:page===21?5:50);assert.equal(body.hasMore,page<21);assert.ok(body.rows.every(r=>['sending','processing','unknown'].includes(r.status)));
      assert.ok(!/payload_hash|delivery_key|pin_hash|token|chat_id/.test(JSON.stringify(body)));delete body.checkedAt;results.push(body);}
    assert.deepEqual(results[0],results[1]);
  }
  const first=(await review(bases[0],{source:'webhooks'})).body.rows,second=(await review(bases[0],{source:'webhooks',page:2})).body.rows;
  assert.equal(new Set([...first,...second].map(r=>r.update_id)).size,100);assert.equal(snapshot(),before);
});
test('조회 오류를 빈 목록으로 표시하지 않고 오류 후 회복·빈 상태를 구분한다',async()=>{
  sql('revoke select on public.edu_delivery_log from service_role');
  try{for(const base of bases){const r=await review(base);assert.ok(r.body.error);assert.ok(!r.body.rows);}}finally{sql('grant select on public.edu_delivery_log to service_role');}
  for(const base of bases)assert.equal((await review(base)).body.total,1005);
  sql("update edu_delivery_log set status='sent';update telegram_update_receipts set status='done'");
  for(const base of bases)for(const source of ['reports','webhooks']){const r=await review(base,{source});assert.equal(r.body.total,0);assert.deepEqual(r.body.rows,[]);}
});
test('잘못된 종류·쪽은 거절하며 자동 발송과 연결 설정을 건드리지 않는다',async()=>{
  const before=snapshot();for(const base of bases)for(const params of [{source:'all'},{page:0},{page:1.5},{page:100001},{page:'NaN'}])assert.equal((await review(base,params)).status,400);
  assert.equal(snapshot(),before);
});
