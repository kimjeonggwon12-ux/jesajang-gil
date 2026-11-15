import {test,beforeEach,afterEach,mock} from 'node:test';
import assert from 'node:assert/strict';
let rows,legacy,sends,failAt,waits,now;
const realTimeout=globalThis.setTimeout,realNow=Date.now;
function query(table){let kind='read',value,filters=[];const q={select(){return q;},eq(k,v){filters.push([k,v]);return q;},limit(){return q;},insert(v){kind='insert';value=v;return q;},update(v){kind='update';value=v;return q;},then(resolve,reject){return Promise.resolve().then(()=>{const list=table==='cohort_summary_log'?legacy:rows;const selected=list.filter(r=>filters.every(([k,v])=>r[k]===v));if(kind==='insert'){if(rows.some(r=>r.delivery_key===value.delivery_key))return{data:null,error:{code:'23505'}};rows.push({...value});return{data:[],error:null};}if(kind==='update')for(const row of selected)Object.assign(row,value);return{data:selected,error:null};}).then(resolve,reject);}};return q;}
await mock.module('../server/lib/db.js',{namedExports:{db:()=>({from:query}),run:async q=>{const r=await q;if(r.error)throw Error('fake DB failure');return r.data;}}});
await mock.module('../server/lib/report-room.js',{namedExports:{sendRoomText:async(chat,text)=>{sends.push({chat,text});if(sends.length===failAt)throw Error('secret token must not appear');},sendRoomBoardConfirmed:async(room,png,caption,text)=>{sends.push({chat:room.chat_id,text});if(sends.length===failAt)throw Error('private provider error');}}});
const {deliverEduParts}=await import('../server/lib/edu-delivery.js');
const m={meetingId:'MT-FAKE',date:'2026-11-12'},parts=[{room:{dept:'청년회/01지역',chat_id:'-990001',title:'가짜 방'},text:'가짜 1'},{room:{dept:'청년회/01지역',chat_id:'-990001',title:'가짜 방'},text:'가짜 2'}];
beforeEach(()=>{rows=[];legacy=[];sends=[];failAt=0;waits=[];now=10000;Date.now=()=>now;globalThis.setTimeout=(fn,ms)=>{waits.push(ms);now+=ms;queueMicrotask(fn);return 0;};});
afterEach(()=>{Date.now=realNow;globalThis.setTimeout=realTimeout;});
test('교육 보고 빈 목록은 성공하지 않고 확인된 전송만 기록하며 다음 자동 실행은 중복을 생략한다',async()=>{
 await assert.rejects(deliverEduParts(m,'최종',[]),/보낼 교육 보고/);const a=await deliverEduParts(m,'최종',parts);assert.equal(a.sent.length,2);assert.ok(rows.every(r=>r.status==='sent'));assert.deepEqual(waits,[3200]);const b=await deliverEduParts(m,'최종',parts);assert.equal(b.sent.length,0);assert.equal(b.skipped.length,2);assert.equal(sends.length,2);
});
test('일부 실패·기록 중단은 확인 필요로 남기고 자동 재전송하지 않으며 새 수동 전달은 명시적으로만 실행한다',async()=>{
 failAt=2;const a=await deliverEduParts(m,'최종',parts);assert.equal(a.ok,false);assert.equal(a.sent.length,1);assert.equal(a.failed.length,1);assert.equal(rows[1].status,'unknown');assert.ok(!JSON.stringify(a).includes('secret'));const b=await deliverEduParts(m,'최종',parts);assert.equal(b.failed.length,1);assert.equal(sends.length,2);rows[1].status='sending';const c=await deliverEduParts(m,'최종',parts);assert.equal(c.failed.length,1);assert.equal(sends.length,2);failAt=0;await deliverEduParts(m,'최종',parts,{manual:true});assert.equal(sends.length,4);
});
test('시험 전송은 실제 지역 방에 보내지 않고 기존 방 완료 이력은 재발송하지 않는다',async()=>{
 await deliverEduParts(m,'오전',parts,{testChat:'-990019',manual:true});assert.ok(sends.every(s=>s.chat==='-990019'&&s.text.includes('[시험]')));sends=[];legacy=[{cohort_id:'#edu-att',kind:'오전',ref_id:'청년회/01지역|MT-FAKE',date:m.date}];const r=await deliverEduParts(m,'오전',parts);assert.equal(r.skipped.length,2);assert.equal(sends.length,0);
});
