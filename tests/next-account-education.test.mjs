import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {acceptPinSession,logVisitOnce} from '../next-app/lib/account-settings.ts';
import {educationCandidates,educationToday} from '../next-app/lib/required-education.ts';
import {DEFAULT_EDUCATION} from '../next-app/lib/directory-detail.ts';
import {saveSession,loadSession,clearSession} from '../next-app/lib/session.ts';
const source=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const store=()=>{const data=new Map();return {data,getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};};
const setup=()=>{globalThis.localStorage=store();globalThis.sessionStorage=store();return saveSession('m9900000000001.old.signature',{memberId:'9900000000001',name:'가짜교사',dept:'청년회'},'old');};
test('PIN 변경은 같은 계정의 새 세션만 받아 PIN 원문 없이 버전을 갱신한다',()=>{
 const current=setup(),next=acceptPinSession(current,{ok:true,token:'m9900000000001.new.signature',pinVer:'new'});
 assert.deepEqual(loadSession(),next);assert.equal(next.account.name,current.account.name);
 assert.deepEqual(JSON.parse(localStorage.getItem('podo_pin')),{id:'9900000000001',ver:'new'});
 assert.deepEqual([...localStorage.data.keys()].sort(),['pd_tk_v1','podo_member','podo_pin']);
});
test('PIN 변경의 늦은 응답은 로그아웃·다른 계정·이미 갱신된 세션을 덮지 않는다',()=>{
 for(const mode of ['logout','other','newer']){
  const current=setup();if(mode==='logout')clearSession();else saveSession(mode==='other'?'m9900000000002.other.signature':'m9900000000001.newer.signature',{memberId:'9900000000002',name:'새 계정',dept:'교육부'});
  const before=loadSession();assert.equal(acceptPinSession(current,{ok:true,token:'m9900000000001.late.signature',pinVer:'late'}),null);assert.deepEqual(loadSession(),before);
 }
});
test('PIN 변경 응답의 실패·잘못된 계정과 저장 장애를 성공으로 처리하지 않는다',()=>{
 for(const result of [{ok:false},{ok:true},{ok:true,token:'m9900000000002.bad.signature'}]){const current=setup();assert.throws(()=>acceptPinSession(current,result),/로그인/);assert.deepEqual(loadSession(),current);}
 const current=setup();localStorage.setItem=()=>{throw Error('full');};assert.throws(()=>acceptPinSession(current,{ok:true,token:'m9900000000001.new.signature'}),/저장/);assert.equal(loadSession(),null);
});
test('필수교육의 다섯 항목·UTC 기본 날짜와 검색 순서/8명/부서 원문 범위가 원본과 같다',()=>{
 const oldCats=vm.runInNewContext(source.match(/const REQ_EDU_CATEGORIES = (\[[^;]+\]);/)[1]);assert.deepEqual(DEFAULT_EDUCATION,Array.from(oldCats));
 const rows=Array.from({length:20},(_,i)=>({memberId:'r_ref'+i,name:'가짜'+i,dept:['청년회',' 청년회 ','전도부','부녀회'][i%4],region:'1지역'}));
 const code=source.slice(source.indexOf('function reqEduSearchResults()'),source.indexOf('async function pickReqEduTeacher'));
 for(const query of ['',' 가짜 ','가짜1','r_ref2'])for(const dept of ['','청년회','기타']){
  const context={reqEduForm:{query,orgFilter:dept},roster:rows,orgBucket:d=>['교역자','자문회','장년회','부녀회','청년회'].includes(d)?d:'기타'};
  vm.runInNewContext(code,context);assert.deepEqual(educationCandidates(rows,query,dept),Array.from(context.reqEduSearchResults()));
 }
 const oldDate=vm.runInNewContext(source.match(/function reqEduTodayStr\(\) \{[^}]+\}/)[0]+';reqEduTodayStr()');assert.equal(educationToday(),oldDate);
});
test('접속 집계는 원본처럼 탭당 한 번이며 실패도 자동 재시도하지 않는다',async()=>{
 const storage=store();let calls=0;
 const send=async()=>{calls++;throw Error('offline');};
 for(let i=0;i<4;i++)logVisitOnce({memberId:'9900000000001',name:'가짜',dept:'청년회'},send,storage);
 await Promise.resolve();assert.equal(calls,1);assert.equal(storage.getItem('pd_visit'),'1');
 logVisitOnce({memberId:'9900000000002',name:'손님',dept:'청년회',guest:true},send,store());assert.equal(calls,1);
 const context={window:{},sessionStorage:store(),callApi:send};vm.runInNewContext(source.slice(source.indexOf('function logVisitOnce(id, nm)'),source.indexOf('function attLeaveQrOnly()')),context);
 context.logVisitOnce('9900000000001','가짜');context.logVisitOnce('9900000000001','가짜');await Promise.resolve();assert.equal(calls,2);
});
