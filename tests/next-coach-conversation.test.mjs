import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {journalCoachDraft,planCoachDraft} from '../next-app/lib/coach-conversation.ts';
import {maskName} from '../next-app/lib/status-extra.ts';
const source=readFileSync(new URL('../app.html',import.meta.url),'utf8');
test('일지 교관 요청 문구는 원본의 가린 이름·단계·오늘/다음 활동과 생략 조건을 보존한다',()=>{
 const code=source.slice(source.indexOf('function requestCoachForJournal(idx)'),source.indexOf('async function openCoachPickModal'));
 for(const name of ['가짜대상','김','두글',''])for(const row of [{stage:'복음방',todayWork:'함께 읽음\n질문함',nextWork:'다음 만남',note:'포함하지 않는 비고'},{stage:'',todayWork:'',nextWork:''},{stage:'상담1',todayWork:'',nextWork:' / <글자> '}]){
  let text;const context={home:{detailJournal:{target:{targetName:name},journal:[row]}},maskName,openCoachPickModal:value=>{text=value;}};
  vm.runInNewContext(code,context);context.requestCoachForJournal(0);assert.equal(journalCoachDraft(name,row),text);assert.ok(!text.includes(row.note||'포함하지 않는 비고'));
 }
});
test('센터 계획 상의 문구는 원본의 월 표시·기본 단계·빈 목표를 보존한다',()=>{
 const code=source.slice(source.indexOf('window.glToCoach ='),source.indexOf('// 대상자 상세 → 개강 인도',source.indexOf('window.glToCoach =')));
 for(const goalCohort of ['2027-01','2026-12',''])for(const stage of ['센터수강','복음방','']){
  let text;const target={targetName:'가짜대상',goalCohort,stage};const context={window:{},glTarget:()=>target,glLabel:g=>g?`${Number(g.slice(5))}월 개강`:'',maskName,openCoachPickModal:v=>{text=v;}};
  vm.runInNewContext(code,context);context.window.glToCoach('T');assert.equal(planCoachDraft(target),text);
 }
});
