import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../next-app/worker/service-worker.js',import.meta.url),'utf8');
const origin='http://127.0.0.1:58434';
function setup(){
 const events={},saved=[],deleted=[],notices=[],opened=[],navigated=[],timers=[];let offline=false,claimed=0,focused=0;
 const self={location:{origin},addEventListener:(type,fn)=>(events[type]??=[]).push(fn),skipWaiting(){},clients:{claim:async()=>{claimed++;},matchAll:async()=>[{url:origin+'/activities',focus:async()=>{focused++;},navigate:async path=>navigated.push(path)}],openWindow:async path=>opened.push(path)},registration:{showNotification:async(title,options)=>{const n={title,...options,closed:false,close(){this.closed=true;}};notices.push(n);},getNotifications:async()=>notices}};
 const caches={open:async()=>({addAll:async list=>saved.push(...list)}),keys:async()=>['kko-teacher-v3','kko-teacher-next-v2','unrelated-app'],delete:async key=>deleted.push(key),match:async path=>(typeof path==='string'?path:new URL(path.url).pathname)==='/offline.html'?new Response('연결 안내'):undefined};
 vm.runInNewContext(source,{self,caches,URL,Response,setTimeout:(fn,delay)=>{const timer={fn,delay,cancelled:false};timers.push(timer);return timer;},clearTimeout:timer=>{timer.cancelled=true;},fetch:async()=>{if(offline)throw Error('offline');return new Response('LIVE');}});
 async function dispatch(type,event={}){const pending=[];for(const fn of events[type]||[])fn({...event,waitUntil:promise=>pending.push(promise)});await Promise.all(pending);}
 async function request(path,{method='GET',mode='navigate',headers={}}={}){let promise;events.fetch[0]({request:{url:new URL(path,origin).href,method,mode,headers:new Headers(headers)},respondWith:value=>promise=value});return promise?await promise:null;}
 return{dispatch,request,saved,deleted,notices,opened,navigated,timers,self,setOffline:value=>offline=value,counts:()=>({claimed,focused})};
}
test('워커 설치·교체는 공개 안내/아이콘만 저장하고 다른 앱 캐시를 보존한다',async()=>{
 const w=setup();await w.dispatch('install');assert.deepEqual(w.saved,['/offline.html','/assets/optimized/icon-192.png','/assets/optimized/icon-512.png']);await w.dispatch('activate');assert.deepEqual(w.deleted,['kko-teacher-v3']);assert.equal(w.counts().claimed,1);
});
test('오프라인 문서만 안내 화면으로 대체하고 API·RSC·외부·쓰기에는 개입하지 않는다',async()=>{
 const w=setup();assert.equal(await(await w.request('/members')).text(),'LIVE');assert.deepEqual(w.saved,[]);w.setOffline(true);assert.equal(await(await w.request('/app.html')).text(),'연결 안내');
 for(const [path,options]of [['/api',{}],['/api/tg',{}],['/members?_rsc=abc',{}],['/members',{headers:{RSC:'1'}}],['https://example.invalid/image.png',{}],['/members',{method:'POST'}],['/_next/static/a.js',{mode:'cors'}]])assert.equal(await w.request(path,options),null,path);
});
test('기존 푸시 계약은 같은 출처의 화면만 열고 외부·API·잘못된 목적지는 홈으로 제한한다',async()=>{
 const w=setup();for(const url of ['/app.html#attend=MT140001','https://example.invalid/path','/api?action=write','javascript:alert(1)']){
  await w.dispatch('push',{data:{json:()=>({title:'가짜 알림',body:'내용',url})}});const item=w.notices.at(-1);assert.equal(item.data.url,url.startsWith('/app.html')?url:'/');assert.equal(item.icon,'/assets/optimized/icon-192.png');
  let closed=0;await w.dispatch('notificationclick',{notification:{data:item.data,close:()=>closed++}});assert.equal(closed,1);assert.equal(w.navigated.at(-1),item.data.url);
 }
 assert.equal(w.counts().focused,4);assert.deepEqual(w.opened,[]);
 w.self.clients.matchAll=async()=>[];await w.dispatch('notificationclick',{notification:{data:{url:'/rooms?code=READTEST'},close(){}}});assert.deepEqual(w.opened,['/rooms?code=READTEST']);
});
test('기존 예약 메시지는 음수·무한 지연을 거절하고 유효한 요청만 알림으로 만든다',async()=>{
 const w=setup();for(const delayMs of [-1,Infinity,2147483648,'bad'])await w.dispatch('message',{data:{type:'SCHEDULE_NOTIFICATION',delayMs}});assert.equal(w.timers.length,0);
 await w.dispatch('message',{data:{type:'SCHEDULE_NOTIFICATION',delayMs:100,title:'가짜 예약',url:'/calendar'}});assert.equal(w.timers.length,1);assert.equal(w.timers[0].delay,100);await w.timers[0].fn();await Promise.resolve();assert.equal(w.notices[0].data.url,'/calendar');assert.equal(w.notices[0].tag,'scheduled');
});
const ownerA='a'.repeat(64),ownerB='b'.repeat(64);
const reminder=(key='E1')=>({key,fireAt:Date.now()+60000,title:'내일 일정',body:'가짜 일정 · 가짜 장소',url:'/calendar?event='+key});
async function sync(w,owner,rows){let answer;await w.dispatch('message',{data:{type:'SYNC_CALENDAR_REMINDERS',owner,rows},ports:[{postMessage:v=>answer=JSON.parse(JSON.stringify(v))}]});return answer;}
test('같은 일정 재조회는 예약을 늘리지 않고 시간 변경·삭제를 기존 예약에 반영한다',async()=>{
 const w=setup(),row=reminder();assert.deepEqual(await sync(w,ownerA,[row]),{ok:true,count:1});await sync(w,ownerA,[row]);assert.equal(w.timers.length,1);
 await sync(w,ownerA,[{...row,fireAt:row.fireAt+1000}]);assert.equal(w.timers.length,2);assert.equal(w.timers[0].cancelled,true);
 assert.deepEqual(await sync(w,ownerA,[]),{ok:true,count:0});assert.equal(w.timers[1].cancelled,true);await w.timers[0].fn();assert.equal(w.notices.length,0);
});
test('계정 변경·로그아웃은 이전 예약과 이미 표시한 해당 계정 일정 알림만 정리한다',async()=>{
 const w=setup();await sync(w,ownerA,[reminder()]);await w.timers[0].fn();assert.equal(w.notices.length,1);
 await w.dispatch('push',{data:{json:()=>({title:'별도 알림',tag:'unrelated'})}});
 await sync(w,ownerB,[reminder('E2')]);assert.equal(w.notices[0].closed,true);assert.equal(w.notices[1].closed,false);
 await sync(w,'',[]);await w.timers[1].fn();assert.equal(w.notices.length,2);assert.equal(w.timers[1].cancelled,true);
});
test('예약 형식·기간·알림 목적지 검증은 잘못된 입력으로 기존 예약을 덮어쓰지 않는다',async()=>{
 const w=setup(),row=reminder();await sync(w,ownerA,[row]);assert.deepEqual(await sync(w,'raw-session-token',[]),{ok:false});assert.equal(w.timers[0].cancelled,false);
 const result=await sync(w,ownerA,[row,{...row,key:'past',fireAt:Date.now()-1},{...row,key:'far',fireAt:Date.now()+8*864e5},{...row,key:'bad',fireAt:NaN},{...row,key:'external',url:'https://example.invalid/path'}]);assert.equal(result.count,2);await w.timers.at(-1).fn();assert.equal(w.notices[0].data.url,'/');
});
test('표시 중 계정이 바뀌어도 늦게 완료된 이전 일정 알림을 남기지 않는다',async()=>{
 const w=setup();let release;const gate=new Promise(resolve=>release=resolve),show=w.self.registration.showNotification;w.self.registration.showNotification=async(...args)=>{await gate;await show(...args);};
 await sync(w,ownerA,[reminder()]);const running=w.timers[0].fn();await sync(w,'',[]);release();await running;assert.equal(w.notices.length,1);assert.equal(w.notices[0].closed,true);
});
