import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const section=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function base() {
  const timers=new Map(),inputs=new Map();let timer=0;
  const c={Map,Set,console,window:{},rosterAll:null,rosterLoading:false,home:{monthlyActRes:{rows:[]}},
    state:{tlLimit:20,tlQuery:'',tlChecked:new Set()},App:{},memberId:'FAKE',calls:[],renders:0,
    document:{activeElement:null,getElementById:id=>inputs.get(id)||null,querySelectorAll:()=>[]},
    eduRender(){c.renders++;},renderHome(){c.renders++;},toast(){},
    setTimeout:(fn,ms)=>{timers.set(++timer,{fn,ms});return timer;},clearTimeout:id=>timers.delete(id),queueMicrotask:fn=>timers.set(++timer,{fn,ms:0}),
    callApi:body=>{const d=deferred();c.calls.push({body,...d});return d.promise;}};
  vm.createContext(c);
  const evaluate=code=>vm.runInContext(code,c);
  const input=key=>{const events={};const q={value:'',dataset:{},selectionStart:0,addEventListener:(k,fn)=>events[k]=fn,focus(){c.document.activeElement=q;},setSelectionRange(){},events};inputs.set(key,q);return q;};
  return {c,evaluate,input,timers};
}
function rosterHarness(){const h=base();h.evaluate(section('const tlPage =','// 11/1(사용자): 교사광장 일일보고 항목 묶음'));h.evaluate(section('function wireTeacherSearch()','// ============ Phase 2(2026-09-15)'));return h;}
const result=rows=>({rows,total:rows.length,page:1,pages:1});
test('명단은 동일 요청을 합치고 이전 검색의 늦은 응답이 새 검색을 덮지 않는다',async()=>{
 const h=rosterHarness();const a=h.evaluate('loadRosterAll(false)');await h.evaluate('loadRosterAll(false)');assert.equal(h.c.calls.length,1);
 h.c.state.tlQuery='새검색';const b=h.evaluate('loadRosterAll(false)');h.c.calls[1].resolve(result([{memberId:'B'}]));await b;
 h.c.calls[0].resolve(result([{memberId:'A'}]));await a;assert.equal(h.c.rosterAll[0].memberId,'B');assert.equal(h.c.rosterLoading,false);
});
test('명단 검색은 한글 조합 중 요청하지 않고 400ms 뒤(조합이 끝난 뒤) 한 번 조회한다',async()=>{
 const h=rosterHarness(),q=h.input('tl-q');h.evaluate('wireTeacherSearch()');q.events.compositionstart();q.value='가';q.events.input();assert.equal(h.timers.size,0);
 q.value='가짜';q.events.compositionend();q.events.input();assert.equal(h.timers.size,1);const timer=[...h.timers.values()][0];assert.equal(timer.ms,400);timer.fn();assert.equal(h.c.calls.length,1);assert.equal(h.c.calls[0].body.query,'가짜');h.c.calls[0].resolve(result([]));
});
test('명단 전체 선택은 다른 페이지의 대상까지 기억하고 이후 페이지 변경에도 선택을 보존한다',async()=>{
 const h=rosterHarness();h.c.rosterAll=[{memberId:'1'}];const select=h.evaluate('tlSelectAll(true)');assert.equal(h.c.calls[0].body.all,true);
 h.c.calls[0].resolve(result([{memberId:'1'},{memberId:'2'}]));await select;assert.equal(h.c.state.tlChecked.size,2);assert.equal(h.evaluate('tlPage.selectedRows.size'),2);
 h.evaluate('tlPage.page=2');const next=h.evaluate('loadRosterAll(false)');h.c.calls[1].resolve({...result([{memberId:'2',tier:'정교사'}]),page:2});await next;
 assert.equal(h.c.state.tlChecked.size,2);assert.equal(h.evaluate("tlPage.selectedRows.get('2').tier"),'정교사');
});
test('명단 조회 실패는 빈 명단으로 덮지 않고 다시 불러올 수 있다',async()=>{
 const h=rosterHarness();h.c.rosterAll=[{memberId:'1'}];const first=h.evaluate('loadRosterAll(false)');h.c.calls[0].resolve({error:'실패'});await first;assert.equal(h.evaluate('tlPage.error'),'실패');assert.equal(h.c.rosterAll.length,1);
 const retry=h.evaluate('loadRosterAll(true)');h.c.calls[1].resolve(result([{memberId:'2'}]));await retry;assert.equal(h.evaluate('tlPage.error'),'');assert.equal(h.c.rosterAll[0].memberId,'2');
});
function activityHarness(){const h=base();h.evaluate(section('    const activityPages =','    function activityHistorySectionHtml()'));h.evaluate('function rpRow(id) { return activityFullRows.get(Number(id)); }');return h;}
test('활동 페이지의 늦은 검색 응답은 새 검색을 덮지 않으며 누적 색인을 잘라내지 않는다',async()=>{
 const h=activityHarness();h.c.home.monthlyActRes.rows=[{id:1},{id:2},{id:3}];h.evaluate("activityPages.set('feed',{seq:0,query:'A',target:null,page:1,limit:20})");
 const a=h.evaluate("loadActivityList('feed')");h.evaluate("activityPages.get('feed').query='B'");const b=h.evaluate("loadActivityList('feed')");
 h.c.calls[1].resolve(result([{id:2,reportText:'B'}]));await b;h.c.calls[0].resolve(result([{id:1,reportText:'A'}]));await a;
 assert.equal(h.evaluate("activityPages.get('feed').rows[0].id"),2);assert.equal(h.c.home.monthlyActRes.rows.length,3);assert.equal(h.c.home.monthlyActRes.rows[1].reportText,'B');
});
test('활동 상세 중복 요청은 합치고 새로고침 전의 늦은 원문은 사용하지 않는다',async()=>{
 const h=activityHarness();h.c.home.monthlyActRes.rows=[{id:1,_summary:true}];const a=h.evaluate('fullActivity(1)'),b=h.evaluate('fullActivity(1)');assert.equal(h.c.calls.length,1);
 h.evaluate('acceptActivitySummary({rows:[{id:1,_summary:true}]})');h.c.calls[0].resolve({row:{id:1,reportText:'이전원문'}});assert.equal(await a,null);assert.equal(await b,null);
 const fresh=h.evaluate('fullActivity(1)');h.c.calls[1].resolve({row:{id:1,reportText:'새원문',report:{lessons:['누적교육'],photos:['원본']}}});assert.equal((await fresh).reportText,'새원문');assert.equal(h.c.home.monthlyActRes.rows[0].report.lessons[0],'누적교육');
});
test('활동 첫 화면은 최근 3건을 재사용하고 펼칠 때만 20건 페이지를 요청한다',async()=>{
 const h=activityHarness();h.evaluate("acceptActivitySummary({rows:[{id:1}],recent:{rows:[{id:1}],page:1,total:100,pages:34,limit:3,through:100}})");
 h.evaluate("activityList('feed',null,3)");assert.equal(h.timers.size,0);assert.equal(h.c.calls.length,0);
 h.evaluate("activityList('feed',null,20)");assert.equal(h.timers.size,1);const next=[...h.timers.values()][0].fn();assert.equal(h.c.calls[0].body.limit,20);assert.equal(h.c.calls[0].body.through,100);h.c.calls[0].resolve(result([{id:1}]));await next;
});
test('같은 시각·같은 활동도 기록별 수정·복사·피드백 대상으로 구분한다',()=>{
 const h=base();h.evaluate(section('    function activityRowKey(a)','    function toggleHistory'));
 assert.notEqual(h.evaluate("activityRowKey({id:1,submittedAt:'같은시간',activities:['복음방']})"),h.evaluate("activityRowKey({id:2,submittedAt:'같은시간',activities:['복음방']})"));
});

