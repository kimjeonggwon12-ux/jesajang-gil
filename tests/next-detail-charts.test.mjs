import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {DETAIL_GROUPS,DEFAULT_EDUCATION,teacherExtraFields,educationSummary} from '../next-app/lib/directory-detail.ts';
import {activityChart,tierChart,sampleRoleBreakdown,strongItems,displayedRoleTotal} from '../next-app/lib/status-charts.ts';
import {activityAnalysis,roleBreakdown,ROLES,ROLE_ITEMS} from '../next-app/lib/status.ts';
const html=readFileSync(new URL('../app.html',import.meta.url),'utf8'),plain=x=>JSON.parse(JSON.stringify(x));
function part(start,end){const a=html.indexOf(start),b=html.indexOf(end,a);assert.ok(a>=0&&b>a,start);return html.slice(a,b);}
const constants=part('const ROLE_PARTS_DASH =','// report: 현재 부서의 getDistrictReport 캐시(allActivities');
function legacy(extra={},code=''){const ctx={esc:x=>String(x),state:{dept:'청년회',roleTab:'교사'},...extra};vm.createContext(ctx);vm.runInContext(code,ctx);return ctx;}
// 필요한 원본 상수/화면 함수를 직접 실행해 표시 계약을 비교한다.
function detail(t,edu){const fields={},ctx=legacy({t,extra:{edu},App:{permissions:{}},state:{},ASSIGNABLE_POSITIONS:[],TIER_BADGE:{},caseRankBadge:()=>'',actSummaryText:()=>'',applyText:()=>'',idShow:()=>false,tlKV:(key,value)=>{fields[key]=String(value);return '';}});
 vm.runInContext(part('const TL_GROUPS =','// 휴교사인데')+html.match(/const REQ_EDU_CATEGORIES_DEFAULT = .*?;/)[0]+part('function teacherSheetHtml(t, extra)','function wireTeacherSheet(t)'),ctx);
 const rendered=vm.runInContext('teacherSheetHtml(t,extra)',ctx);return {fields,rendered};}
