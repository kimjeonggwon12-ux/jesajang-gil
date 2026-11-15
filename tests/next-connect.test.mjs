import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {connectItemsForRoles,CONNECT_ROLES,CONNECT_ITEMS,COOP_ITEMS,ALL_CONNECT_ITEMS,emptyConnectCard,emptyCardFilter,filterCards,filterHelps,splitIntroduction,chatKey} from '../next-app/lib/connect.ts';
import {createPrivateChat} from '../next-app/lib/private-chat.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('연결 역할 조합별 항목은 기존 HTML의 모든 16조합과 같다',()=>{
 const html=readFileSync(new URL('../app.html',import.meta.url),'utf8'),source=html.match(/function cnItemsForRoles\(roles\) \{[^\n]+\}/)[0],ctx={COOP_ROLE:'협력교사',CN_ROLE_ITEMS:CONNECT_ITEMS,CN_ALL_ITEMS:ALL_CONNECT_ITEMS,cnItemsForRole:r=>r==='협력교사'?COOP_ITEMS:CONNECT_ITEMS};vm.runInNewContext(source,ctx);
 for(let bits=0;bits<16;bits++){const roles=CONNECT_ROLES.filter((_,i)=>bits&(1<<i));assert.deepEqual(connectItemsForRoles(roles),ctx.cnItemsForRoles(roles));}
});
test('역할·항목·태그 OR와 조건 간 AND, 기간 지남·숨은 경력·부서·지역 검색을 유지한다',()=>{
 const cards=[{...emptyConnectCard('교사A'),memberId:'a',dept:'청년회',region:'01지역',roles:['교사','상담1'],langs:['영어'],career:'이전 경력',schedType:'등록',expired:true},{...emptyConnectCard('교사B'),memberId:'b',dept:'부녀회',region:'1지역',roles:['협력교사','동아리'],langs:['중국어'],schedType:'등록',expired:false}];
 assert.equal(filterCards(cards,{...emptyCardFilter(),roles:['교사','협력교사'],items:['상담1','동아리'],tags:['영어','중국어']}).length,2);
 assert.equal(filterCards(cards,{...emptyCardFilter(),roles:['교사'],items:['동아리']}).length,0);
 for(const [key,value,id]of [['keyword','이전 경력','a'],['dept','부','b'],['region','1지역','b'],['schedule','등록','b']])assert.deepEqual(filterCards(cards,{...emptyCardFilter(),[key]:value}).map(c=>c.memberId),[id]);
 const help={name:'교사',oneLiner:'요청',desc:'설명',target:'상황',need:'동행',type:'협력교사 · 동아리',region:'01지역'};assert.equal(filterHelps([help],{role:'협력교사',item:'동아리',region:'01지역',keyword:' 동행 '}).length,1);assert.equal(filterHelps([help],{role:'',item:'',region:'1지역',keyword:''}).length,0);
 assert.deepEqual(splitIntroduction('  한 줄  \n\n 자세한 내용\n'),{oneLiner:'한 줄',intro:'자세한 내용\n'});assert.equal(chatKey(' b ',' a '),'a__b');
});
function harness(request){let visible=true,state=null,queue=new Map(),next=0;const calls=[];const chat=createPrivateChat({request:async(a,b)=>{calls.push([a,b]);return request(a,b);},chatId:'a__b',memberId:'a',onChange:s=>state=s,visible:()=>visible,schedule:(fn,ms)=>{queue.set(++next,{fn,ms});return next;},cancel:id=>queue.delete(id)});return {chat,calls,get state(){return state;},get queue(){return [...queue.values()];},hide(){visible=false;chat.visibility();},show(){visible=true;chat.visibility();},async next(){const [id,t]=queue.entries().next().value;queue.delete(id);await t.fn();await tick();}};}
const row=(id,extra={})=>({id,toId:'a',fromId:'b',message:'가짜',read:false,...extra});
test('개인 대화 ID 증분·이전 페이지를 합치고 읽음 실패는 다음 조회에서 재시도한다',async()=>{
 let n=0,ack=0;const h=harness(async(a,b)=>{if(a==='markRead'){if(++ack===1)throw Error('일시 실패');return{ok:true};}if(b.beforeId)return{rows:[row(1)],hasMore:false,nextCursor:1};return ++n===1?{rows:[row(50)],hasMore:true,nextCursor:50}:{rows:[],hasMore:false,nextCursor:50};});
 h.chat.start();await tick();assert.deepEqual(h.state.rows.map(r=>r.id),[50]);assert.equal(h.state.hasOlder,true);await h.next();assert.equal(ack,2);assert.deepEqual(h.calls.filter(([a])=>a==='markRead').map(([,b])=>b.throughId),[50,50]);await h.chat.older();assert.deepEqual(h.state.rows.map(r=>r.id),[1,50]);assert.equal(h.state.hasOlder,false);assert.equal(h.calls.find(([,b])=>b.afterId)?.[1].afterId,50);h.chat.dispose();
});
test('보이지 않는 대화·종료 후 늦은 응답은 표시·읽음·재조회하지 않는다',async()=>{
 let release;const h=harness(()=>new Promise(r=>release=r));h.chat.start();h.hide();release({rows:[row(1)],nextCursor:1});await tick();assert.equal(h.state,null);assert.equal(h.queue.length,0);h.show();await tick();h.chat.dispose();release({rows:[row(2)],nextCursor:2});await tick();assert.equal(h.state,null);assert.equal(h.queue.length,0);assert.equal(h.calls.length,2);
});
test('빈 대화도 afterId 0부터 이어 읽고 유휴 간격은 10·20·30초로 늘어난다',async()=>{
 const h=harness(async()=>({rows:[],hasMore:false,nextCursor:0}));h.chat.start();await tick();assert.equal(h.queue[0].ms,10000);await h.next();assert.equal(h.calls[1][1].afterId,0);assert.equal(h.queue[0].ms,20000);await h.next();assert.equal(h.queue[0].ms,30000);h.hide();assert.equal(h.queue.length,0);h.chat.dispose();
});
test('개인 대화 중복 새로고침은 겹친 조회 없이 이어지고 ID 중복을 제거한다',async()=>{
 let release,count=0,inflight=0,max=0;const h=harness(async a=>{if(a==='markRead')return{ok:true};inflight++;max=Math.max(max,inflight);if(++count===1)await new Promise(r=>release=r);inflight--;return{rows:[row(4,{read:true})],hasMore:false,nextCursor:4};});h.chat.start();const p=h.chat.refresh();release();await p;await tick();assert.equal(max,1);assert.equal(count,2);assert.equal(h.state.rows.length,1);h.chat.dispose();
});
