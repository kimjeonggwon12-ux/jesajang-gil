import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {monthTabs,parse} from '../next-app/lib/roster-excel.mjs';
import {defaultKeepIds,toggleId} from '../next-app/lib/roster-import.ts';
import * as XLSX from '../next-app/node_modules/xlsx/xlsx.mjs';
import {activitySheet} from './helpers/import-fixture.mjs';
const clone=value=>JSON.parse(JSON.stringify(value)),ctx={};vm.createContext(ctx);vm.runInContext(readFileSync(new URL('../roster-excel.js',import.meta.url),'utf8'),ctx);
const activity=activitySheet([{memberId:'9900000000001',name:'가짜 이름',dept:'청년회',region:'01지역',note:'구역',tier:'기타교사'},{memberId:'9900000000002',name:'가짜둘',dept:'청년회',region:'01지역',note:'',tier:'알수없음'}]);
const oldSheet=[['','','','','','','','','','','센터등록','','','센터미등록','','','','실제인도'],['고유번호','이름','부서','지역','소속비고','상담','복음방','동행교사','결과'],['9900000000001','가짜하나','청년회','1지역','구역',2,3,4,'',0,1,2,3,4,5,6,7,'9900000000001','9900000000001','9900000000002'],['9900000000002','가짜둘','부녀회','2지역','',0,0,0,'활동교사',0,0,0,0,0,0,0,0,'9900000000001'],['9900000000003','가짜셋','청년회','3지역','',0,0,0,'']];
test('두 엑셀 서식·휴면·중복·빈 열의 이름/활동/등급 계산이 기존 파서와 일치한다',()=>{
 for(const sheets of [{'11월':activity},{'9월':oldSheet,'휴면':[['고유번호'],['9900000000003']]},{'9월':oldSheet},{'11월':activity.concat([activity[2]])},{'11월':[['잘못된 파일']]}]){
  const tab=Object.keys(sheets)[0],rowsOf=name=>sheets[name]||null;
  assert.deepEqual(clone(parse(rowsOf,tab)),clone(ctx.RosterExcel.parse(rowsOf,tab)));
 }
 assert.deepEqual(monthTabs(['9월','1월','11월','휴면','명단']),clone(ctx.RosterExcel.monthTabs(['9월','1월','11월','휴면','명단'])));
 const legacy=parse(name=>name==='9월'?oldSheet:name==='휴면'?[['고유번호'],['9900000000003']]:null,'9월');
 assert.deepEqual(legacy.rows.map(r=>r.tier),['우수교사','정교사','휴교사']);
});
test('고정 SheetJS 버전으로 실제 XLSX/XLS 파일을 읽어도 서식과 결과가 같다',()=>{
 assert.equal(XLSX.version,'0.20.3');
 for(const bookType of ['xlsx','biff8']){
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(activity),'11월');
  const loaded=XLSX.read(XLSX.write(book,{type:'array',bookType}),{type:'array'});
  const parsed=parse(name=>XLSX.utils.sheet_to_json(loaded.Sheets[name],{header:1,defval:'',raw:true}),'11월');
  assert.deepEqual(clone(parsed),clone(parse(name=>name==='11월'?activity:null,'11월')));
 }
});
test('첫 미리보기의 남김 선택은 300명 이후도 포함하고 페이지와 무관하게 유지한다',()=>{
 const people=Array.from({length:650},(_,i)=>({memberId:'fake-'+i,position:i%2?'교사':'',adminPosition:i%2?'':'교관'}));
 const kept=defaultKeepIds({removed:{rows:people},kept:{rows:[]}});assert.equal(kept.length,650);assert.ok(kept.includes('fake-649'));
 const changed=toggleId(kept,'fake-600',false);assert.equal(changed.length,649);assert.equal(toggleId(changed,'fake-600',true).length,650);
});
