import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {calendarReminders,deviceInfo,installSteps,installAddress,noticePreferences,noticePreferenceKey,newPostAlerts} from '../next-app/lib/device.ts';
import {calendarDate,eventPrefix} from '../next-app/lib/calendar.ts';
import {notificationOwner,syncReminders} from '../next-app/lib/device-worker.ts';
test('설치 안내는 iPad·앱 내부·Android·설치된 창을 구분한다',()=>{
 const cases=[['iPhone KAKAOTALK','',0,false,{ios:true,inApp:true}],['','MacIntel',5,false,{ios:true,inApp:false}],['Android','',0,false,{android:true}],['Firefox','',0,true,{installed:true}]];
 for(const [ua,platform,touch,standalone,expected]of cases){const d=deviceInfo(ua,platform,touch,standalone);for(const [k,v]of Object.entries(expected))assert.equal(d[k],v);assert.ok(installSteps(d).length>=2);}
 assert.match(installSteps(deviceInfo('iPhone','',0,false)).join(' '),/Safari/);assert.match(installSteps(deviceInfo('Android','',0,false)).join(' '),/Chrome/);
});
test('설치 QR 주소는 현재 출처 첫 화면만 담고 이름·번호·초대·로그인 힌트를 제외한다',()=>{
 assert.equal(installAddress('https://example.invalid/app.html?name=private&memberId=12345678#carry=secret'),'https://example.invalid/');assert.equal(installAddress('http://127.0.0.1:58434/device#install'),'http://127.0.0.1:58434/');assert.throws(()=>installAddress('javascript:alert(1)'));
});
test('일정 알림의 내 부서/작성자·토요일·기기 09시·과거/7일 범위는 원본 실행 코드와 같다',()=>{
 const html=readFileSync(new URL('../app.html',import.meta.url),'utf8'),start=html.indexOf('const pushNoti = {'),end=html.indexOf('    pushNoti.init();',start),rows=[];
 for(let n=1;n<=30;n++)for(const [category,dept,createdBy]of [['공식','','x'],['부서','청','x'],['부서','부','x'],['부서','부','0099-000'],['내일정','','99000']])rows.push({eventId:'E'+rows.length,title:'가짜 일정',place:'가짜 장소',category,dept,createdBy,region:'01지역',startDate:'2026-11-'+String(n).padStart(2,'0'),endDate:'2026-11-'+String(n).padStart(2,'0'),repeatDays:[1,3],repeatUntil:'2026-12-01'});
 for(let day=1;day<=28;day++)for(const hour of [8,9,10]){const now=new Date(2026,10,day,hour).getTime(),today=calendarDate(new Date(now)),sent=[],ctx={Date:class extends Date{static now(){return now;}},Notification:{permission:'granted'},navigator:{},calSt:{events:rows},calForMe:e=>e.category!=='부서'||e.dept==='청'||e.createdBy==='0099-000',CAL_TODAY:today,calTodayDate:new Date(now),calYmd:(y,m,d)=>calendarDate(new Date(y,m,d)),esc:s=>s,calTitleWithPrefix:e=>[eventPrefix(e,''),e.title].filter(Boolean).join(' ')};vm.createContext(ctx);vm.runInContext(html.slice(start,end)+';this.schedule=pushNoti;',ctx);ctx.schedule.sw={active:{postMessage:v=>sent.push(v)}};ctx.schedule.scheduleWeekEvents();const actual=calendarReminders(rows,now,'청년회','99000');assert.deepEqual(actual.map(x=>[x.key,x.fireAt-now,x.title,x.body]),sent.map(x=>[x.tag.slice(3),x.delayMs,x.title,x.body]));}
 const now=new Date(2026,10,1).getTime();assert.deepEqual(calendarReminders([{...rows[0],startDate:'bad'}],now,'청','99000'),[]);
});
test('새 글은 증가한 숨김 화면 알림만 만들고 현재 메뉴와 같은 건수·읽음 감소는 제외한다',()=>{
 const old={board:1,story:2,etc:3},next={board:2,story:3,etc:3};assert.deepEqual(newPostAlerts(next,old,false,'/activities',''),[]);assert.equal(newPostAlerts(next,old,true,'/activities','').length,2);assert.equal(newPostAlerts(next,old,true,'/calendar','')[0].tag,'pz-new-story');assert.equal(newPostAlerts(next,old,true,'/community','?section=story')[0].tag,'pz-new-board');assert.deepEqual(newPostAlerts(old,next,true,'/activities',''),[]);
});
test('기기 알림 선택은 계정별로 분리하고 손상된 설정은 기존 허용 후 기본값을 사용한다',()=>{
 assert.notEqual(noticePreferenceKey('A'),noticePreferenceKey('B'));for(const value of [null,'{','{}','{"calendar":"false","posts":true}'])assert.deepEqual(noticePreferences(value),{calendar:true,posts:true});assert.deepEqual(noticePreferences('{"calendar":false,"posts":true}'),{calendar:false,posts:true});
});
test('워커 계정 구분값은 토큰 원문을 드러내지 않고 세션이 다르면 달라진다',async()=>{
 const a=await notificationOwner('fake-session-A'),b=await notificationOwner('fake-session-B');assert.match(a,/^[a-f0-9]{64}$/);assert.notEqual(a,b);assert.equal(a,await notificationOwner('fake-session-A'));assert.equal(a.includes('session'),false);
});
test('워커 준비/계정 재확인·응답 확인을 마쳐야 예약 건수를 반환한다',async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator'),sent=[];
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{serviceWorker:{getRegistration:async()=>({active:{postMessage:(data,ports)=>{sent.push(data);ports[0].postMessage({ok:true,count:2});ports[0].close();}}})}}});
 try{assert.equal(await syncReminders('a'.repeat(64),[],()=>false),null);assert.equal(sent.length,0);assert.equal(await syncReminders('a'.repeat(64),[],()=>true),2);assert.equal(sent.length,1);navigator.serviceWorker.getRegistration=async()=>undefined;await assert.rejects(syncReminders('',[],()=>true),/알림 준비/);}finally{if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else delete globalThis.navigator;}
});
