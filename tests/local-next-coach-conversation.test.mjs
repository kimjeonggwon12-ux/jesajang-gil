import {before,test} from 'node:test';
import assert from 'node:assert/strict';
import {ids,PIN,sql} from './helpers/local-db.mjs';
import {seedCoachConversation} from './helpers/coach-conversation-fixture.mjs';
import {journalCoachDraft,planCoachDraft} from '../next-app/lib/coach-conversation.ts';
const next='http://127.0.0.1:58434',old='http://127.0.0.1:58433';
async function api(action,body={},token,base=next){const r=await fetch(base+'/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...body,...(token?{_tk:token}:{})})});return {status:r.status,body:await r.json()};}
async function ok(action,body,token){const r=await api(action,body,token);assert.equal(r.status,200);assert.equal(r.body.error,undefined);return r.body;}
let member,coach,admin,guest;
before(async()=>{
 seedCoachConversation();
 const login=async(id,name)=>(await ok('verifyLogin',{memberId:id,name,dept:'청년회',pin:PIN})).token;
 member=await login(ids.member,'테스트교사');coach=await login(ids.coach,'테스트교관');admin=await login(ids.admin,'테스트교육');
 guest=(await ok('guestLogin',{memberId:'99000999',name:'가짜손님',dept:'청년회',code:'COACHG29'})).token;
 assert.ok(member&&coach&&admin&&guest);
});
test('교관 선택은 원본의 네 부서·지역 제한 없음·직책 판정·중복/본인 제외·정렬·번호 가림을 보존한다',async()=>{
 const result=await ok('getCoachList',{},member);assert.deepEqual(result,(await api('getCoachList',{},member,old)).body);
 assert.equal(result.rows.length,5);assert.deepEqual(result.rows.map(r=>r.name),['가짜부녀교관','가짜자문교관','테스트대상','가짜청년교관','테스트교관']);
 assert.equal(result.rows.find(r=>r.name==='테스트교관').dept,'청년회');assert.equal(result.rows.find(r=>r.name==='가짜청년교관').region,'9지역');
 for(const row of result.rows)assert.match(row.coachId,/^r_/);
 assert.doesNotMatch(JSON.stringify(result),/99000000000/);
 assert.ok(!(await ok('getCoachList',{},coach)).rows.some(r=>r.name==='테스트교관'));
 assert.equal((await api('getCoachList')).status,401);assert.equal((await api('getCoachList',{},guest)).status,403);assert.equal((await api('getCoachList',{memberId:ids.coach},member)).status,403);
});
test('일지/계획 초안과 교관 대화 열기는 발송하지 않고 명시한 전송만 실제 상대에게 저장한다',async()=>{
 const row=(await ok('getCoachList',{},member)).rows.find(r=>r.name==='테스트교관'),chatId=[ids.member,row.coachId].sort().join('__');
 const journal=await ok('getTargetJournal',{targetId:'COACH-TARGET'},member),target=(await ok('getMyTargets',{},member)).rows[0];
 assert.equal(journal.journal[0].note,'가짜 특이사항');
 const drafts=[journalCoachDraft(journal.target.targetName,journal.journal[0]),planCoachDraft(target)];
 assert.equal(sql('select count(*) from chat_messages'),'0');
 assert.deepEqual((await ok('getMessages',{chatId,paged:true},member)).rows,[]);assert.equal(sql('select count(*) from chat_messages'),'0');
 for(const message of drafts)await ok('sendMessage',{toId:row.coachId,message},member);
 assert.equal(sql('select count(*) from chat_messages'),'2');assert.equal(sql('select count(*) from chat_messages where from_id=\''+ids.member+'\' and to_id=\''+ids.coach+'\''),'2');
 assert.deepEqual((await ok('getMessages',{chatId,paged:true},member)).rows.map(r=>r.message),drafts);
 const inbox=await ok('getChatList',{},coach);assert.equal(inbox.rows.length,1);assert.equal(inbox.rows[0].lastMessage,drafts[1]);assert.equal(inbox.rows[0].unreadCount,2);
 assert.equal((await api('getMessages',{chatId,paged:true},admin)).status,403);
 assert.equal((await api('sendMessage',{fromId:ids.other,toId:row.coachId,message:'사칭'},member)).status,403);
 assert.equal((await api('sendMessage',{toId:row.coachId,message:'손님'},guest)).status,403);assert.equal(sql('select count(*) from chat_messages'),'2');
});
test('해당 부서 교관이 없으면 빈 목록을 반환하며 임의 대상을 추가하지 않는다',async()=>{
 sql("update teachers set position=''; update admins set position='교사'");
 assert.deepEqual(await ok('getCoachList',{},member),{rows:[]});assert.equal(sql('select count(*) from chat_messages'),'2');
});
