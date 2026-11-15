import {before,test} from 'node:test';
import assert from 'node:assert/strict';
import {seedFeedbackHistory} from './helpers/history-fixture.mjs';
import {ids,PIN,sql} from './helpers/local-db.mjs';
const next='http://127.0.0.1:58434',legacy='http://127.0.0.1:58433';
async function api(action,body={},token,base=next){const r=await fetch(base+'/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...body,...(token?{_tk:token}:{})})});return {status:r.status,body:await r.json()};}
async function ok(action,body={},token,base=next){const r=await api(action,body,token,base);assert.equal(r.status,200,action);assert.equal(r.body.error,undefined,action);return r.body;}
let member,other,admin;
before(async()=>{
 seedFeedbackHistory();
 [member,other,admin]=await Promise.all([[ids.member,'테스트교사','청년회'],[ids.other,'테스트대상','부녀회'],[ids.admin,'테스트교육','청년회']].map(async([memberId,name,dept])=>(await ok('verifyLogin',{memberId,name,dept,pin:PIN})).token));
 assert.ok(member&&other&&admin);
});
test('본인 전체 이력은 기존 API와 같고 1,000건 이후 AI 기록·등록 순서를 보존한다',async()=>{
 const history=await ok('getHistory',{},member);assert.deepEqual(history,await ok('getHistory',{},member,legacy));
 assert.equal(history.rows.length,1008);assert.equal(history.rows[0].receiptNo,'COACH-0001');assert.equal(history.rows[1004].receiptNo,'COACH-1005');
 assert.deepEqual(history.rows.slice(-3).map(r=>r.receiptNo),['AI-ESC','SELF-1','SELF-2']);assert.ok(history.rows.at(-1).submittedAt<history.rows.at(-2).submittedAt);
 assert.equal(history.rows.at(-1).handlerAnswer,'가짜 후속 답변');assert.equal(history.rows.at(-1).status,'완료');assert.match(history.rows.at(-1).aiCoachText,/<script>/);
 const requests=await ok('getMyCoachRequests',{},member);assert.equal(requests.rows.length,1006);assert.ok(requests.rows.every(r=>r.source!=='AI셀프코칭'));
});
test('미로그인·다른 번호 사칭은 거절하고 관리자도 본인 이력만 받는다',async()=>{
 for(const base of [next,legacy]){
  assert.equal((await api('getHistory',{},undefined,base)).status,401);
  assert.equal((await api('getHistory',{memberId:ids.other},member,base)).status,403);
  assert.equal((await api('getHistory',{memberId:ids.member},admin,base)).status,403);
  assert.deepEqual((await ok('getHistory',{},other,base)).rows.map(r=>r.receiptNo),['OTHER-ESC']);
  assert.deepEqual((await ok('getHistory',{},admin,base)).rows,[]);
 }
});
test('이력과 이전 직접 주소의 정적 응답에는 개인 상담 기록이 없다',async()=>{
 for(const path of ['/coaching/history','/feedback-room.html?tab=history']){
  const response=await fetch(next+path);assert.equal(response.status,200);assert.doesNotMatch(await response.text(),/SELF-1|SELF-2|테스트교사|가짜 후속 답변|9900000000001/);
 }
});
test('반복 조회와 새 화면 진입은 저장된 상담·AI 이력을 변경하지 않는다',async()=>{
 const digest=()=>sql("select count(*)||'|'||md5(string_agg(row_to_json(f)::text,'|' order by id)) from feedbacks f");
 const before=digest();await ok('getHistory',{},member);await ok('getHistory',{},member);await fetch(next+'/coaching/history');assert.equal(digest(),before);
});
