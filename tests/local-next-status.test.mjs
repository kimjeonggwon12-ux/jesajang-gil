import {before,test} from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import {seedRemaining} from './helpers/remaining-fixture.mjs';
import {ids,PIN,sql} from './helpers/local-db.mjs';
import {nonParticipantSheets} from '../shared/non-participant-export.js';
const base='http://127.0.0.1:58434',legacy='http://127.0.0.1:58433',password='local-only-export-password';
async function api(action,body={},token,origin=base){const r=await fetch(origin+'/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...body,...(token?{_tk:token}:{})})});return {status:r.status,body:await r.json()};}
let ordinary,education,evangel;
before(async()=>{
 seedRemaining();sql("delete from alert_log where kind='명단엑셀'");
 ordinary=(await api('verifyLogin',{memberId:ids.member,name:'테스트교사',dept:'청년회',pin:PIN})).body.token;
 education=(await api('verifyLogin',{memberId:ids.admin,name:'테스트교육',dept:'청년회',pin:PIN})).body.token;
 evangel=(await api('verifyLogin',{memberId:ids.evangel,name:'테스트전도',dept:'전도부',pin:PIN})).body.token;
 assert.ok(ordinary&&education&&evangel);
});
test('현황 확장 조회는 일반 계정에도 기존 전체 응답·역할·부서 범위를 유지한다',async()=>{
 const reads=[['getChurchTopRegions',{}],['getAllCenterLeads',{}],['getKeyStageCount',{}],['getNonParticipants',{}],['getSettlementReport',{}],...['자문회','장년회','부녀회','청년회'].map(dept=>['getTopRegions',{dept}]),...['','인도자','교사','섬김이','협력교사'].map(role=>['getActivityItemDistribution',{role}])];
 for(const [action,body] of reads){const result=await api(action,body,ordinary);assert.equal(result.status,200);assert.equal(result.body.error,undefined);assert.deepEqual(result,await api(action,body,ordinary,legacy),action);}
 assert.ok((await api('getAllCenterLeads',{},ordinary)).body.rows.length>1000);
});
test('미참여 명단 다운로드는 비로그인·일반 계정·잘못된 비밀번호를 거절한다',async()=>{
 assert.equal((await api('exportNonParticipants',{password})).status,401);
 const denied=await api('exportNonParticipants',{password,memberId:ids.admin},ordinary);assert.ok(denied.status===403||denied.body.error);assert.equal(denied.body.base64,undefined);
 const bad=await api('exportNonParticipants',{password:'wrong'},education);assert.match(bad.body.error,/비밀번호/);assert.equal(bad.body.base64,undefined);
 assert.match((await api('exportNonParticipants',{password,dept:'없는부서'},education)).body.error,/부서/);
});
test('교육·전도 담당자 엑셀은 세 시트 전체를 포함하고 검색/페이지로 축소되지 않는다',async()=>{
 const report=(await api('getNonParticipants',{},ordinary)).body;
 for(const [token,dept] of [[education,''],[evangel,'청년회'],[education,'기타']]){
  const result=await api('exportNonParticipants',{password,dept,query:'존재하지않는검색',page:99,limit:1},token);assert.equal(result.status,200);assert.ok(result.body.base64);
  const workbook=XLSX.read(Buffer.from(result.body.base64,'base64'),{type:'buffer'}),expected=nonParticipantSheets(report,dept);
  assert.deepEqual(workbook.SheetNames,expected.map(sheet=>sheet.name));
  for(const sheet of expected){const cells=XLSX.utils.sheet_to_json(workbook.Sheets[sheet.name],{header:1,blankrows:true,defval:''});assert.deepEqual(cells.map((row,i)=>row.slice(0,sheet.rows[i]?.length||0)),sheet.rows);assert.ok(cells.length>50);}
  assert.match(result.body.fileName,/\.xlsx$/);
 }
});
test('다운로드 실행 기록은 요청 본문의 사칭 이름 대신 인증한 담당자를 기록한다',async()=>{
 const forged=await api('exportNonParticipants',{password,dept:'자문회',name:'가짜사칭',memberId:ids.evangel},education);assert.equal(forged.status,403);assert.equal(forged.body.base64,undefined);
 const r=await api('exportNonParticipants',{password,dept:'자문회',name:'가짜사칭',memberId:ids.admin},education);assert.ok(r.body.base64);
 const audit=sql("select summary from alert_log where kind='명단엑셀' and ok=true and summary like '파일 준비 · exportNonParticipants · %' order by id desc limit 1");
 assert.match(audit,/테스트교육/);assert.match(audit,new RegExp(ids.admin));assert.doesNotMatch(audit,/가짜사칭/);
 assert.match(audit,/"dept":"자문회"/);
});
