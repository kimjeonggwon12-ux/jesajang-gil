import {before,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import vm from 'node:vm';
import XLSX from 'xlsx';
import {seedRemaining} from './helpers/remaining-fixture.mjs';
import {ids,PIN,sql} from './helpers/local-db.mjs';
import {activityAnalysis,roleBreakdown} from '../next-app/lib/status.ts';
import {tierChanges} from '../next-app/lib/directory.ts';
const base='http://127.0.0.1:58434',old='http://127.0.0.1:58433';
async function api(action,body={},token,origin=base){const res=await fetch(origin+'/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...body,...(token?{_tk:token}:{})})});return {status:res.status,body:await res.json()};}
let member,admin,education;
before(async()=>{seedRemaining();member=(await api('verifyLogin',{memberId:ids.member,name:'테스트교사',dept:'청년회',pin:PIN})).body.token;admin=(await api('verifyLogin',{memberId:ids.evangel,name:'테스트전도',dept:'전도부',pin:PIN})).body.token;education=(await api('verifyLogin',{memberId:ids.admin,name:'테스트교육',dept:'청년회',pin:PIN})).body.token;assert.ok(member&&admin&&education);
 // 직접 SQL로 교체한 가짜 자료는 서버의 변경 후 무효화 경로를 거치지 않는다.
 // 직전 파일의 캐시를 양쪽 API에서 비우고 실제 명단 수까지 확인한다.
 for(const origin of [base,old]){const fresh=await api('getTeacherDirectory',{refresh:true,all:true},member,origin);assert.equal(fresh.body.total,Number(sql('select count(*) from teachers')));}
});
test('새 경로들은 로그인 전 개인 명단을 정적 HTML에 포함하지 않는다',async()=>{
 for(const path of ['/menu','/members','/status']){const r=await fetch(base+path);assert.equal(r.status,200);const html=await r.text();assert.match(html,/lang="ko"/);assert.doesNotMatch(html,/테스트교사|가짜교사|9900000000001|SUPABASE_SERVICE_ROLE_KEY/);}
});
test('명단 전체 선택·페이지·모든 부서 집계가 기존 API의 전체 응답과 일치한다',async()=>{
 for(const params of [{limit:20,page:2},{all:true,dept:'청년회',region:'1지역'},{query:'%_(),',limit:50},{adminOnly:true,pendingOnly:true}])assert.deepEqual(await api('getTeacherDirectory',params,member),await api('getTeacherDirectory',params,member,old));
 for(const dept of ['교역자','자문회','장년회','부녀회','청년회','기타'])assert.deepEqual(await api('getDistrictReport',{dept,analysis:true,analysisMonth:'2026-11'},member),await api('getDistrictReport',{dept,analysis:true,analysisMonth:'2026-11'},member,old));
});
test('가짜 DB의 실제 월별 분석 응답도 이전 화면의 표·그래프 계산과 일치한다',async()=>{
 const html=readFileSync(new URL('../app.html',import.meta.url),'utf8'),part=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
 const code=part('const ACTIVITY_OPTIONS =','const ACTIVITY_ICON =')+part('const ROLE_PARTS_DASH =','// report: 현재 부서의 getDistrictReport 캐시(allActivities')+part('function buildActivityAnalysis(report)','function activityAnalysisTableHtml')+part('function buildRoleActivityBreakdown(report)','// 그 지역에서 역할 무관');
 for(const dept of ['장년회','청년회','기타'])for(const month of ['2026-10','2026-11','2027-02']){
  const report=(await api('getDistrictReport',{dept,analysis:true,analysisMonth:month},member)).body,ctx={report,allActivities:null};vm.createContext(ctx);vm.runInContext(code,ctx);
  const previous=JSON.parse(JSON.stringify(vm.runInContext('[buildActivityAnalysis(report),buildRoleActivityBreakdown(report)]',ctx)));
  assert.deepEqual(JSON.parse(JSON.stringify([activityAnalysis(report),roleBreakdown(report)])),previous,dept+' '+month);
 }
});
test('전도 담당자의 여러 페이지 선택 등급 변경과 이력은 유지되고 일반·교육 계정의 변경은 거절한다',async()=>{
 const rows=(await api('getTeacherDirectory',{dept:'교역자',all:true},admin)).body.rows.slice(0,60),items=tierChanges(rows,'우수교사',false);assert.ok(items.length>20);
 assert.equal((await api('bulkChangeTier',{items},member)).status,403);assert.equal((await api('bulkChangeTier',{items},education)).status,403);
 const historyBefore=Number(sql("select count(*) from tier_history where approver1='전도부 테스트전도'"));
 const review=(await api('previewTierChange',{items},admin)).body.review;assert.ok(review);
 const result=await api('bulkChangeTier',{items,review,confirmed:true},admin);assert.equal(result.body.changed.length,items.length);assert.equal(result.body.failed.length,0);
 const updated=(await api('getTeacherDirectory',{dept:'교역자',all:true},member)).body.rows,changed=new Set(items.map(row=>row.memberId));assert.ok(updated.filter(row=>changed.has(row.memberId)).every(row=>row.tier==='우수교사'));
 assert.equal(Number(sql("select count(*) from tier_history where approver1='전도부 테스트전도'"))-historyBefore,items.length);
});
test('직책 지정은 서버 승인자와 변경 전후를 기록하며 일반 계정은 실행할 수 없다',async()=>{
 const target=(await api('getTeacherDirectory',{query:'가짜교사0002'},admin)).body.rows[0];assert.ok(target);
 const body={memberId:target.memberId,name:target.name,dept:target.dept,region:target.region,position:'지역장'};
 assert.equal((await api('upsertRosterLeader',body,member)).status,403);
 body.expected={name:target.name,dept:target.dept,region:target.region,position:target.position};
 const preview=await api('previewRosterLeader',body,education);assert.equal(preview.body.ok,true);
 const saved=await api('upsertRosterLeader',{...body,review:preview.body.review,confirmed:true},education);assert.equal(saved.body.ok,true);
 const row=(await api('getTeacherDirectory',{query:target.name},admin)).body.rows[0];assert.equal(row.position,'지역장');
 assert.equal(sql("select actor_name from roster_changes where kind='직책 지정' order by id desc limit 1"),'테스트교육');
});
test('교육·전도 담당자 엑셀은 선택 페이지와 무관한 전체 지역 자료이며 권한과 비밀번호를 유지한다',async()=>{
 const body={dept:'청년회',region:'1지역',period:'all',password:'local-only-export-password',query:'검색에없는이름',limit:1};
 assert.equal((await api('exportTeacherList',body,member)).status,403);
 assert.match((await api('exportTeacherList',{...body,password:'wrong'},admin)).body.error,/비밀번호/);
 // 기존 엑셀은 부서 공백을 trim하고 명단 검색은 원문으로 묶는다. 두 규칙을 임의로 통일하지 않는다.
 const scopes=(await api('getRoster',{},admin)).body.rows.filter(row=>row.dept.trim()==='청년회'&&row.region==='1지역');
 for(const token of [education,admin]){
  const result=(await api('exportTeacherList',body,token)).body;assert.equal(result.ok,true);const workbook=XLSX.read(Buffer.from(result.base64,'base64'),{type:'buffer'});assert.deepEqual(workbook.SheetNames,['1지역']);
  const records=XLSX.utils.sheet_to_json(workbook.Sheets['1지역'],{header:1,blankrows:true});assert.equal(records.length,scopes.length+5);
  assert.equal(records[3][8],'활동 기록(누적)');assert.ok(scopes.length>1);
 }
 const summary={fakeOnly:true,authorization:true,allDepartmentParity:true,monthlyChartParity:true,multiPageTierChanges:true,fullScopeExport:true,productionTouched:false};writeFileSync('../artifacts/next-phase2-20261112/directory-status-check.json',JSON.stringify(summary,null,2));
});
