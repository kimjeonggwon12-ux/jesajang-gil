// Next 후보 전용. 개인 HTML/API/RSC는 저장하지 않고 오프라인 안내·아이콘만 보관한다.
const CACHE_NAME='kko-teacher-next-v2';
const OFFLINE='/offline.html';
const STATIC=[OFFLINE,'/assets/optimized/icon-192.png','/assets/optimized/icon-512.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(STATIC)));self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(k=>k.startsWith('kko-teacher-')&&k!==CACHE_NAME).map(k=>caches.delete(k)));await self.clients.claim();})());});
self.addEventListener('fetch',event=>{
 const r=event.request,u=new URL(r.url);
 if(r.method!=='GET'||u.origin!==self.location.origin||u.pathname==='/api'||u.pathname.startsWith('/api/')||r.headers.has('RSC')||u.searchParams.has('_rsc'))return;
 if(r.mode==='navigate'){event.respondWith(fetch(r).catch(async()=>await caches.match(OFFLINE)||new Response('인터넷 연결을 확인해 주세요.',{status:503,headers:{'content-type':'text/plain; charset=utf-8'}})));return;}
 if(STATIC.includes(u.pathname)&&!u.search)event.respondWith(caches.match(r).then(saved=>saved||fetch(r)));
});
function destination(value){try{const u=new URL(typeof value==='string'?value:'/',self.location.origin);return u.origin===self.location.origin&&!u.username&&!u.password&&!u.pathname.startsWith('/api')?u.pathname+u.search+u.hash:'/';}catch{return '/';}}
function show(data){return self.registration.showNotification(String(data.title||'교사광장'),{body:String(data.body||''),icon:'/assets/optimized/icon-192.png',badge:'/assets/optimized/icon-192.png',tag:String(data.tag||'teacher-push'),data:{url:destination(data.url)},vibrate:[100,50,100]});}
self.addEventListener('push',event=>{if(!event.data)return;let data;try{data=event.data.json();}catch{data={body:event.data.text()};}event.waitUntil(show(data&&typeof data==='object'?data:{}));});
self.addEventListener('notificationclick',event=>{event.notification.close();const url=destination(event.notification.data?.url);event.waitUntil((async()=>{const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});for(const client of windows){if(new URL(client.url).origin!==self.location.origin||!client.focus)continue;if(client.navigate)await client.navigate(url);await client.focus();return;}return self.clients.openWindow(url);})());});
// 새 화면의 일정 예약: 계정 변경/로그아웃/삭제/시간 변경을 반영하며 같은 예약은 중복 생성하지 않는다.
// 메모리 전용이므로 워커 종료 후에는 화면을 다시 열어 예약해야 한다.
let reminderOwner='';
const reminderTasks=new Map();
async function closeCalendarNotifications(prefix){try{for(const n of await self.registration.getNotifications())if(n.tag.startsWith(prefix))n.close();}catch{}}
self.addEventListener('message',event=>{
 if(event.data?.type!=='SYNC_CALENDAR_REMINDERS')return;
 const {owner,rows}=event.data;
 if(typeof owner!=='string'||(owner&&!/^[a-f0-9]{64}$/.test(owner))||!Array.isArray(rows)){event.ports?.[0]?.postMessage({ok:false});return;}
 const previousOwner=reminderOwner;reminderOwner=owner;
 if(previousOwner!==owner){for(const item of reminderTasks.values())clearTimeout(item.timer);reminderTasks.clear();}
 const next=new Map(),now=Date.now();
 if(owner)for(const row of rows){if(typeof row?.key!=='string'||!Number.isFinite(row.fireAt)||row.fireAt<now||row.fireAt-now>7*864e5)continue;next.set(row.key,{...row,url:destination(row.url),title:String(row.title||'교사광장'),body:String(row.body||'')});}
 for(const [key,item]of reminderTasks)if(!next.has(key)||item.fingerprint!==JSON.stringify(next.get(key))){clearTimeout(item.timer);reminderTasks.delete(key);}
 for(const [key,row]of next){if(reminderTasks.has(key))continue;const tag='next-calendar-'+owner+'-'+encodeURIComponent(key),item={fingerprint:JSON.stringify(row),timer:null};
  item.timer=setTimeout(async()=>{if(reminderOwner!==owner||reminderTasks.get(key)!==item)return;reminderTasks.delete(key);try{await show({...row,tag});if(reminderOwner!==owner)await closeCalendarNotifications('next-calendar-'+owner+'-');}catch{}},Math.max(0,row.fireAt-Date.now()));reminderTasks.set(key,item);
 }
 const done=(async()=>{if(previousOwner!==owner&&previousOwner)await closeCalendarNotifications('next-calendar-'+previousOwner+'-');event.ports?.[0]?.postMessage({ok:true,count:reminderTasks.size});})();
 event.waitUntil(done);
});
// 기존 예약 메시지 계약. 브라우저가 워커를 중단하면 타이머도 사라지므로 서버 예약 푸시가 아니다.
self.addEventListener('message',event=>{if(event.data?.type!=='SCHEDULE_NOTIFICATION')return;const delay=Number(event.data.delayMs||0);if(!Number.isFinite(delay)||delay<0||delay>2147483647)return;const data={...event.data,tag:event.data.tag||'scheduled'};setTimeout(()=>{show(data).catch(()=>{});},delay);});
