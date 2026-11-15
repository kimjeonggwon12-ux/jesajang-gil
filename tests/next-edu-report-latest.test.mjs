import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {REASONS} from '../server/lib/edu-card.js';
import {orgLabel} from '../server/lib/report-room.js';

// 0ea5ac7의 보고 계산/서식을 독립 실행해 대조한다. 실제 개인 상수나 방 번호는 저장/출력하지 않는다.
const oldSource=execFileSync('git',['show','0ea5ac7:server/lib/edu-attendance.js'],{encoding:'utf8'});
const newSource=readFileSync(new URL('../server/lib/edu-attendance.js',import.meta.url),'utf8');
const json=x=>JSON.parse(JSON.stringify(x));
const m={meetingId:'MT-FAKE-LATEST',date:'2026-11-13',title:'가짜 목요 교육'};
const rooms=[{dept:'#교육:RS-FAKE',chat_id:'-990201',active:true},{dept:'청년회',chat_id:'-990202',active:true},{dept:'청년회/01지역',chat_id:'-990203',active:true},{dept:'#중진',chat_id:'-990204',active:true}];
function sandbox(source){
 const query={select(){return this;},eq(){return this;},order(){return this;},then(resolve){return Promise.resolve(rooms).then(resolve);}};
 const ctx=vm.createContext({Buffer,console,process:{env:{}},normId:s=>String(s).replace(/\D/g,''),kstDateTime:()=> '2026-11-13 12:00:00',REASONS,orgLabel,topicPending:()=>false,BOARD_THEME:{},db:()=>({from:()=>query}),run:async q=>q,selectAll:async make=>make(),eduCardPng:c=>Buffer.from(JSON.stringify(c)),workbookFiles:s=>{ctx.sheets=s;return{};},zip:()=>Buffer.from('PK')});
 const code=source.replace(/^import .*;\n/gm,'').replace(/export default \{[^}]+\};/g,'').replace(/export /g,'');
 vm.runInContext(code+`;prepare=async()=>this.prepared;prevRates=async()=>this.previous;this.oracle={deptWhole,deptSheetsOf,buildEduAttendance,cardData,eduExcel};`,ctx);
 return ctx;
}
function prepared(sessions){
 const rows=[
  ['가짜행서A','24부서','가짜행서부','02',{오전:{late:'정상'},저녁:{late:'3분 지각'}}],
  ['가짜기획B','24부서','가짜기획부','01',{저녁:{late:'정상'}}],
  ['가짜행서C','24부서','가짜행서부','02',{}],
  ['가짜기타D','24부서','','',{}],
  ['가짜청년E','청년회','','',{오전:{late:'1분 지각'}}],
  ['가짜부녀F','부녀회','','',{}],
  ['가짜교역G','교회교역','','',{오전:{late:'정상'}}],
 ];
 return {people:rows.map(([name,dept,affiliation,district,att],i)=>({name,dept,affiliation,district,nid:String(9900000000200+i),member_id:String(9900000000200+i),region:'01지역',position:'담당',key:dept==='24부서'?'':dept==='교회교역'?'교역자':dept+'/01지역',att:Object.fromEntries(Object.entries(att).filter(([s])=>sessions.includes(s)))})),outside:[],sessions,phase:sessions.length>1?'최종':sessions[0]};
}
test('최신 운영의 24부서 묶음·소속 순서·오전/저녁/하루 계산과 엑셀 모든 셀이 같다',async()=>{
 for(const sessions of [['오전'],['저녁'],['오전','저녁']]){
  const old=sandbox(oldSource),now=sandbox(newSource),P=prepared(sessions),edu={series:{series_id:'RS-FAKE',summary_to:'room'}};
  for(const c of [old,now]){c.prepared=P;c.previous={'가짜기획부':50,'가짜행서부':100,'기타':0,'종합':50};}
  for(const dept of ['24부서','청년회','부녀회'])assert.deepEqual(json(await now.oracle.deptWhole(m,P.phase,P,edu,dept)),json(await old.oracle.deptWhole(m,P.phase,P,edu,dept)));
  const beforeSheets=await old.oracle.deptSheetsOf(m,P,edu),afterSheets=await now.oracle.deptSheetsOf(m,P,edu);
  assert.deepEqual(json(afterSheets),json(beforeSheets));assert.deepEqual(json(afterSheets.map(x=>x.name)),['24부서']);
  const C=now.oracle.cardData(m,P,now.previous);now.oracle.eduExcel(m,P,C,afterSheets);old.oracle.eduExcel(m,P,C,beforeSheets);
  assert.deepEqual(json(now.sheets),json(old.sheets));assert.deepEqual(json(now.sheets.map(x=>x.name)),['총합','24부서','명단','재적 밖 참석']);
  const read=async c=>(await c.oracle.buildEduAttendance(m,P.phase,edu,{eduOnly:true})).map(({part,sheets,...p})=>p);
  assert.deepEqual(json(await read(now)),json(await read(old)));
  const c=json(JSON.parse((await now.oracle.deptWhole(m,P.phase,P,edu,'24부서'))[0].png.toString()));
  assert.equal(c.firstHead,'부서');assert.deepEqual(c.rows.map(r=>r.label),['가짜기획부','가짜행서부','기타']);
  if(sessions.length===2){assert.equal(c.total.n,4);assert.equal(c.total.came,2);assert.equal(c.total.late,1);assert.equal(c.total.absent,2);assert.deepEqual(c.total.by,{오전:1,저녁:2});}
 }
});
test('24부서가 없으면 기존 세 시트와 다른 부서 보고를 유지한다',async()=>{
 const old=sandbox(oldSource),now=sandbox(newSource),P=prepared(['오전','저녁']);P.people=P.people.filter(p=>p.dept!=='24부서');
 const edu={series:{series_id:'RS-FAKE',summary_to:'room'}};
 for(const c of [old,now]){c.prepared=P;c.previous=null;const sheets=await c.oracle.deptSheetsOf(m,P,edu);assert.equal(sheets.length,0);c.oracle.eduExcel(m,P,c.oracle.cardData(m,P,null),sheets);}
 assert.deepEqual(json(now.sheets),json(old.sheets));assert.deepEqual(json(now.sheets.map(x=>x.name)),['총합','명단','재적 밖 참석']);
});
