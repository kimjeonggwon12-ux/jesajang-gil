import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {TARGET_FLOW,TARGET_FLOW_SHORT,targetFlowIndex,toggleInfoCategory,infoCategories,activityFeedbackPayload,checkedFeedbackText} from '../next-app/lib/target-insights.ts';
import {maskName} from '../next-app/lib/status-extra.ts';
import {localAiFixture} from '../tools/local-ai-fixture.mjs';
const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
test('센터 과정·단계 게이지의 13칸과 미입력 처리는 기존 HTML 계산과 같다',()=>{
  const start=html.indexOf('    const ER_COURSE_FLOW ='),end=html.indexOf('    function erFlowHtml',start);
  const old={RP_COURSES:['초등','중등','고등','수료']};vm.createContext(old);vm.runInContext(html.slice(start,end),old);
  assert.deepEqual(TARGET_FLOW,JSON.parse(vm.runInContext('JSON.stringify(ER_FULL_FLOW)',old)));
  assert.deepEqual(TARGET_FLOW_SHORT,JSON.parse(vm.runInContext('JSON.stringify(ER_FLOW_SHORT)',old)));
  for(const stage of [...TARGET_FLOW,'센터소개','센터수강','알수없음',''])for(const course of ['','개강','초등','중등','고등','수료','이전과정']){old.stage=stage;old.prof={course};assert.equal(targetFlowIndex(stage,course),vm.runInContext('erFlowIndex(stage,prof)',old));}
});
test('복수 분류는 마지막 선택을 유지하고 옛 단일 분류와 같은 필터·개수를 만든다',()=>{
  const old={window:{},erInfo:{T:{sel:['기타']}},renderHome:()=>{},document:{getElementById:()=>null}};vm.createContext(old);
  const start=html.indexOf('    window.erInfoCat ='),end=html.indexOf('    window.erInfoFilter',start);vm.runInContext(html.slice(start,end),old);
  let selected=['기타'];for(const cat of ['기타','가족','관심사·취미','기타','가족','관심사·취미']){old.window.erInfoCat('T',cat);selected=toggleInfoCategory(selected,cat);assert.deepEqual(selected,JSON.parse(JSON.stringify(old.erInfo.T.sel)));}
  const items=[{cat:'가족',cats:[]},{cat:'가족, 기타',cats:['가족','기타']},{cat:'',cats:[]}];assert.equal(items.filter(row=>infoCategories(row).includes('가족')).length,2);assert.deepEqual(infoCategories(items[2]),['기타']);
});
test('활동 피드백은 기존 첫 동명 대상자·가림 이름·본문 요청 계약을 보존한다',async()=>{
  const row={id:40,targetName:' 가짜대상 ',targetStage:'복음방',todayWork:'가짜 활동',nextWork:'가짜 계획'},targets=[{targetId:'FIRST',targetName:'가짜대상'},{targetId:'SECOND',targetName:' 가짜대상 '}];
  const old={home:{monthlyActRes:{rows:[row]},targets,aiFeedback:{}},activityFullRows:new Map(),activityRowKey:a=>'activity-'+a.id,fullActivity:async()=>row,renderHome:()=>{},refreshActivityOverview:async()=>{},memberId:'9900000000001',maskName,todayStr:()=>'',callApi:async body=>{old.sent=body;return {text:'가짜 피드백'};}};vm.createContext(old);
  const start=html.indexOf('    async function runActivityAiFeedback('),end=html.indexOf('    //',html.indexOf('      home.aiFeedback[key] = { loading: false, text: \'오류가 발생했습니다:',start));vm.runInContext(html.slice(start,end),old);await old.runActivityAiFeedback('activity-40');
  const {action,memberId,...expected}=old.sent;assert.equal(action,'getActivityFeedback');assert.deepEqual(activityFeedbackPayload(row,targets,maskName(row.targetName)),JSON.parse(JSON.stringify(expected)));
  assert.equal(activityFeedbackPayload({...row,targetName:'없는 사람'},targets,'없*람').targetId,'');
  assert.equal(checkedFeedbackText('기존 결과'),'기존 결과');assert.throws(()=>checkedFeedbackText('⚠️ 실패'),/실패/);assert.throws(()=>checkedFeedbackText(''),/내용/);
});
test('가짜 AI는 명시한 로컬 옵션·정확한 주소에서만 응답하고 실패를 재현한다',async()=>{
  const saved=process.env.LOCAL_AI_FIXTURES,url='https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent';
  try{delete process.env.LOCAL_AI_FIXTURES;assert.equal(await localAiFixture(url,{}),null);process.env.LOCAL_AI_FIXTURES='1';assert.equal(await localAiFixture('https://example.test/',{}),null);
    const body=text=>({body:JSON.stringify({contents:[{parts:[{text}]}]})});
    assert.equal((await localAiFixture(url,body('__LOCAL_AI_ERROR__'))).status,400);
    assert.match((await(await localAiFixture(url,body('가짜 요청'))).json()).candidates[0].content.parts[0].text,/로컬 검증용 가짜/);
  }finally{if(saved===undefined)delete process.env.LOCAL_AI_FIXTURES;else process.env.LOCAL_AI_FIXTURES=saved;}
});
