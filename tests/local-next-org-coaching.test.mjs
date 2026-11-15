import {before,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {seedCoaching} from './helpers/coaching-fixture.mjs';
import {ids,PIN,sql} from './helpers/local-db.mjs';
const next='http://127.0.0.1:58434',legacy='http://127.0.0.1:58433';
async function api(action,body={},token,base=next){const r=await fetch(base+'/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...body,...(token?{_tk:token}:{})})});return{status:r.status,body:await r.json()};}
async function ok(action,body={},token,base=next){const r=await api(action,body,token,base);assert.equal(r.status,200,action);assert.equal(r.body.error,undefined,action+': '+r.body.error);return r.body;}
let member,admin;before(async()=>{seedCoaching();sql(`update feedbacks set handler_answer='가짜 과거 답변',answered_at=submitted_at+interval '2 hours' where status='완료';
 insert into feedbacks(receipt_no,member_id,name,source,situation,ai_coach_text,handler_answer,status,submitted_at,answered_at) values
 ('ORG-AI','${ids.admin}','테스트교육','AI셀프코칭','내보내지 않을 비공개 상황','비공개 AI','','완료','2026-11-01','2026-11-01'),
 ('ORG-ESC','${ids.member}','테스트교사','사람에스컬레이션','비공개 전달','비공개 결과','비공개 답변','완료','2026-11-01 10:00Z','2026-11-01 12:30Z'),
 ('ORG-SPACED',' ${ids.member} ','테스트교사','교관요청','공백 번호 요청','','','접수',now(),null),
 ('ORG-SELF-SPACED',' ${ids.admin} ','테스트교육','교관요청','본인 공백 요청','','','접수',now(),null),
 ('ORG-UNKNOWN','9800000000099','명단 없음','교관요청','없는 명단 요청','','','접수',now(),null);`);// 이전 API의 10초 명단 캐시가 직전 가짜 자료를 유지하지 않도록 기다린다.
 await new Promise(resolve=>setTimeout(resolve,10050));[member,admin]=await Promise.all([[ids.member,'테스트교사'],[ids.admin,'테스트교육']].map(async([memberId,name])=>(await ok('verifyLogin',{memberId,name,dept:'청년회',pin:PIN})).token));});
function oldSnapshot(roster,rows,settlement){const html=readFileSync(new URL('../app.html',import.meta.url),'utf8'),part=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a))),ctx={roster:roster.rows,rosterTiers:roster.tiers,rows,settlement};vm.createContext(ctx);vm.runInContext(part('const ORG_MAIN_DEPTS =','const EDU_DEPT_ICON =')+part('function daysDiff(', 'async function load()')+part('function buildRosterStats()', '// 2026-09-23: 막대그래프 제거 요청')+part('function buildOrgSnapshot()', 'function buildOrgAiPrompt('),ctx);return JSON.parse(JSON.stringify(ctx.buildOrgSnapshot()));}
test('관리자 집계 API는 비로그인·일반 회원·사칭을 거절하고 원문·번호를 반환하지 않는다',async()=>{
 assert.equal((await api('getOrgAiSnapshot')).status,401);assert.ok((await api('getOrgAiSnapshot',{},member)).body.error);assert.equal((await api('getOrgAiSnapshot',{memberId:ids.admin},member)).status,403);const data=await ok('getOrgAiSnapshot',{},admin);assert.doesNotMatch(JSON.stringify(data),/비공개|990000000000|receiptNo|handlerAnswer|aiCoachText|memberId/);assert.equal(data.snapshot.피드백_전체.total,1014);assert.equal(data.snapshot.피드백_전체.avgHours,'2.5');const page=await fetch(next+'/admin/analysis');assert.equal(page.status,200);assert.doesNotMatch(await page.text(),/990000000000|테스트교사|비공개/);
});
test('1,000건 이후·가려진 번호 매칭·선택적 결산 입력이 현재 기존 API와 HTML 계산 그대로다',async()=>{
 const roster=await ok('getRoster',{indexOnly:true},admin),feedbacks=await ok('getFeedbackIndex',{},admin);for(const includeSettlement of [false,true]){const actual=await ok('getOrgAiSnapshot',{includeSettlement},admin),settlement=includeSettlement?await ok('getSettlementReport',{},admin):null;assert.deepEqual(actual.snapshot,oldSnapshot(roster,feedbacks.rows,settlement));assert.deepEqual(actual,await ok('getOrgAiSnapshot',{includeSettlement},admin,legacy));assert.equal(actual.settlementIncluded,includeSettlement);}
 const body=(await ok('getOrgAiSnapshot',{},admin)).snapshot;assert.equal(body.피드백_부서별.reduce((n,d)=>n+d.total,0),body.피드백_전체.total-2);
});
test('슬라이드 JSON·전체 분석 생성은 AI 이력을 추가하지 않고 가짜 AI만 사용한다',async()=>{
 const before=sql('select count(*) from feedbacks'),{SYSTEM}=await import('../next-app/lib/coaching-slides.mjs');const payload={contents:[{role:'user',parts:[{text:'### 가짜 심리 상담'}]}],systemInstruction:{parts:[{text:SYSTEM}]},generationConfig:{responseMimeType:'application/json',temperature:.5}};const response=await ok('generateContent',{payload},member),parts=response.candidates[0].content.parts,raw=parts.filter(p=>!p.thought).map(p=>p.text).join('');assert.equal(JSON.parse(raw).cover.line1,'가짜 상담 자료');const {buildOrgAiPrompt}=await import('../next-app/lib/org-coaching-prompt.mjs'),snapshot=(await ok('getOrgAiSnapshot',{},admin)).snapshot;const analysis=await ok('generateContent',{payload:{contents:[{role:'user',parts:[{text:buildOrgAiPrompt(snapshot)}]}]}},admin);assert.match(analysis.candidates[0].content.parts[0].text,/전체 활동 패턴/);assert.equal(sql('select count(*) from feedbacks'),before);
});
