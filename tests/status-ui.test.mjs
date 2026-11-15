import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const part=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
function harness(response) {
 const c={state:{dept:'청년회',cache:{}},calls:[],allReads:0,renders:0,distRender(){c.renders++;},loadAllActivities(){c.allReads++;},callApi:async body=>{c.calls.push(body);return response;}};
 vm.createContext(c);vm.runInContext(part('async function loadReport(force)','async function loadOrgSummary'),c);return c;
}
test('부서 진입은 월별 집계를 한 번 요청하고 원본 전체 활동을 추가 요청하지 않는다',async()=>{
 const c=harness({rows:[],byRegion:[{region:'10지역'},{region:'2지역'}],analysisRows:[]});await vm.runInContext('loadReport(false)',c);
 assert.equal(c.calls.length,1);assert.equal(c.calls[0].analysis,true);assert.match(c.calls[0].analysisMonth,/^\d{4}-\d{2}$/);assert.equal(c.allReads,0);assert.equal(c.state.cache['청년회'].byRegion[0].region,'2지역');
});
test('이전 서버가 집계를 제공하지 않을 때만 기존 전체 활동 조회로 호환한다',async()=>{
 const c=harness({rows:[],byRegion:[]});await vm.runInContext('loadReport(false)',c);assert.equal(c.allReads,1);
});
test('이미 받은 집계를 재사용하며 명시적 새로고침에서는 다시 조회한다',async()=>{
 const c=harness({rows:[],byRegion:[],analysisRows:[]});await vm.runInContext('loadReport(false)',c);await vm.runInContext('loadReport(false)',c);assert.equal(c.calls.length,1);
 await vm.runInContext('loadReport(true)',c);assert.equal(c.calls.length,2);assert.equal(c.allReads,0);
});
test('집계 오류를 빈 합계로 저장하거나 전체 활동 조회로 감추지 않는다',async()=>{
 const c=harness({error:'가짜 조회 오류'});await vm.runInContext('loadReport(false)',c);assert.equal(c.state.error,'가짜 조회 오류');assert.equal(c.state.cache['청년회'],undefined);assert.equal(c.allReads,0);
});
test('부서 전환은 새 집계 요청만 예약하고 역할·그래프 원본 전체를 함께 요청하지 않는다',()=>{
 const c={state:{},TEACHER_LIST_TAB:'LIST',calls:[],loadReport(){c.calls.push('report');},loadAllActivities(){c.calls.push('all');},loadOrgSummary(){c.calls.push('org');},loadRosterAll(){},loadTeacherReport(){}};
 vm.createContext(c);vm.runInContext(part('function switchDept(dept)','function switchRegion(region)'),c);vm.runInContext("switchDept('청년회')",c);assert.deepEqual(c.calls,['report']);assert.equal(c.state.region,'');
});
