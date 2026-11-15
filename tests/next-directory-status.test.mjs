import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {defaultDirectoryFilter,directoryParams,tierChanges,selectionAfterChange} from '../next-app/lib/directory.ts';
import {activityAnalysis,roleBreakdown,orderedRegions} from '../next-app/lib/status.ts';
import {readApi} from '../next-app/lib/api.ts';
const clone=value=>JSON.parse(JSON.stringify(value));
const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const part=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
const chartCode=part('const ACTIVITY_OPTIONS =','const ACTIVITY_ICON =')+part('const ROLE_PARTS_DASH =','// report: 현재 부서의 getDistrictReport 캐시(allActivities')+part('function buildActivityAnalysis(report)','function activityAnalysisTableHtml')+part('function buildRoleActivityBreakdown(report)','// 그 지역에서 역할 무관');
test('명단의 전체 선택 요청은 검색·부서·지역·실적 조건을 유지하며 페이지 한도로 자르지 않는다',()=>{
 const filter={...defaultDirectoryFilter,query:'가%_(),',dept:'청년회',region:'1지역',adminOnly:true,pendingOnly:true,minLeads:2};
 assert.deepEqual(directoryParams(filter,1,0),{...filter,page:1,all:true});
 assert.deepEqual(directoryParams(filter,2,50),{...filter,page:2,limit:50});
});
test('등급 변경은 다른 페이지 선택도 포함하고 같은 등급·없는 제안은 제외하며 실패 선택은 남긴다',()=>{
 const rows=Array.from({length:70},(_,i)=>({memberId:'fake-'+i,tier:i%2?'활동교사':'정교사',suggestion:i%3?{suggestedTier:'우수교사',reason:'기존 제안'}:null}));
 assert.equal(tierChanges(rows,'정교사',false).length,35);
 const suggested=tierChanges(rows,'',true);assert.equal(suggested.length,46);assert.equal(suggested[0].reason,'기존 제안');
 const selected=new Map(rows.map(row=>[row.memberId,row]));const remaining=selectionAfterChange(selected,suggested.slice(0,10));assert.equal(selected.size,70);assert.equal(remaining.size,60);assert.ok(remaining.has('fake-69'));
});
test('검색 조건과 계정이 같은 진행 중 읽기만 합치고 다른 페이지는 분리한다',async()=>{
 const original=globalThis.fetch;let release;const gate=new Promise(resolve=>{release=resolve;}),calls=[];
 globalThis.fetch=async(_url,options)=>{calls.push(JSON.parse(options.body));await gate;return Response.json({rows:[]});};
 try{const promises=[readApi('getTeacherDirectory','fake-a',{page:1}),readApi('getTeacherDirectory','fake-a',{page:1}),readApi('getTeacherDirectory','fake-a',{page:2}),readApi('getTeacherDirectory','fake-b',{page:1})];assert.equal(calls.length,3);release();await Promise.all(promises);await readApi('getTeacherDirectory','fake-a',{page:1});assert.equal(calls.length,4);}finally{globalThis.fetch=original;}
});
test('실패한 읽기를 계속 재사용하지 않고 명시적으로 다시 조회한다',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return calls===1?Response.json({error:'가짜 일시 장애'},{status:503}):Response.json({rows:[]});};
 try{await assert.rejects(readApi('getDistrictReport','fake-a',{dept:'청년회'}),/가짜/);assert.deepEqual(await readApi('getDistrictReport','fake-a',{dept:'청년회'}),{rows:[]});assert.equal(calls,2);}finally{globalThis.fetch=original;}
});
const report={rows:[{memberId:'r_a',region:'1지역'},{memberId:'r_b',region:'2지역'},{memberId:'r_c',region:''},{memberId:'r_d',region:'3지역'}],byRegion:[{region:'1지역'},{region:'2지역'},{region:'3지역'}],analysisRows:[
 {memberId:'r_a',count:4,activities:['만남1','만남1','복음방',''],roles:['교사','인도자']},
 {memberId:'r_b',count:3,activities:['피드백','알수없는항목','   '],roles:['교사','교사','없는역할']},
 {memberId:'r_c',count:2,activities:['섭외'],roles:[]},
 {memberId:'r_missing',count:100,activities:['만남1'],roles:['교사']},
 {memberId:'r_a',count:1,activities:['멘토교사','전도 행사 지원'],roles:['협력교사']},
]};
function oldCharts(value){const context={report:value,allActivities:null};vm.createContext(context);vm.runInContext(chartCode,context);return clone(vm.runInContext('[buildActivityAnalysis(report),buildRoleActivityBreakdown(report)]',context));}
test('지역별 활동 수·유형 순서·1인당 값·상중하 판정이 기존 화면과 같다',()=>{
 for(const value of [report,{rows:[],byRegion:[],analysisRows:[]},{...report,rows:report.rows.slice(0,1)}])assert.deepEqual(clone(activityAnalysis(value)),oldCharts(value)[0]);
});
test('역할 없는 기록 제외·중복 역할·공백 항목·없는 번호 처리와 역할별 합계가 기존과 같다',()=>{
 for(const value of [report,{rows:[],byRegion:[],analysisRows:[]},{...report,analysisRows:[]}])assert.deepEqual(clone(roleBreakdown(value)),oldCharts(value)[1]);
});

test('지역 표시 순서는 기존 화면처럼 숫자 오름차순이며 원본 순서와 집계는 보존한다',()=>{
 const rows=[{region:'10지역',total:5},{region:'3지역',total:9},{region:'1지역',total:8},{region:'',total:2}];
 const original=clone(rows);
 const sorted=orderedRegions(rows);
 assert.deepEqual(sorted.map(row=>row.region),['','1지역','3지역','10지역']);
 assert.deepEqual(rows,original);assert.equal(sorted.reduce((n,row)=>n+row.total,0),24);
 const displayReport={...report,byRegion:orderedRegions(report.byRegion)};
 assert.deepEqual(clone(roleBreakdown(displayReport)),oldCharts(displayReport)[1]);
});

test('변경 기록의 이전·이후 표시와 엑셀 요약은 기존 항목을 보존하고 내부 스냅샷 번호는 숨긴다',async()=>{
 const {logDifference,displayId}=await import('../next-app/lib/roster-admin.ts');
 assert.equal(logDifference({kind:'교사 수정',before:{name:'가짜전',dept:'청년회'},after:{name:'가짜후',dept:'청년회',region:'1지역'}}),'이름: 가짜전 → 가짜후 / 지역: (빈칸) → 1지역');
 assert.equal(logDifference({kind:'엑셀 반영',before:{},after:{인원:120,추가:1,스냅샷:99}}),'인원 120 · 추가 1');
 assert.equal(displayId('r_opaque'),'');assert.equal(displayId('9900000000999'),'9900000000999');
});