const teacher={memberId:'r_fake',name:'가짜 교사',_rep:true,dept:'청년회',visits:3,lastVisit:'2026-11-13T05:00:00Z',regLeads:null,unregLeads:2,leads1y:9,apply:{},affilSel:'가짜 소속',genderSel:'여',counsel:7,gospelRoom:5,companion:2};
test('명단 부가 기록은 원본의 월별/구형 분기·마지막 접속·신청 정보를 보존한다',()=>{
 for(const values of [{},{monthStats:{}},{monthStats:{month:'2026-11',edu:2,counsel:0,gospel:3,family:4,companion:5,task:6,lead:7,teach:8,serve:9,tierRaw:'기타'}},{visits:0,lastVisit:'2026-11-13',apply:null},{counsel:0,gospelRoom:0,companion:0}]){
  const t={...teacher,...values},expected=detail(t,{}).fields,actual=teacherExtraFields(t);for(const [label,value] of Object.entries(actual))assert.equal(value,expected[label]);assert.equal('부서 기록란' in actual,'부서 기록란' in expected);
 }
 const rendered=detail(teacher,{}).rendered;assert.match(rendered,/<b>-<\/b><span>센터 등록<\/span>/);assert.match(rendered,/<b>2<\/b><span>센터 미등록<\/span>/);
});
test('활동 묶음 9개와 기본 교육 5개는 원본 순서·설명을 유지한다',()=>{
 const ctx=legacy({},part('const TL_GROUPS =','// 휴교사인데')+html.match(/const REQ_EDU_CATEGORIES_DEFAULT = .*?;/)[0]);assert.deepEqual(DETAIL_GROUPS,plain(vm.runInContext('TL_GROUPS.map(([group,,full])=>[group,full])',ctx)));assert.deepEqual(DEFAULT_EDUCATION,plain(vm.runInContext('REQ_EDU_CATEGORIES_DEFAULT',ctx)));
});
test('교육 이수 합계는 빈 categories의 기본값과 기존 truthy 기록 판정을 유지한다',()=>{
 for(const edu of [{},{categories:[],상담교육:'2026-11-13'},{categories:['가','나','다','라'],가:'',나:0,다:{date:'2026-11-13'},라:true}]){const summary=educationSummary(edu),{rendered}=detail(teacher,edu);assert.ok(rendered.includes(`${summary.completed} / ${summary.total} 과목 이수`));}
});
const chartPrelude=html.match(/const TIER_ORDER = .*?;/)[0]+html.match(/const TIER_CHART_COLOR = .*?;/s)[0]+html.match(/const ACTIVITY_PALETTE = .*?;/)[0]+part('function regionOnlyLabel(dept, region)','const TIER_BADGE')+html.match(/function pct\(a, b\) \{[^}]+\}/)[0];
function oldChart(fn,arg,code){const charts=[],ctx=legacy({arg,regionCharts:[],document:{getElementById:()=>({})},Chart:class {constructor(_canvas,config){charts.push(config);}}},chartPrelude+code);vm.runInContext(`${fn}(arg)`,ctx);return plain(charts[0]);}
test('지역 등급 그래프는 원본 5개 구분·색·정수 비율과 100% 축을 유지한다',()=>{
 const rows=[{region:'',totalTeachers:3,tierCounts:{휴교사:1,기타:1,활동교사:1}},{region:'2지역',totalTeachers:0,tierCounts:{우수교사:1}}];const original=plain(rows),old=oldChart('renderRegionCharts',rows,part('function renderRegionCharts(byRegion)','// ============ 2026-09-14'));
 assert.deepEqual(tierChart('청년회',rows),old.data);assert.equal(old.options.scales.x.max,100);assert.deepEqual(rows,original);
});
test('활동 비중 그래프는 원본 유형 순서·빈 지역·99/101% 반올림과 일치한다',()=>{
 for(const counts of [{A:1,B:1,C:1},{A:1,B:1,C:4},{A:0}]){const total=Object.values(counts).reduce((a,b)=>a+b,0),analysis={types:Object.keys(counts),regionStats:[{region:'',total,counts}]},old=oldChart('renderActivityAnalysisChart',analysis,part('function renderActivityAnalysisChart(analysis)','function activityAnalysisSectionHtml'));
  assert.deepEqual(activityChart('청년회',analysis),old.data);assert.equal(old.options.scales.x.stacked,true);assert.equal(old.options.scales.x.max,100);
 }
});
test('고정 샘플은 원본 12지역·모든 역할/항목/전체 합계와 정확히 일치한다',()=>{
 const ctx=legacy({},constants+part('const SAMPLE_REGIONS =','// ============ 2026-09-16: AI 분석'));assert.deepEqual(plain(sampleRoleBreakdown()),plain(vm.runInContext('buildSampleRoleActivityBreakdown()',ctx)));
});
const report={rows:[{memberId:'r_a',region:'10지역'},{memberId:'r_b',region:'2지역'},{memberId:'r_c',region:''}],byRegion:[{region:'10지역'},{region:'2지역'},{region:''}],analysisRows:[{memberId:'r_a',count:4,activities:['피드백','알수없는항목','만남1','만남1'],roles:['교사','교사']},{memberId:'r_b',count:4,activities:['섭외','친분','복음방','상담1'],roles:['협력교사','인도자']}]};
test('역할 표 합계는 원본 표시 항목만 합산하고 전체/AI 합계는 보존한다',()=>{
 const b=roleBreakdown(report),ctx=legacy({b,sectionTitleBand:()=>''},constants+part('function regionOnlyLabel(dept, region)','const TIER_BADGE')+part('function roleRegionSectionHtml(b)','// 2026-09-20: 지역별 강세'));
 for(const role of ROLES){ctx.state.roleTab=role;const rendered=vm.runInContext('roleRegionSectionHtml(b)',ctx),totals=[...rendered.matchAll(/<td class="font-bold text-primary">(\d+)<\/td>/g)].map(m=>Number(m[1]));assert.deepEqual(['','2지역','10지역'].map(region=>displayedRoleTotal(b,region,role)),totals);}
 assert.equal(displayedRoleTotal(b,'10지역','교사'),24);assert.equal(b.regionRoleTotal['10지역'].교사,32);
});
test('강세 항목은 원본 지역 숫자 순서와 동률 항목 순서·상위 3개를 유지한다',()=>{
 const b=roleBreakdown(report),ctx=legacy({b,sectionTitleBand:()=>''},constants+part('function regionOnlyLabel(dept, region)','const TIER_BADGE')+part('function strongItemSectionHtml(b)','function byRegionTableHtml'));
 const rendered=vm.runInContext('strongItemSectionHtml(b)',ctx),rows=[...rendered.matchAll(/<tr>\s*<td class="font-medium">([\s\S]*?)<\/tr>/g)].map(m=>m[0]);const actual=strongItems(b);assert.equal(rows.length,actual.length);actual.forEach((row,i)=>{row.items.forEach(item=>assert.ok(rows[i].includes(item.item)));assert.equal(row.items.length,Math.min(3,ROLE_ITEMS.filter(item=>b.regionItemTotal[row.region][item]>0).length));});assert.deepEqual(actual[1].items.map(x=>x.item),['섭외','친분','상담1']);
});
test('표/그래프·샘플 준비는 실제 집계나 다음 샘플을 변경하지 않는다',()=>{
 const before=plain(report),b=roleBreakdown(report),saved=plain(b);activityChart('청년회',activityAnalysis(report));strongItems(b);const sample=sampleRoleBreakdown();sample.counts['1지역'].교사.섭외=-1;assert.notEqual(sampleRoleBreakdown().counts['1지역'].교사.섭외,-1);assert.deepEqual(plain(b),saved);assert.deepEqual(report,before);
});
