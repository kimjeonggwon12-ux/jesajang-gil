import {calendarDate,dateObject,eventPrefix,type CalendarEvent} from './calendar.ts';
export type Device={ios:boolean;android:boolean;inApp:boolean;installed:boolean};
export function deviceInfo(ua:string,platform:string,touchPoints:number,standalone:boolean):Device{return{ios:/iPad|iPhone|iPod/.test(ua)||(platform==='MacIntel'&&touchPoints>1),android:/Android/i.test(ua),inApp:/KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\//i.test(ua),installed:standalone};}
export function installSteps(d:Device):string[]{
 if(d.installed)return ['홈 화면에 설치한 교사광장으로 열려 있어요.','다른 휴대폰에서는 아래 설치용 QR로 교사광장을 열어 주세요.'];
 if(d.inApp)return ['현재 앱의 공유 또는 메뉴에서 다른 브라우저로 열기를 선택해 주세요.',d.ios?'Safari에서 교사광장을 다시 열고 홈 화면에 추가해 주세요.':'Chrome에서 교사광장을 다시 열고 앱 설치를 선택해 주세요.'];
 if(d.ios)return ['Safari의 공유 메뉴를 열어 주세요.','홈 화면에 추가를 선택하고 추가를 눌러 주세요.','홈 화면에 생긴 교사광장 아이콘으로 들어오세요.'];
 if(d.android)return ['Chrome 메뉴(⋮)에서 홈 화면에 추가 또는 앱 설치를 선택해 주세요.','설치를 마치면 홈 화면의 교사광장 아이콘으로 들어오세요.'];
 return ['브라우저 주소창의 설치 아이콘 또는 메뉴에서 앱 설치를 선택해 주세요.','설치 메뉴가 없다면 현재 브라우저에서 그대로 이용할 수 있어요.'];
}
export function installAddress(location:string){const u=new URL(location);if(!['https:','http:'].includes(u.protocol))throw Error('설치 주소를 확인하지 못했어요.');return u.origin+'/';}
export type Reminder={key:string;fireAt:number;title:string;body:string;url:string};
// 원본: 오늘부터 토요일까지 시작하는 내 범위 일정, 시작일 전날 기기 시각 09:00. 반복 회차 확장은 하지 않는다.
export function calendarReminders(rows:CalendarEvent[],now:number,dept:string,memberId:string):Reminder[]{
 const today=calendarDate(new Date(now)),sat=dateObject(today);sat.setDate(sat.getDate()+6-sat.getDay());const end=calendarDate(sat);
 const same=(a:string,b:string)=>a===b||(/^[0-9 -]+$/.test(a)&&/^[0-9 -]+$/.test(b)&&a.replace(/\D/g,'').replace(/^0+/,'')===b.replace(/\D/g,'').replace(/^0+/,''));
 return rows.filter(e=>e.category!=='부서'||e.dept.trim().charAt(0)===dept.trim().charAt(0)||same(e.createdBy,memberId)).filter(e=>e.startDate>=today&&e.startDate<=end).flatMap(e=>{
  const fireAt=new Date(e.startDate+'T09:00:00').getTime()-864e5,delay=fireAt-now;if(!Number.isFinite(delay)||delay<0||delay>7*864e5)return [];
  const prefix=eventPrefix(e,'');return [{key:e.eventId||e.startDate,fireAt,title:'📅 내일 일정 있어요',body:(prefix?prefix+' ':'')+e.title+' · '+(e.place||''),url:'/calendar'+(e.eventId?'?event='+encodeURIComponent(e.eventId):'')}];
 });
}
export const noticePreferenceKey=(id:string)=>'ts_device_notices_v1:'+id;
export type NoticePreferences={calendar:boolean;posts:boolean};
export function noticePreferences(value:string|null):NoticePreferences{try{const v=JSON.parse(value||'null');if(v&&typeof v.calendar==='boolean'&&typeof v.posts==='boolean')return v;}catch{}return{calendar:true,posts:true};}
export function newPostAlerts(counts:{board:number;story:number;etc:number},previous:{board:number;story:number;etc:number},hidden:boolean,path:string,search:string){
 const current=path==='/calendar'?'board':path==='/community'?(new URLSearchParams(search).get('section')==='story'?'story':'etc'):'';
 return (['board','story','etc'] as const).filter(k=>hidden&&k!==current&&counts[k]>previous[k]).map(k=>({title:`🔔 ${{board:'전도부 게시판',story:'사례',etc:'교사 마당'}[k]} 새 글 ${counts[k]}개`,body:'교사광장에서 확인해 보세요.',url:k==='board'?'/calendar':'/community?section='+(k==='story'?'story':'yard'),tag:'pz-new-'+k}));
}
