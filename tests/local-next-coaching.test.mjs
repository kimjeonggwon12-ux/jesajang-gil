import {before,test} from 'node:test';
import assert from 'node:assert/strict';
import {seedCoaching} from './helpers/coaching-fixture.mjs';
import {ids,PIN,sql,quote} from './helpers/local-db.mjs';
const next='http://127.0.0.1:58434',legacy='http://127.0.0.1:58433';
async function api(action,body={},token,base=next){const r=await fetch(base+'/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...body,...(token?{_tk:token}:{})})});return{status:r.status,body:await r.json()};}
async function ok(action,body={},token){const r=await api(action,body,token);assert.equal(r.status,200,action);assert.equal(r.body.error,undefined,action+': '+r.body.error);return r.body;}
let member,admin,coach,other;
before(async()=>{seedCoaching();[member,admin,coach,other]=await Promise.all([[ids.member,'테스트교사','청년회'],[ids.admin,'테스트교육','청년회'],[ids.coach,'테스트교관','청년회'],[ids.other,'테스트대상','부녀회']].map(async([memberId,name,dept])=>(await ok('verifyLogin',{memberId,name,dept,pin:PIN})).token));assert.ok(member&&admin&&coach&&other);});
test('새 상담 경로는 개인정보를 정적 HTML에 넣지 않고 기존 API와 성공 응답이 같다',async()=>{
 for(const [action,body,token]of [['getMyCoach',{},member],['getMyCoachRequests',{},member],['getCoachFeedbacks',{},coach],['getAllFeedback',{},admin],['heartsDossier',{targetId:'COACH-TARGET'},member]])assert.deepEqual(await ok(action,body,token),(await api(action,body,token,legacy)).body,action);
 const r=await fetch(next+'/coaching');assert.equal(r.status,200);assert.doesNotMatch(await r.text(),/990000000000|가짜 누적 활동|테스트교관/);assert.equal((await api('getCoachFeedbacks')).status,401);
});
test('1,000개 이후 요청·AI 전달을 보존하고 겸직 범위만 합친다',async()=>{
 const mine=await ok('getMyCoachRequests',{},member);assert.equal(mine.rows.length,1006);assert.ok(mine.rows.some(r=>r.receiptNo==='COACH-1005'));const inbox=await ok('getCoachFeedbacks',{},coach);assert.equal(inbox.pending.length,3);assert.equal(inbox.answered.length,1004);assert.equal(inbox.pending.find(r=>r.receiptNo==='AI-ESC').aiCoachText,'전달할 가짜 AI 답');assert.ok(inbox.pending.some(r=>r.receiptNo==='OTHER-ESC'));assert.ok(!inbox.pending.some(r=>r.receiptNo.startsWith('CROSS')));
 for(const feedbackId of ['CROSS-1','CROSS-2'])assert.ok((await api('submitCoachReply',{feedbackId,reply:'거절되어야 함'},coach)).body.error);assert.equal((await api('getCoachFeedbacks',{coachId:ids.coach},member)).status,403);assert.ok((await api('getAllFeedback',{},member)).body.error);
});
test('빈 지역 교관·일반 회원의 답변을 거절하고 담당 교관의 답변은 요청자에게 남긴다',async()=>{
 sql(`update admins set region='' where nid='${ids.coach}'`);assert.equal((await ok('getCoachFeedbacks',{},coach)).pending.length,0);assert.ok((await api('submitCoachReply',{feedbackId:'AI-ESC',reply:'실패'},coach)).body.error);sql(`update admins set region=case when dept='청년회' then '1지역' else '2지역' end where nid='${ids.coach}'`);
 assert.ok((await api('submitCoachReply',{feedbackId:'AI-ESC',reply:'일반 회원'},member)).body.error);await ok('submitCoachReply',{feedbackId:'AI-ESC',reply:'가짜 정식 답변'},coach);const row=(await ok('getMyCoachRequests',{},member)).rows.find(r=>r.receiptNo==='AI-ESC');assert.equal(row.handlerAnswer,'가짜 정식 답변');assert.equal(row.status,'완료');assert.ok(row.answeredAt);
});
test('AI 오류·경고는 완료 이력을 만들지 않고 정상 답만 본인 이름으로 저장한다',async()=>{
 const count=Number(sql('select count(*) from feedbacks')),body=text=>({situation:text,payload:{contents:[{parts:[{text}]}]}});
 for(const text of ['__LOCAL_AI_ERROR__','__LOCAL_AI_WARNING__'])assert.ok((await api('aiCoach',body(text),member)).body.error);assert.equal(Number(sql('select count(*) from feedbacks')),count);
 const r=await ok('aiCoach',body('가짜 교사 코칭'),member);assert.ok(r.receiptNo);assert.match(r.coachText,/로컬 검증용/);assert.equal(sql(`select member_id||'|'||name||'|'||status from feedbacks where receipt_no=${quote(r.receiptNo)}`),`${ids.member}|테스트교사|완료`);assert.equal((await api('aiCoach',{...body('사칭'),memberId:ids.other},member)).status,403);
});
test('대상자 누적 자료는 소유 범위를 유지하고 추가 질문·지역 분석은 새 상담 이력을 만들지 않는다',async()=>{
 const d=await ok('heartsDossier',{targetId:'COACH-TARGET'},member);assert.match(d.context,/가짜 취미 기록/);assert.ok((await api('heartsDossier',{targetId:'COACH-PRIVATE'},member)).body.error);const count=sql('select count(*) from feedbacks');await ok('generateContent',{payload:{contents:[{parts:[{text:'가짜 추가 질문'}]}]}},member);const analysis=await ok('analyzeDistrictData',{data:{부서:'청년회',지역필터:'전체',지역별:[],항목별전체합계:{},전체합계:0}},member);assert.match(analysis.text,/전체 활동 패턴/);assert.equal(sql('select count(*) from feedbacks'),count);
 const request=await ok('requestCoach',{content:'가짜 직접 요청'},member);assert.ok((await ok('getCoachFeedbacks',{},coach)).pending.some(r=>r.receiptNo===request.receiptNo));
 const esc=await ok('escalate',{situation:'가짜 상황',aiCoachText:'가짜 AI 결과'},member);assert.equal((await ok('getCoachFeedbacks',{},coach)).pending.find(r=>r.receiptNo===esc.receiptNo).aiCoachText,'가짜 AI 결과');
});
