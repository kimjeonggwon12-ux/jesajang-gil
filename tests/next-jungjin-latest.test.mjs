import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const before=file=>execFileSync('git',['show','0ea5ac7:'+file],{encoding:'utf8'});
const after=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const clean=s=>s.replace(/^import .*;\n/gm,'').replace(/^export (?:default )?\{.*\};?$/gm,'').replace(/export /g,'');
const json=x=>JSON.parse(JSON.stringify(x));
const m={meetingId:'MT-FAKE-JJ',title:'가짜 목요 교육',date:'2026-11-13'};
function people(sessions){return [
 ['가짜참석','01',{오전:{late:'정상'},저녁:{late:'2분 지각'}}],['가짜저녁','02',{저녁:{late:'정상'}}],['가짜공무','01',{}],['가짜불참','02',{}],
].map(([name,district,att],i)=>({nid:'99000000003'+String(i).padStart(2,'0'),name,dept:'24부서',affiliation:'가짜부서'+district,district,att:Object.fromEntries(Object.entries(att).filter(([k])=>sessions.includes(k)))}));}
function education(source,P,ex){
 const c=vm.createContext({Buffer,console,process:{env:{}},normId:s=>s,orgLabel:(a,b)=>b,REASONS:['직장','병결','가정사','개인사'],eduCardPng:C=>Buffer.from(JSON.stringify(C))});
 vm.runInContext(clean(source)+';this.api={'+(source.includes('function buildJungjinReport')?'buildJungjinReport':'jungjinParts')+(source.includes('function buildJungjinReport')?'};':'};prepare=async()=>this.P;roster24=async()=>this.P.people;excusedOf=async()=>this.ex;'),c);
 c.P=P;c.ex=ex;return c;
}
test('중진 오전·저녁·하루 카드와 명단이 운영 계산/문구와 같고 참석은 공무보다 우선한다',async()=>{
 for(const sessions of [['오전'],['저녁'],['오전','저녁']])for(const kind of ['목사교','화전단']){
  const phase=sessions.length>1?'최종':sessions[0],P={people:people(sessions),sessions,phase,outside:[]},ex=new Set([P.people[0].nid,P.people[2].nid]);
  const old=education(before('server/lib/edu-attendance.js'),P,ex),now=education(after('server/lib/edu-attendance.js'),P,ex);
  // 11/17(사용자): 머리 이름만 '24부서 전체' → '【 24부서 장부청 소속 】' 로 바뀜(나머지는 같아야 함)
  const a=JSON.parse(JSON.stringify(await old.api.jungjinParts(m,phase,kind)).replaceAll('<b>24부서 전체</b>','<b>【 24부서 장부청 소속 】</b>')),b=now.api.buildJungjinReport(m,phase,kind,P,ex);
  assert.deepEqual(json(b.parts.map(({part,...p})=>p)),json(a));assert.equal(b.C.total.n,4);assert.equal(b.C.total.excused,1);
  assert.equal(b.C.total.came+b.C.total.excused+b.C.total.absent,4);assert.equal(b.C.total.rate,sessions[0]==='오전'&&sessions.length===1?'25.0%':'50.0%');
 }
});
test('한 소속의 긴 공무 명단도 빠뜨리지 않고 메시지 길이 안에서 나눈다',()=>{
 const P={people:Array.from({length:1007},(_,i)=>({nid:String(i),name:'가짜성명'+String(i).padStart(4,'0'),dept:'24부서',affiliation:'가짜소속',district:'01',att:{}})),sessions:['오전'],phase:'오전',outside:[]},ex=new Set(P.people.map(p=>p.nid)),c=education(after('server/lib/edu-attendance.js'),P,ex);
 const r=c.api.buildJungjinReport(m,'오전','목사교',P,ex),texts=r.parts.slice(1).map(p=>p.text),all=texts.join('\n');
 assert.equal(r.C.total.excused,1007);assert.equal(r.C.total.absent,0);assert.ok(texts.every(t=>t.length<=3900));for(const p of P.people)assert.equal(all.split(p.name).length-1,1);
});
test('공무 칸과 일반 이전 참석률 카드의 SVG가 최신 운영 서식과 같다',()=>{
 for(const excusedCol of [true,false]){
  const C={title:'가짜 출석',rows:[{label:'가짜부서',n:4,came:2,rate:'50.0%',prev:'25.0%',excused:1,absent:1,absentRate:'25.0%'}],total:{n:4,came:2,rate:'50.0%',prev:'25.0%',excused:1,absent:1,absentRate:'25.0%'},reasonTotal:1,excusedCol};
  const run=s=>{const c=vm.createContext({Buffer,path,fileURLToPath,bundledFontFiles:()=>[],Resvg:class{constructor(svg){this.svg=svg;}render(){return{asPng:()=>Buffer.from(this.svg)};}}});vm.runInContext(clean(s).replaceAll('import.meta.url',JSON.stringify(import.meta.url))+';this.card=eduCardPng;',c);return c.card(C).toString();};
  assert.equal(run(after('server/lib/edu-card.js')),run(before('server/lib/edu-card.js')));
 }
});
function bot(source){
 const q={select(){return this;},eq(){return this;},limit(){return this;},then(resolve){return Promise.resolve([{ref_id:'#중진'}]).then(resolve);}};
 const c=vm.createContext({console,process:{env:{}},BOARD_COLS:[],boardLabel:x=>x,db:()=>({from:()=>q}),run:async q=>q,esc:s=>String(s),kstDate:()=> '2026-11-13',kstDateTime:()=> '2026-11-13 '+c.hm+':00'});
 vm.runInContext(clean(source)+`;this.api={summaryTick,sendJungjinTiers,composeEvening};sendNoonSummary=async()=>this.calls.push('noon');sendEveningSummary=async()=>this.calls.push('evening');sendDailySummary=async()=>this.calls.push('daily');sendNewsOneline=async()=>this.calls.push('news');`,c);
 return c;
}
test('중진 등급 문구와 22시 뉴스 다음 실행 순서는 운영과 같다',async()=>{
 for(const source of [before('server/actions/bot.js'),after('server/actions/bot.js')]){
  const c=bot(source);vm.runInContext(`composeEvening=async()=>({tiers:'가짜 등급 집계'});pendingChurchRooms=async()=>[{dept:'#중진',chat_id:'-990301'}];sendToRooms=async(rooms,kind,day,send)=>{for(const r of rooms)await send(r);return ['#중진'];};sendRoomText=async(chat,text)=>this.output=text;`,c);
  await c.api.sendJungjinTiers('2026-11-13');assert.equal(c.output,'🏷 <b>교자장부청 교사 등급 현황</b> · 11월 13일(금) 밤 10시\n휴교사·활동교사·정교사·우수교사\n\n가짜 등급 집계');
  vm.runInContext(`sendJungjinTiers=async()=>this.calls.push('jungjin');`,c);
  for(const [hm,expected] of [['21:59',[]],['22:00',['evening','news','jungjin']],['22:59',['evening','news','jungjin']],['23:00',['evening','daily']]]){c.hm=hm;c.calls=[];await c.api.summaryTick();assert.deepEqual(json(c.calls),expected);}
 }
});
test('출석 자동 마감에서 중진과 기존 교육을 함께 호출하고 시험 접두/과정 모임은 제외한다',async()=>{
 const calls=[],c=vm.createContext({console,ea:{postJungjin:async()=>{calls.push('jungjin');return['중진'];},eduFor:async()=>({}),postEduAttendance:async()=>{calls.push('education');return['교육'];}}});
 vm.runInContext(clean(after('server/lib/room-attendance.js')).replaceAll("import('./edu-attendance.js')",'Promise.resolve(this.ea)')+';this.post=postRoomAttendance;',c);
 assert.deepEqual(json(await c.post(m,'최종')),['중진','교육']);assert.deepEqual(calls,['jungjin','education']);calls.length=0;
 assert.deepEqual(json(await c.post(m,'오전','[시험]')),['교육']);assert.deepEqual(calls,['education']);
 for(const excluded of [{...m,title:'[TEST] 가짜'},{...m,cohortId:'CH-FAKE'}])assert.deepEqual(json(await c.post(excluded,'최종')),[]);
});
test('중진 시험 도구는 운영 키·유효 날짜·설정된 시험 방을 쓰고 뉴스 실패 뒤 등급을 보내지 않는다',async()=>{
 const c=bot(after('server/actions/bot.js'));c.process.env.TEACHERSQUARE_CRON_KEY='fake-key';c.calls=[];
 vm.runInContext(`this.test=tsJungjinTest;testChat=()=>'-990309';sendNewsOneline=async(body,chat)=>{this.calls.push({body,chat});return {ok:this.newsOk};};sendJungjinTiers=async(day,to)=>{this.calls.push({day,to});return{sent:['test']};};`,c);
 assert.equal((await c.test({key:'bad'})).error,'unauthorized');await assert.rejects(c.test({key:'fake-key',date:'2026-02-30'}));assert.equal(c.calls.length,0);
 c.newsOk=false;assert.equal((await c.test({key:'fake-key',date:'2026-11-13'})).news,false);assert.equal(c.calls.length,1);
 c.calls=[];c.newsOk=true;assert.equal((await c.test({key:'fake-key',date:'2026-11-13'})).news,true);assert.equal(c.calls.length,2);assert.equal(c.calls[0].chat,'-990309');assert.equal(c.calls[1].to.chat_id,'-990309');
});
