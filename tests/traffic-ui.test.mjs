import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const start=html.indexOf('    const chatVisible ='),end=html.indexOf('    // 2026-09-22: App.pendingChat',start);
function harness(answer) {
  let now=0,seq=0;const timers=new Map(),calls=[],listeners={};
  const context={S:{tab:'chat',chat:{active:{memberId:'2'},generation:1,messages:[],input:'',cursor:0,loaded:false,hasOlder:false,idle:0,pendingRead:0}},App:{currentTab:'connect'},MEMBER_ID:'1',MY_NAME:'가짜',window:{},
    document:{hidden:false,getElementById:()=>null,addEventListener:(name,fn)=>listeners[name]=fn,body:{classList:{remove(){}}}},
    setTimeout:(fn,ms)=>{timers.set(++seq,{fn,at:now+ms});return seq;},clearTimeout:id=>timers.delete(id),
    callApi:async body=>{calls.push(body);return answer(body,calls);},updateChatLog(){},cnRender(){},cnSwitchTab(){},toast(){},confirm:()=>true};
  vm.createContext(context);vm.runInContext(html.slice(start,end),context);
  return {context,calls,timers,listeners,async advance(ms){const until=now+ms;for(;;){const item=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!item||item[1].at>until)break;now=item[1].at;timers.delete(item[0]);await item[1].fn();}now=until;}};
}
const row=(id,more={})=>({id,fromId:'2',toId:'1',message:'가짜',read:false,...more});
test('1분 유휴 대화는 최초 포함 조회 4회·읽음 1회, 숨김·다른 메뉴에서는 0회다',async()=>{
  const h=harness(body=>body.action==='markRead'?{ok:true}:body.afterId==null?{rows:[row(1)],nextCursor:1}:{rows:[],nextCursor:1});
  h.context.enterChatRoom();await h.context.S.chat.inFlight;await h.advance(60000);
  assert.equal(h.calls.filter(x=>x.action==='getMessages').length,4);assert.equal(h.calls.filter(x=>x.action==='markRead').length,1);
  h.context.document.hidden=true;h.listeners.visibilitychange();const n=h.calls.length;await h.advance(60000);assert.equal(h.calls.length,n);
  h.context.document.hidden=false;h.listeners.visibilitychange();await h.context.S.chat.inFlight;assert.equal(h.calls.length,n+1);
  h.context.App.currentTab='activity';h.context.window.cnChatVisibility();const m=h.calls.length;await h.advance(60000);assert.equal(h.calls.length,m);
});
test('요청 중 폴링이 겹치지 않고 방 전환 뒤 늦은 응답이 새 대화에 섞이지 않는다',async()=>{
  let resolve;const h=harness(()=>new Promise(r=>resolve=r));
  const first=h.context.fetchMessages(false),second=h.context.fetchMessages(false);assert.equal(h.calls.length,1);
  h.context.S.chat.generation++;h.context.S.chat.active={memberId:'3'};h.context.S.chat.inFlight=null;
  resolve({rows:[row(1)],nextCursor:1});await Promise.all([first,second]);assert.equal(h.context.S.chat.messages.length,0);assert.equal(h.timers.size,0);
});
test('빈 방에서 한 페이지 넘게 도착한 새 메시지를 0번 커서부터 이어서 받고 중복을 합친다',async()=>{
  let stage=0;const h=harness(body=>body.action==='markRead'?{ok:true}:stage++===0?{rows:[],nextCursor:0}:stage===2?{rows:[row(1)],nextCursor:1,hasMore:true}:{rows:[row(1),row(2)],nextCursor:2});
  await h.context.fetchMessages(false);await h.advance(10100);
  assert.equal(h.calls.filter(x=>x.action==='getMessages')[1].afterId,0);
  assert.deepEqual(Array.from(h.context.S.chat.messages,m=>m.id),[1,2]);
});
test('읽음 요청 실패를 다음 조회에서 재시도하고 성공 후에는 반복하지 않는다',async()=>{
  let ack=0;const h=harness(body=>body.action==='markRead'?(++ack===1?Promise.reject(Error('가짜 장애')):{ok:true}):body.afterId==null?{rows:[row(1)],nextCursor:1}:{rows:[],nextCursor:1});
  await h.context.fetchMessages(false);await h.advance(60000);assert.equal(ack,2);assert.equal(h.context.S.chat.pendingRead,0);
});
test('느린 전송 중 방을 바꾸면 실패한 글이 새 대화의 입력창에 복구되지 않는다',async()=>{
  let reject;const h=harness(()=>new Promise((_,r)=>reject=r));h.context.S.chat.input='옛 방의 가짜 글';
  const sending=h.context.sendChat();h.context.S.chat.generation++;h.context.S.chat.input='새 방의 글';
  reject(Error('가짜 실패'));await sending;assert.equal(h.context.S.chat.input,'새 방의 글');
});
test('HEARTS의 빈 목록은 한 번만 조회하고 실패는 수동 재시도할 수 있다',async()=>{
  const a=html.indexOf('    let aiTargetsLoading ='),b=html.indexOf('    async function scLoadPerson',a);
  let calls=0,fail=false;const c={home:{targets:[],targetsLoaded:false},aiState:{memberId:'1',tab:'studentCoach'},window:{},aiRender(){},callApi:async()=>{calls++;if(fail)throw Error('가짜 장애');return {rows:[]};}};
  vm.createContext(c);vm.runInContext(html.slice(a,b),c);
  c.aiMyTargets();await new Promise(r=>setImmediate(r));for(let i=0;i<10;i++)c.aiMyTargets();assert.equal(calls,1);
  c.home.targetsLoaded=false;fail=true;c.window.aiRetryTargets();c.aiMyTargets();await new Promise(r=>setImmediate(r));for(let i=0;i<10;i++)c.aiMyTargets();assert.equal(calls,2);
  fail=false;c.window.aiRetryTargets();c.aiMyTargets();await new Promise(r=>setImmediate(r));assert.equal(calls,3);assert.equal(c.home.targetsLoaded,true);
});
test('미리 받은 목록을 동시에 두 곳에서 사용해도 네트워크 요청은 하나다',async()=>{
  const a=html.indexOf('    const API_READ ='),b=html.indexOf('    /** 첫 화면',a);let resolve,count=0;
  const c={App:{},pdTokenNow:()=> 'fake-session',setTimeout:()=>0,callApiOnce:async()=>{count++;return new Promise(r=>resolve=r);}};
  vm.createContext(c);vm.runInContext(html.slice(a,b),c);
  const body={action:'getMyTargets',memberId:'1'};c.warmUp([body]);const one=c.callApi(body),two=c.callApi(body);assert.equal(count,1);resolve({rows:[]});await Promise.all([one,two]);
});
