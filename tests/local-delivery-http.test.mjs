import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {seedEducation} from './helpers/education-fixture.mjs';
import {sql} from './helpers/local-db.mjs';
const bases=['http://127.0.0.1:58433','http://127.0.0.1:58434'];
const secret=createHash('sha256').update('local-only-education-webhook-key|att-tg').digest('hex').slice(0,48);
const body=(id=990801,chat=-990001,text='방번호')=>({update_id:id,message:{message_id:id,chat:{id:chat,type:'supergroup'},from:{id:990202,first_name:'가짜 학생'},text}});
async function tg(base,value,key=secret){const r=await fetch(base+'/api/tg',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':key},body:typeof value==='string'?value:JSON.stringify(value)});return{status:r.status,body:await r.json()};}
const stats=async()=> (await(await fetch(bases[0]+'/__local_report_fixture/stats')).json()).calls;
beforeEach(async()=>{seedEducation();await fetch(bases[0]+'/__local_report_fixture/reset',{method:'POST'});});
test('기존 API와 Next 진입점의 인증·형식 거절이 같고 저장/전송하지 않는다',async()=>{
 for(const base of bases){assert.equal((await tg(base,body(),'bad')).status,401);assert.equal((await tg(base,'{')).status,400);assert.equal((await tg(base,{})).status,400);}
 assert.equal(sql('select count(*) from telegram_update_receipts'),'0');assert.deepEqual(await stats(),[]);
});
test('구/신 서버에 같은 웹훅을 동시에 보내도 수신 기록과 답장은 하나다',async()=>{
 const replies=await Promise.all(bases.map(base=>tg(base,body())));assert.ok(replies.some(x=>x.body.ok));assert.ok(replies.some(x=>x.body.duplicate));
 assert.equal((await stats()).length,1);assert.equal(sql('select status from telegram_update_receipts'),'done');
 for(const base of bases)assert.equal((await tg(base,body())).body.duplicate,true);assert.equal((await stats()).length,1);
});
test('가짜 전송 거절 후 양쪽 서버 재전달은 확인 필요이고 답장을 반복하지 않는다',async()=>{
 const u=body(990802,-990999);const r=await tg(bases[0],u);assert.equal(r.status,200);assert.equal(r.body.ok,false);assert.equal(r.body.needsReview,true);
 for(const base of bases)assert.equal((await tg(base,u)).body.needsReview,true);assert.equal((await stats()).length,1);assert.equal(sql('select status from telegram_update_receipts'),'unknown');
});
test('과제 제출과 수정은 실제 DB에 보존되며 재수신이 새 수정본을 덮지 않는다',async()=>{
 const first=body(990803,-990001,'제출 테스트교사 가짜 과제 A 첫 내용'),second=body(990804,-990001,'제출 가짜 과제 A 수정 내용');
 assert.equal((await tg(bases[0],first)).body.ok,true);assert.equal((await tg(bases[1],second)).body.ok,true);
 assert.equal(sql('select count(*) from cohort_submissions'),'1');assert.match(sql('select content from cohort_submissions'),/수정 내용/);
 assert.equal((await tg(bases[1],first)).body.duplicate,true);assert.match(sql('select content from cohort_submissions'),/수정 내용/);assert.equal((await stats()).length,2);
});
