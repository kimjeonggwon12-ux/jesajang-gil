import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {buildOrgSnapshot,computeFeedbackStats} from '../server/lib/org-coaching.js';
import {buildOrgAiPrompt} from '../next-app/lib/org-coaching-prompt.mjs';
const html=readFileSync(new URL('../app.html',import.meta.url),'utf8'),part=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a))),ctx={};vm.createContext(ctx);vm.runInContext(part('const ORG_MAIN_DEPTS =','const EDU_DEPT_ICON =')+part('function daysDiff(', 'async function load()')+part('function buildRosterStats()', '// 2026-09-23: 막대그래프 제거 요청')+part('function buildOrgSnapshot()', 'async function runOrgAiAnalysis('),ctx);const plain=x=>JSON.parse(JSON.stringify(x));
test('전체 AI 입력은 기존 여섯 부서·등급·상담 비율·답변 시간·선택적 결산과 같다',()=>{
 const roster=[{memberId:'1',dept:'청년회',tier:'정교사'},{memberId:'2',dept:'교육부',tier:'활동교사'},{memberId:'3',dept:'부녀회',tier:''},{memberId:' 01 ',dept:'장년회',tier:'옛 등급'},{memberId:'1',dept:'자문회',tier:'정교사'}],tiers=['활동교사','정교사'],rows=[{memberId:'1',source:'AI셀프코칭',status:'완료'},{memberId:'2',source:'사람에스컬레이션',status:'완료',submittedAt:'2026-11-01T00:00:00Z',answeredAt:'2026-11-01T02:30:00Z'},{memberId:'3',source:'사람에스컬레이션',status:'접수'},{memberId:'01',source:'교관요청',status:'완료'},{memberId:'999',source:'교관요청',status:'접수'}];
 for(const feedback of [rows,[],rows.slice(1,2)])for(const settlement of [null,{error:'실패'},{promotionsTotal:3,demotionsTotal:2,inactiveTotal:1,pendingApprovalCount:4,leaders:Array.from({length:12},(_,i)=>({name:'가짜'+i,region:'1지역',leadCount:12-i}))}]){Object.assign(ctx,{roster,rosterTiers:tiers,rows:feedback,settlement});const expected=plain(ctx.buildOrgSnapshot()),actual=buildOrgSnapshot(roster,tiers,feedback,settlement);assert.deepEqual(actual,expected);assert.equal(buildOrgAiPrompt(actual),ctx.buildOrgAiPrompt(expected));}
 assert.deepEqual(computeFeedbackStats(rows),{total:5,answeredCount:3,aiPct:20,escPct:40,avgHours:'2.5'});const s=buildOrgSnapshot(roster,tiers,rows);assert.equal(s.피드백_부서별.find(d=>d.부서==='자문회').total,1);assert.equal(s.피드백_부서별.find(d=>d.부서==='장년회').total,1);assert.equal(s.피드백_부서별.reduce((n,d)=>n+d.total,0),4);
});