test('다른 페이지의 선택도 검토·확인 후 일괄 승인하고 성공한 대상만 선택 해제한다',{timeout:3000},async()=>{
 const h=rosterHarness();h.c.App={permissions:{canChangeTier:true},name:'가짜전도'};h.c.confirm=()=>true;
 Object.assign(h.c.state,{bulkTier:'정교사',bulkApproverName:'가짜전도',tlChecked:new Set(['1','2','3'])});
 h.c.rosterAll=[{memberId:'1',tier:'활동교사'}];
 h.evaluate("tlPage.selectedRows=new Map([['1',{memberId:'1',tier:'활동교사'}],['2',{memberId:'2',tier:'활동교사'}],['3',{memberId:'3',tier:'활동교사'}]]);function teacherListRowsFiltered(){return rosterAll;}loadTeacherReport=()=>{};");
 h.evaluate(section('async function runBulkApprove(', '// 2026-09-22: district에서 edu(1️⃣ 교사 현황)로 이동 — 재렌더는 distRender가 아닌 eduRender.\nfunction wireTeacherList()'));
 const pending=h.evaluate('runBulkApprove(false)');assert.equal(h.c.calls[0].body.action,'previewTierChange');assert.equal(h.c.calls[0].body.items.length,3);
 const changed=[{memberId:'1',name:'가짜1',prevTier:'활동교사',tier:'정교사'},{memberId:'2',name:'가짜2',prevTier:'활동교사',tier:'정교사'}];
 h.c.calls[0].resolve({review:'fake-reviewed-change',changed,failed:[{memberId:'3'}]});await new Promise(setImmediate);
 assert.equal(h.c.calls.length,2);assert.equal(h.c.calls[1].body.action,'bulkChangeTier');assert.equal(h.c.calls[1].body.review,'fake-reviewed-change');assert.equal(h.c.calls[1].body.confirmed,true);
 assert.deepEqual(h.c.calls[1].body.items,h.c.calls[0].body.items);
 h.c.calls[1].resolve({changed,failed:[{memberId:'3'}]});await pending;
 assert.deepEqual([...h.c.state.tlChecked],['3']);assert.equal(h.evaluate('tlPage.selectedRows.size'),1);
});

