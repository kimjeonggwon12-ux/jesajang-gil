import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import {participationRows,participationTitle,monthlyMvp,maskName,leadMonths,monthlyLeaders,percent} from '../next-app/lib/status-extra.ts';
import {nonParticipantSheets} from '../shared/non-participant-export.js';
const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const part=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
const clone=value=>JSON.parse(JSON.stringify(value));
test('참여 이미지의 다섯 부서·제목·빈 자료·백분율은 기존 표시 계산과 같다',()=>{
 const code=part('const PART_DEPTS =','function participationSectionHtml()')+part('function participationTitle()','function drawParticipationChart()');
 for(const orgSummary of [{month:'2026-11',orgs:[{dept:'청년회',totalTeachers:100,activeCount:35},{dept:'기타',totalTeachers:999,activeCount:999}]},{month:'',orgs:[]}]){
  const ctx={orgSummary};vm.createContext(ctx);vm.runInContext(code,ctx);
  assert.deepEqual(participationRows(orgSummary),clone(vm.runInContext('participationRows()',ctx)));
  assert.equal(participationTitle(orgSummary.month),vm.runInContext('participationTitle()',ctx));
 }
 assert.equal(percent(1,3),33.3);assert.equal(percent(1,0),0);
});
test('MVP는 부서 전체 최댓값·첫 동률·0건 미선정을 유지하며 이름 가림은 기존과 같다',()=>{
 const ctx={};vm.createContext(ctx);vm.runInContext(part('function maskName(nm)','    App.maskName ='),ctx);
 for(const name of ['', '가', '가나', ' 가짜교사 ', '가😀나']){ctx.value=name;assert.equal(maskName(name),vm.runInContext('maskName(value)',ctx));}
 const source=part('function mvpCardHtml(allRows)','// ============ Phase 2');
 const start=source.indexOf('  const top ='),end=source.indexOf('  return `',start);
 const oldCode='function oldMvp(allRows){if(!allRows.length)return null;'+source.slice(start,end).replace("return '';",'return null;')+'return top;}';
 assert.ok(start>=0&&end>start);vm.runInContext(oldCode,ctx);
 for(const rows of [[],[{name:'가',monthlyCount:0}],[{name:'나',monthlyCount:8},{name:'가',monthlyCount:8},{name:'다',monthlyCount:1}]]){
  ctx.rows=rows;assert.deepEqual(monthlyMvp(rows),clone(vm.runInContext('oldMvp(rows)',ctx)));
 }
});
test('센터 월별 계산은 번호 공백·다른 표기·동률 순서와 1,000건 이후를 보존한다',()=>{
 const rows=[{memberId:'20',name:'가',date:'2026-11-02'},{memberId:'3',name:'나',date:'2026-11-02'},...Array.from({length:1005},(_,i)=>({memberId:i%2?' 9900000000001 ':'09900000000001',name:'가짜'+i,date:'2026-10-01'})),{memberId:'9900000000001',name:'다',date:''}];
 const code=part('    const monthRows = (allLeads','    body = `');
 for(const month of ['2026-11','2026-10','2000-01']){
  const ctx={allLeads:rows,leadsMonthFilter:month};vm.createContext(ctx);
  assert.deepEqual(monthlyLeaders(rows,month),clone(vm.runInContext(code+'({total:monthRows.length,people:memberList})',ctx)));
 }
 assert.deepEqual(leadMonths(rows),['2026-11','2026-10']);
});
test('미참여자 세 시트의 모든 셀과 부서 범위가 이전 HTML 엑셀과 같다',async()=>{
 const original=execFileSync('git',['show','4b8233f3647ad1bc8c8891f7b4191c8f32a4f22f:app.html'],{cwd:new URL('../',import.meta.url),encoding:'utf8',maxBuffer:8*1024*1024});
 const slice=(a,b)=>original.slice(original.indexOf(a),original.indexOf(b,original.indexOf(a)));
 const report={from:'2026-11-01',asOf:'2026-11-12',rows:Array.from({length:1205},(_,i)=>({name:'가짜'+i,dept:i%2?'청년회':'기타',region:i%3?'1지역':'',tier:'활동교사',inactive:i%3!==0,noEdu:i%4!==0}))};
 for(const dept of ['', '청년회', '기타', '교역자']){
  let written;const button={},XLSX={utils:{book_new:()=>({sheets:[]}),aoa_to_sheet:rows=>({rows}),book_append_sheet:(book,sheet,name)=>book.sheets.push({name,rows:sheet.rows})},writeFile:book=>{written=book;}};
  const ctx={nonPart:report,nonPartDept:dept,window:{XLSX},XLSX,document:{querySelectorAll:()=>[],getElementById:id=>id==='np-xlsx'?button:null},console};vm.createContext(ctx);
  vm.runInContext(slice('function nonPartRows(view)','const npPct =')+slice('function wireNonPart()','window.addEventListener(\'resize\''),ctx);
  vm.runInContext('wireNonPart()',ctx);await button.onclick();assert.deepEqual(nonParticipantSheets(report,dept),clone(written.sheets));
 }
});
