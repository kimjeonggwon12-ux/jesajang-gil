import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const part=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
function harness(responses) {
 const c={settlement:null,settlementLoading:false,settlementView:null,allLeads:null,allLeadsLoading:false,allLeadsError:'',calls:[],distRender(){},callApi:async body=>{c.calls.push(body);const r=responses.shift();if(r instanceof Error)throw r;return r;}};
 vm.createContext(c);
 vm.runInContext(part("let settlementDetailError = '';",'function tierChangeBadge')+part('async function loadAllLeads()', '// ============ 월별 결산 현황')+part("let nonPart = null, nonPartView = ''",'const NP_LABEL ='),c);
 return c;
}
test('관리자 첫 화면은 결산·미참여자 요약을 요청하고 센터 인도 전체를 미리 읽지 않는다',async()=>{
 const c=harness([{details:false,promotionsTotal:2},{details:false,depts:[]}]);await vm.runInContext('loadSettlement();',c);await vm.runInContext('loadNonPart();',c);
 assert.deepEqual(c.calls.map(x=>[x.action,x.summary]),[['getSettlementReport',true],['getNonParticipants',true]]);
 const init=part("else if (tab === 'dist') {","else if (tab === 'connectAdmin')");assert.ok(!init.includes('loadAllLeads'));
});
test('결산 상세는 열 때 조회하고 이후 재사용하며 구서버 전체 응답도 호환한다',async()=>{
 const c=harness([{details:false,promotionsTotal:2},{promotions:[],promotionsTotal:2}]);await vm.runInContext('loadSettlement()',c);await vm.runInContext('loadSettlement(true)',c);await vm.runInContext('loadSettlement(true)',c);
 assert.equal(c.calls.length,2);assert.equal(c.calls[1].summary,false);
 const old=harness([{promotions:[],promotionsTotal:2}]);await vm.runInContext('loadSettlement()',old);await vm.runInContext('loadSettlement(true)',old);assert.equal(old.calls.length,1);
});
test('상세 실패 시 요약을 보존하고 다시 조회할 수 있다',async()=>{
 const c=harness([{details:false,promotionsTotal:2},new Error('가짜 오류'),{promotions:[],promotionsTotal:2}]);
 await vm.runInContext('loadSettlement()',c);await vm.runInContext('loadSettlement(true)',c);assert.equal(c.settlement.promotionsTotal,2);assert.equal(c.settlement.details,false);
 await vm.runInContext('loadSettlement(true)',c);assert.equal(c.calls.length,3);assert.equal(c.settlement.details,undefined);
});
test('미참여자 명단은 클릭 때만 읽고 부서 필터·전체 엑셀용 행을 보존한다',async()=>{
 const rows=[{dept:'청년회',inactive:true,noEdu:false},{dept:'장년회',inactive:true,noEdu:true}];
 const c=harness([{details:false,depts:[]},{rows,depts:[]}]);await vm.runInContext('loadNonPart()',c);assert.equal(c.calls.length,1);
 await vm.runInContext('loadNonPart(true)',c);await vm.runInContext('loadNonPart(true)',c);assert.equal(c.calls.length,2);
 assert.equal(vm.runInContext("nonPartRows('act').length",c),2);assert.equal(vm.runInContext("nonPartRows('both').length",c),1);
 assert.equal(vm.runInContext("nonPartDept='청년회';nonPartRows('act').length",c),1);
});
test('미참여자 상세 오류가 빈 명단으로 굳지 않고 재시도로 복구된다',async()=>{
 const c=harness([{details:false,depts:[{total:10}]},new Error('가짜 오류'),{rows:[],depts:[{total:10}]}]);
 await vm.runInContext('loadNonPart()',c);await vm.runInContext('loadNonPart(true)',c);assert.equal(vm.runInContext('nonPart.depts[0].total',c),10);assert.equal(vm.runInContext('nonPart.rows',c),undefined);
 await vm.runInContext('loadNonPart(true)',c);assert.equal(vm.runInContext('nonPart.rows.length',c),0);
});
test('센터 인도 전체 조회는 동시 요청을 합치고 받아둔 결과를 재사용한다',async()=>{
 const c=harness([{rows:[{date:'2026-11-01'}]}]);await vm.runInContext('Promise.all([loadAllLeads(),loadAllLeads()])',c);await vm.runInContext('loadAllLeads()',c);assert.equal(c.calls.length,1);assert.equal(c.allLeads.length,1);
});
test('센터 월별 조회 실패도 빈 결과로 저장하지 않고 재시도할 수 있다',async()=>{
 const c=harness([{error:'가짜 오류'},new Error('가짜 연결 오류'),{rows:[]}]);
 await vm.runInContext('loadAllLeads()',c);assert.equal(c.allLeads,null);assert.ok(c.allLeadsError);
 await vm.runInContext('loadAllLeads()',c);assert.equal(c.allLeads,null);
 await vm.runInContext('loadAllLeads()',c);assert.equal(c.allLeads.length,0);assert.equal(c.allLeadsError,'');
 await vm.runInContext('loadAllLeads()',c);assert.equal(c.calls.length,3);
});