test('대상자 화면의 누적 건수·교육·피드백은 최근 3건과 별개인 DB 요약을 사용한다',()=>{
 const h=base();Object.assign(h.c,{erKey:v=>String(v||'').trim(),stageIndex:s=>h.c.home.stages.indexOf(s)});
 h.c.home.targets=[{targetName:'가짜대상',stage:'상담1'}];h.c.home.stages=['상담1','복음방','센터수강'];
 h.c.home.monthlyActRes={rows:[{id:1}],overview:{total:1000,people:[{name:'가짜대상',total:999,edu:500,feedbackCount:25,latest:{id:99},stageCandidates:['복음방','알수없는단계']}]}};
 h.evaluate(section('    function erPeople()','    const erSent'));
 const p=h.evaluate('erPeople()[0]');assert.equal(p.total,999);assert.equal(p.edu,500);assert.equal(p.feedbackCount,25);assert.equal(p.latest.id,99);assert.equal(p.stage,'복음방');assert.equal(h.c.calls.length,0);
});
test('보고·피드백 펼치기는 각자 페이지와 검색 상태를 유지하고 전체 회차를 요청한다',async()=>{
 const h=activityHarness();h.evaluate("activityList('reports:가짜대상','가짜대상',20);activityList('feedback:가짜대상','가짜대상',20,true)");
 const pending=[...h.timers.values()].map(t=>t.fn());assert.equal(h.c.calls.length,2);
 assert.equal(h.c.calls[0].body.feedbackOnly,false);assert.equal(h.c.calls[1].body.feedbackOnly,true);
 for(const c of h.c.calls){assert.equal(c.body.withSequence,true);assert.equal(c.body.limit,20);c.resolve(result([{id:c.body.feedbackOnly?2:1,sequence:100}]));}await Promise.all(pending);
 assert.equal(h.evaluate("activityPages.get('reports:가짜대상').rows[0].id"),1);assert.equal(h.evaluate("activityPages.get('feedback:가짜대상').rows[0].id"),2);
});
test('가장 최근 활동이 첫 3건 밖에 있어도 요약의 ID로 본문을 읽어 피드백을 요청한다',async()=>{
 const h=base();h.c.home.monthlyActRes={rows:[],overview:{people:[{latest:{id:99}}]}};h.c.home.aiFeedback={};h.c.home.targets=[];
 Object.assign(h.c,{activityFullRows:new Map(),activityRowKey:a=>'activity-'+a.id,fullActivity:async id=>({id,targetName:'가짜대상'}),maskName:s=>s,todayStr:()=>'',refreshActivityOverview:async()=>{h.c.refreshed=true;}});
 h.evaluate(section('    async function runActivityAiFeedback(key)','    // ── 2026-10-23(사용자) 기록 카드 다시 정리'));
 const run=h.evaluate("runActivityAiFeedback('activity-99')");await new Promise(setImmediate);assert.equal(h.c.calls[0].body.activityId,99);h.c.calls[0].resolve({text:'가짜 피드백'});await run;assert.equal(h.c.refreshed,true);
});
test('원본 보고 저장 후 집계 갱신 실패는 저장 재시도를 유발하지 않고 재조회 안내를 남긴다',async()=>{
 const h=activityHarness();let message='';h.c.toast=m=>message=m;
 h.c.home.monthlyActRes={overview:{total:25},rows:[]};const run=h.evaluate('refreshActivityOverview()');
 h.c.calls[0].resolve({error:'가짜 조회 실패'});await run;assert.equal(h.c.home.monthlyActRes.overview.total,25);assert.match(message,/저장했지만/);assert.equal(h.c.calls.length,1);
});
