import {test,before} from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync,readFileSync} from 'node:fs';
import vm from 'node:vm';
import {ids,api,login,sql,jwt} from './helpers/local-db.mjs';
import {seedStatus} from './helpers/status-fixture.mjs';
import {legacyStatusCharts} from './helpers/legacy-status-ui.mjs';
process.env.SUPABASE_URL='http://127.0.0.1:58433';process.env.SUPABASE_SERVICE_ROLE_KEY=jwt('service_role');
const old=await import('./helpers/legacy-status.mjs'), next=await import('../server/actions/tiers.js');
const {default:activities}=await import('../server/actions/activities.js');
const {forgetRoster}=await import('../server/actions/roster.js');
const dir='../artifacts/status-20261112';mkdirSync(dir,{recursive:true});
const at=new Date('2026-11-12T07:00:10.234+09:00');
let token;
before(async()=>{seedStatus();token=(await login()).body.token;assert.ok(token);});
const same=async(name,target,body,now=at)=>{forgetRoster();const a=await old['legacy'+name](...(body?[body,now]:[now]));forgetRoster();const b=await next[target](...(body?[body,now]:[now]));assert.deepEqual(b,a,`${name} ${JSON.stringify(body)} ${now.toISOString()}`);return b;};
test('개인 등급: 월말·윤일·정책 시작일·과거/미래 기록·출석 전환·1000건 초과 인도를 기존과 대조한다',async()=>{
 for(const stamp of ['2026-11-04T23:59:59.999+09:00','2026-11-12T07:00:10.234+09:00','2026-11-30T23:59:59.999+09:00','2026-03-31T12:00:00+09:00','2025-03-01T00:00:00+09:00','2024-02-29T00:00:00+09:00']){
  for(const memberId of [ids.member,ids.other,ids.fresh,'9700000000002'])await same('getMyTierStatus','myTierStatusAt',{memberId},new Date(stamp));
 }
 const r=await next.myTierStatusAt({memberId:ids.other},at);assert.equal(r.leadCount,5);
 const f=await next.myTierStatusAt({memberId:ids.fresh},at);assert.equal(f.otherPending,true);assert.equal(f.otherAttend,2);
});
test('지역 화면: 같은 지역 이름의 타 부서 분리, 본인 제외, 지역 공란·잘못된 이름 결과를 유지한다',async()=>{
 const r=await same('getDistrictView','districtViewAt',{memberId:ids.member});assert.ok(!r.teachers.some(t=>t.memberId===ids.other));assert.ok(!r.teachers.some(t=>t.memberId.trim()===ids.member));
 for(const body of [{memberId:ids.coach},{memberId:ids.member,name:'틀린이름'},{memberId:'99999999'},{memberId:''}])await same('getDistrictView','districtViewAt',body);
});
test('부서/전체 현황: 지역 필터·기타·공란·번호 중복 표기·복수 담당 대상자와 전체 합계를 유지한다',async()=>{
 for(const now of [at,new Date('2026-11-30T23:59:59.999+09:00'),new Date('2025-03-01T00:00:00+09:00')]){
  for(const dept of ['교역자','자문회','장년회','부녀회','청년회','기타'])for(const region of ['', '1지역'])await same('getDistrictReport','districtReportAt',{dept,region},now);
  await same('getOrgSummary','orgSummaryAt',null,now);
 }
 const a=await next.districtReportAt({dept:'청년회'},at),b=await next.districtReportAt({dept:'청년회',region:'1지역'},at);
 assert.deepEqual(a.summary,b.summary);assert.deepEqual(a.roleActivityCounts,b.roleActivityCounts);assert.deepEqual(a.targetStageCounts,b.targetStageCounts);
 assert.equal((await next.orgSummaryAt(at)).totalTeachers,2352);
});
const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const part=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
const chartCode=part('const ACTIVITY_OPTIONS =','const ACTIVITY_ICON =')+part('const ROLE_PARTS_DASH =','// report: 현재 부서의 getDistrictReport 캐시(allActivities')+part('function buildActivityAnalysis(report)','function activityAnalysisTableHtml')+part('function buildRoleActivityBreakdown(report)','// 그 지역에서 역할 무관');
test('지역 표·그래프는 원본 활동 전체 대신 가중 집계로 같은 수치·순서·등급·AI 입력을 만든다',async()=>{
 const all=(await activities.getAllActivities()).rows;
 for(const dept of ['장년회','부녀회','청년회','기타']){
  const report=await next.districtReportAt({dept,analysis:true,analysisMonth:'2026-11'},at);
  // UI가 적용하는 지역 정렬도 그대로 대조한다.
  report.byRegion.sort((a,b)=>a.region.localeCompare(b.region,'ko',{numeric:true}));
  const context={report,allActivities:null};vm.createContext(context);vm.runInContext(chartCode,context);
  const actual=JSON.parse(JSON.stringify(vm.runInContext('[buildActivityAnalysis(report),buildRoleActivityBreakdown(report)]',context)));
  assert.deepEqual(actual,legacyStatusCharts(report,all,at),dept);
  assert.ok(report.analysisRows.every(r=>!('submittedAt' in r)&&!('note' in r)&&!('targetName' in r)));
 }
});
const metric=async reset=>(await fetch('http://127.0.0.1:58433/__local_metrics',{method:reset?'POST':'GET'})).json();
const sum=m=>Object.values(m.db).reduce((s,x)=>s+x.bytes,0);
const requests=m=>Object.values(m.db).reduce((s,x)=>s+x.requests,0);
test('동일 가짜 자료에서 개인·지역·전체 조회의 DB 원본 전송과 요청 수를 줄인다',async()=>{
 const measurements=[];
 for(const [name,target,body] of [['getMyTierStatus','myTierStatusAt',{memberId:ids.member}],['getDistrictView','districtViewAt',{memberId:ids.member}],['getDistrictReport','districtReportAt',{dept:'청년회'}],['getOrgSummary','orgSummaryAt',null]]){
  forgetRoster();await metric(true);const a=await old['legacy'+name](...(body?[body,at]:[at]));const oldMetrics=await metric();
  forgetRoster();await metric(true);const b=await next[target](...(body?[body,at]:[at]));const newMetrics=await metric();assert.deepEqual(b,a);
  const m={action:name,oldDbBytes:sum(oldMetrics),newDbBytes:sum(newMetrics),oldRequests:requests(oldMetrics),newRequests:requests(newMetrics),old:oldMetrics,new:newMetrics};
  assert.ok(m.newDbBytes<m.oldDbBytes*.4,JSON.stringify({action:name,old:m.oldDbBytes,next:m.newDbBytes}));measurements.push(m);
 }
 const all=(await activities.getAllActivities()).rows,report=await next.districtReportAt({dept:'청년회',analysis:true},at);
 const charts={allHistoryBytes:Buffer.byteLength(JSON.stringify(all)),analysisBytes:Buffer.byteLength(JSON.stringify(report.analysisRows)),allRows:all.length,analysisRows:report.analysisRows.length};assert.ok(charts.analysisBytes<charts.allHistoryBytes*.1);
 writeFileSync(dir+'/measurements.json',JSON.stringify({syntheticOnly:true,teachers:2352,measurements,charts,productionTouched:false},null,2));
});
test('현황 권한: 비로그인·손님·타인 대입 거절, 일반 교사 전체 조회와 부서 분리 유지',async()=>{
 for(const action of ['getMyTierStatus','getDistrictView','getDistrictReport','getOrgSummary']){
  assert.equal((await api(action,{dept:'청년회'})).status,401);
  assert.equal((await api(action,{dept:'청년회',memberId:ids.other},token)).status,403);
  const r=await api(action,{dept:'청년회'},token);assert.equal(r.status,200);assert.ok(!r.body.error,r.body.error);
 }
 const member=await api('getDistrictView',{dept:'장년회',region:'2지역'},token);assert.equal(member.body.leader.region,'1지역');assert.ok(!member.body.teachers.some(t=>t.name==='테스트대상'));
 sql("insert into target_room_invites(code,target_id,expires_at,max_uses) values('STATTEST','LIST-1','2099-01-01',100) on conflict(code) do update set revoked=false,uses=0");
 const guest=await api('guestLogin',{memberId:'99000999',name:'가짜손님',dept:'청년회',code:'STATTEST'});assert.ok(guest.body.token);
 for(const action of ['getMyTierStatus','getDistrictView','getDistrictReport','getOrgSummary'])assert.equal((await api(action,{dept:'청년회'},guest.body.token)).status,403);
 for(const signature of ['personal_tier_facts(text,jsonb,jsonb)','scope_tier_facts(jsonb,jsonb,jsonb,text[])']){
  for(const role of ['anon','authenticated'])assert.equal(sql(`select has_function_privilege('${role}','public.${signature}','execute')`),'f');
  assert.equal(sql(`select prosecdef from pg_proc where oid='public.${signature}'::regprocedure`),'f');
 }
 assert.equal((await api('getDistrictReport',{dept:'청년회',analysis:true,analysisMonth:'2026-99'},token)).status,400);
});
test('자료 변경을 새 조회에 반영하고 조회만으로 등급/활동/승인 원본을 변경하지 않는다',async()=>{
 const digest=()=>['teachers','activities','center_leads','tier_approvals'].map(table=>sql(`select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) from ${table} t`));const before=digest();
 await next.myTierStatusAt({memberId:ids.member},at);await next.districtViewAt({memberId:ids.member},at);
 await next.districtReportAt({dept:'청년회',analysis:true},at);await next.orgSummaryAt(at);assert.deepEqual(digest(),before);
 const oldReport=await next.districtReportAt({dept:'청년회'},at);
 sql(`insert into activities(member_id,name,submitted_at,activities,roles) values('${ids.member}','테스트교사','2026-11-12',array['복음방'],array['교사'])`);
 const updated=await next.districtReportAt({dept:'청년회'},at);assert.ok(updated.summary.monthlyActivityCount>oldReport.summary.monthlyActivityCount);
 sql(`update teachers set region='2지역' where member_id='${ids.member}'`);forgetRoster();
 assert.equal((await next.districtViewAt({memberId:ids.member},at)).leader.region,'2지역');
});
