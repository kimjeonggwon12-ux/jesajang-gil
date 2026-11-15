import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as p from '../next-app/lib/coaching-prompts.mjs';
import {initialStudent,fromDossier,studentRequest,teacherRequest,followUpRequest,resultText,reportHtml} from '../next-app/lib/coaching.ts';
import {districtCoachingData} from '../next-app/lib/district-coaching.ts';
import {ROLES,ROLE_ITEMS} from '../next-app/lib/status.ts';
const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const section=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
const old=vm.createContext({});vm.runInContext(section('function getSagunjaOptions(', 'function mdInline(')+section('function extractHeartsTypes(', 'async function copyResult('),old);
test('대상 4종·단계 6종·심리/후속 상담 프롬프트와 선택지가 기존과 같다',()=>{
 for(const target of p.TARGET_OPTIONS){for(const fn of ['getMbtiOptions','getSagunjaOptions'])assert.deepEqual(p[fn](target),JSON.parse(JSON.stringify(old[fn](target))));assert.equal(p.buildAnalyzeSystemInstruction(target),old.buildAnalyzeSystemInstruction(target));
 for(const stage of p.STAGE_OPTIONS){const args=[target,stage,'초등','안전','INTJ','3번','D','외매','가짜 상황',['가짜유형']];assert.deepEqual(p.buildCoachingPrompt(...args),JSON.parse(JSON.stringify(old.buildCoachingPrompt(...args))));assert.equal(p.buildAnalyzePrompt(target,stage,'INTJ','3번','D','외매','가짜상황'),old.buildAnalyzePrompt(target,stage,'INTJ','3번','D','외매','가짜상황'));}}
 const history=[{role:'user',text:'추가 질문'},{role:'model',text:'추가 답변'}];assert.equal(followUpRequest('상황','결과',history,'다음?').payload.contents[0].parts[0].text,old.buildFollowUpPrompt('상황','결과',history,'다음?'));
 for(const key of ['DISC_OPTIONS','ENNEAGRAM_OPTIONS','TARGET_OPTIONS','STAGE_OPTIONS','COURSE_TYPE_OPTIONS','STATUS_OPTIONS','STAGE_DESCRIPTIONS'])assert.deepEqual(p[key],JSON.parse(vm.runInContext(`JSON.stringify(${key})`,old)));
});
test('누적 기록은 기존 태그·마스킹·글자 예산 계약 그대로 전송하고 오류와 HTML은 실행하지 않는다',()=>{
 const d={target:{targetId:'T',name:'가짜대상',stage:'상담2',gender:'여',ageGroup:'40대',goalCohort:'2027-01'},context:'가짜 누적 기록',lastAnalyze:'### 추천 유형\n**가짜 유형**'};const form=fromDossier(initialStudent(),d);assert.equal(form.stage,'상담');assert.equal(form.targetGroup,'부녀');assert.deepEqual(form.linkedTypes,['가짜 유형']);assert.match(form.situationText,/가\*\*상/);const body=studentRequest({...form,situationText:'가짜 새 상황'},d);assert.match(body.situation,/^\[수강생코칭\/부녀\/상담\]\[누적기록\] 대상자:/);assert.match(body.payload.contents[0].parts[0].text,/가짜 누적 기록/);assert.ok(!body.memberId);assert.match(teacherRequest('고민').payload.contents[0].parts[0].text,/\\n\\n상황: 고민$/);
 assert.throws(()=>resultText('⚠️ 실패'),/실패/);assert.throws(()=>resultText(''));assert.equal(resultText('정상'), '정상');assert.doesNotMatch(reportHtml('<img src=x onerror=alert(1)> **내용**'),/<img/);assert.match(reportHtml('<script>'),/&lt;script&gt;/);
});
test('부서 AI 입력은 이전 역할별 합계·동률 강세 순서와 같고 개인 정보가 포함되지 않는다',()=>{
 const b={allRegions:['1지역','2지역'],regionRoleTotal:{'1지역':Object.fromEntries(ROLES.map((r,i)=>[r,i+1])),'2지역':Object.fromEntries(ROLES.map(r=>[r,0]))},regionItemTotal:{'1지역':{피드백:2,섭외:2},'2지역':{}},itemGrandTotal:{피드백:2,섭외:2},grandTotal:10};const ctx={ROLE_PARTS_DASH:ROLES,ROLE_ACTIVITY_ITEMS_DASH:ROLE_ITEMS};vm.createContext(ctx);vm.runInContext(section('function regionTopItem(', 'function regionTopItemValue('),ctx);vm.runInContext(section('function buildAiAnalysisData(', 'async function runAiAnalysis('),ctx);assert.deepEqual(districtCoachingData('청년회','전체',b),JSON.parse(JSON.stringify(ctx.buildAiAnalysisData('청년회','전체',b))));assert.equal(districtCoachingData('청년회','전체',b).지역별[1].강세항목,'-');
});
