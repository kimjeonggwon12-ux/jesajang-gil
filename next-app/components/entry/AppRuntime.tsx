'use client';
import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {readApi,SessionExpired} from '../../lib/api';
import {clearSession,loadSession,type Session} from '../../lib/session';
import type {CalendarData} from '../../lib/calendar';
import type {MemberAccess} from '../../lib/contracts';
import {deviceInfo,calendarReminders,newPostAlerts,noticePreferences,noticePreferenceKey,type Device,type NoticePreferences} from '../../lib/device';
import {activeWorker,notificationOwner,syncReminders} from '../../lib/device-worker';
import {useNotices} from '../home/NoticeProvider';
type Permission=NotificationPermission|'unsupported'|'insecure'|'loading';
type InstallEvent=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:string}>};
type DeviceContext={device:Device;permission:Permission;canInstall:boolean;installBusy:boolean;message:string;workerError:string;owner:Session|null;preferences:NoticePreferences;setPreference:(key:keyof NoticePreferences,value:boolean)=>void;install:()=>Promise<void>;allow:()=>Promise<void>;refresh:()=>void;reminderCount:number|null;reminderError:string;reminderBusy:boolean;acceptCalendar:(token:string,data:CalendarData)=>void};
const Context=createContext<DeviceContext|null>(null);
export function useDevice(){const context=useContext(Context);if(!context)throw Error('기기 설정 제공자가 필요합니다.');return context;}
export function useCalendarForReminders(token:string,data:CalendarData|null){const {acceptCalendar}=useDevice();useEffect(()=>{if(data)acceptCalendar(token,data);},[token,data,acceptCalendar]);}
export default function AppRuntime({children}:{children:ReactNode}){
 const notices=useNotices(),[owner,setOwner]=useState<Session|null>(null),[device,setDevice]=useState<Device>({ios:false,android:false,inApp:false,installed:false}),[permission,setPermission]=useState<Permission>('loading'),[preferences,setPreferences]=useState<NoticePreferences>({calendar:true,posts:true});
 const [canInstall,setCanInstall]=useState(false),[installBusy,setInstallBusy]=useState(false),[message,setMessage]=useState(''),[workerError,setWorkerError]=useState(''),[workerEpoch,setWorkerEpoch]=useState(0),[reminderCount,setReminderCount]=useState<number|null>(null),[reminderError,setReminderError]=useState(''),[reminderBusy,setReminderBusy]=useState(false);
 const installEvent=useRef<InstallEvent|null>(null),installLock=useRef(false),permissionLock=useRef(false),refreshRef=useRef<(force?:boolean)=>void>(()=>{}),acceptRef=useRef<(token:string,data:CalendarData)=>void>(()=>{});
 const cache=useRef<{token:string;at:number;data:CalendarData;dept:string}|null>(null),postCounts=useRef({token:'',board:0,story:0,etc:0});
 useEffect(()=>{
  const display=matchMedia('(display-mode: standalone)');
  const inspect=()=>{setDevice(deviceInfo(navigator.userAgent,navigator.platform,navigator.maxTouchPoints,display.matches||(navigator as Navigator&{standalone?:boolean}).standalone===true));setPermission(!isSecureContext?'insecure':!('Notification'in window)||!('serviceWorker'in navigator)?'unsupported':Notification.permission);};
  const capture=(event:Event)=>{const e=event as InstallEvent;if(typeof e.prompt!=='function')return;e.preventDefault();installEvent.current=e;setCanInstall(true);};
  const installed=()=>{installEvent.current=null;setCanInstall(false);setDevice(d=>({...d,installed:true}));setMessage('교사광장 설치를 마쳤어요.');};
  inspect();window.addEventListener('beforeinstallprompt',capture);window.addEventListener('appinstalled',installed);window.addEventListener('focus',inspect);display.addEventListener('change',inspect);
  const visible=()=>{if(!document.hidden)inspect();};document.addEventListener('visibilitychange',visible);
  return()=>{window.removeEventListener('beforeinstallprompt',capture);window.removeEventListener('appinstalled',installed);window.removeEventListener('focus',inspect);display.removeEventListener('change',inspect);document.removeEventListener('visibilitychange',visible);};
 },[]);
 useEffect(()=>{let live=true;if(!('serviceWorker'in navigator))return;const changed=()=>{if(live)setWorkerEpoch(n=>n+1);};navigator.serviceWorker.addEventListener('controllerchange',changed);void navigator.serviceWorker.register('/service-worker.js',{scope:'/',updateViaCache:'none'}).then(()=>navigator.serviceWorker.ready).then(()=>{if(live){setWorkerError('');changed();}}).catch(()=>{if(live)setWorkerError('이 브라우저에서 알림을 준비하지 못했어요. 페이지를 새로 열어 주세요.');});return()=>{live=false;navigator.serviceWorker.removeEventListener('controllerchange',changed);};},[]);
 useEffect(()=>{const sync=()=>{const current=loadSession();setOwner(old=>old?.token===current?.token?old:current);let prefs={calendar:true,posts:true};try{if(current)prefs=noticePreferences(localStorage.getItem(noticePreferenceKey(current.account.memberId)));}catch{}setPreferences(old=>old.calendar===prefs.calendar&&old.posts===prefs.posts?old:prefs);};sync();window.addEventListener('storage',sync);window.addEventListener('ts-session-change',sync);return()=>{window.removeEventListener('storage',sync);window.removeEventListener('ts-session-change',sync);};},[]);
 useEffect(()=>{
  let live=true,running=false,last=0,generation=0;const token=owner?.token||'',valid=()=>live&&(loadSession()?.token||'')===token;
  setReminderCount(null);setReminderError('');setReminderBusy(false);if(cache.current?.token!==token)cache.current=null;
  const clear=workerEpoch?syncReminders('',[],valid).catch(()=>{if(valid())setReminderError('이전 알림의 취소 결과를 확인하지 못했어요. 페이지를 새로 열어 주세요.');return false;}):Promise.resolve(null);
  refreshRef.current=()=>{};acceptRef.current=()=>{};
  if(!owner||owner.account.guest||token.startsWith('g')||permission!=='granted'||!preferences.calendar||!workerEpoch)return()=>{live=false;};
  const apply=async(data:CalendarData,dept:string)=>{const request=++generation;if(await clear===false)throw Error('cancel');const key=await notificationOwner(token);if(!valid()||request!==generation)return;const count=await syncReminders(key,calendarReminders(data.rows,Date.now(),dept,owner.account.memberId),()=>valid()&&request===generation);if(valid()&&request===generation&&count!==null){setReminderCount(count);setReminderError('');}};
  const refresh=async(force=false)=>{
   if(!valid()||running||document.hidden||(!force&&Date.now()-last<5*60e3))return;running=true;last=Date.now();setReminderBusy(true);setReminderError('');
   try{let stored=cache.current;if(force||!stored||Date.now()-stored.at>=5*60e3){const [data,access]=await Promise.all([readApi<CalendarData>('getCalendarEvents',token),readApi<MemberAccess>('checkAdmin',token)]);for(const response of [data,access])if(response.error)throw Error(response.error);if(!valid())return;stored={token,at:Date.now(),data,dept:access.roster?.dept||access.dept||''};cache.current=stored;}await apply(stored.data,stored.dept);}
   catch(error){if(valid()){setReminderCount(null);if(error instanceof SessionExpired)clearSession();else setReminderError('일정 알림을 준비하지 못했어요. 다시 확인해 주세요.');await syncReminders('',[],valid).catch(()=>{});}}
   finally{running=false;if(valid())setReminderBusy(false);}
  };
  refreshRef.current=refresh;acceptRef.current=(inputToken,data)=>{if(inputToken!==token||!valid()||!cache.current)return;cache.current={...cache.current,data,at:Date.now()};void apply(data,cache.current.dept).catch(()=>{if(valid())setReminderError('바뀐 일정 알림을 준비하지 못했어요. 다시 확인해 주세요.');});};
  void refresh();const visible=()=>{if(!document.hidden)void refresh();};document.addEventListener('visibilitychange',visible);const timer=setInterval(visible,5*60e3);
  return()=>{live=false;clearInterval(timer);document.removeEventListener('visibilitychange',visible);refreshRef.current=()=>{};acceptRef.current=()=>{};};
 },[owner?.token,permission,preferences.calendar,workerEpoch]);
 useEffect(()=>{
  const c=notices.counts,token=owner?.token||'';if(!c||!token||!owner||owner.account.guest)return;
  const previous=postCounts.current.token===token?postCounts.current:{token,board:0,story:0,etc:0};postCounts.current={token,board:c.board,story:c.story,etc:c.etc};
  if(permission!=='granted'||!preferences.posts)return;const alerts=newPostAlerts(c,previous,document.hidden,location.pathname,location.search);
  if(!alerts.length)return;let live=true;void activeWorker().then(async r=>{for(const alert of alerts){if(!live||loadSession()?.token!==token||!document.hidden)return;await r.showNotification(alert.title,{body:alert.body,tag:alert.tag,icon:'/assets/optimized/icon-192.png',data:{url:alert.url}});}}).catch(()=>{});return()=>{live=false;};
 },[owner?.token,notices.data?.at,notices.counts?.board,notices.counts?.story,notices.counts?.etc,permission,preferences.posts]);
 const acceptCalendar=useCallback((token:string,data:CalendarData)=>acceptRef.current(token,data),[]);
 const setPreference=(key:keyof NoticePreferences,value:boolean)=>{if(!owner)return;const next={...preferences,[key]:value};try{localStorage.setItem(noticePreferenceKey(owner.account.memberId),JSON.stringify(next));setPreferences(next);setMessage('이 기기의 알림 설정을 저장했어요.');}catch{setMessage('기기에 설정을 저장하지 못했어요. 브라우저 저장 공간을 확인해 주세요.');}};
 async function install(){const event=installEvent.current;if(!event||installLock.current)return;installLock.current=true;setInstallBusy(true);setMessage('');try{await event.prompt();const choice=await event.userChoice;setMessage(choice.outcome==='accepted'?'설치 요청을 보냈어요. 홈 화면에서 교사광장을 확인해 주세요.':'설치를 취소했어요. 안내에 따라 나중에 추가할 수 있어요.');}catch{setMessage('설치 창을 열지 못했어요. 아래 안내에 따라 추가해 주세요.');}finally{installEvent.current=null;installLock.current=false;setCanInstall(false);setInstallBusy(false);}}
 async function allow(){if(permission!=='default'||permissionLock.current)return;permissionLock.current=true;try{const result=await Notification.requestPermission();setPermission(result);setMessage(result==='granted'?'이 브라우저에서 알림을 허용했어요.':'알림을 허용하지 않았어요. 브라우저 설정에서 변경할 수 있어요.');}catch{setMessage('알림 권한을 확인하지 못했어요. 브라우저 설정을 확인해 주세요.');}finally{permissionLock.current=false;}}
 const value:DeviceContext={device,permission,canInstall,installBusy,message,workerError,owner,preferences,setPreference,install,allow,refresh:()=>refreshRef.current(true),reminderCount,reminderError,reminderBusy,acceptCalendar};
 return <Context.Provider value={value}>{children}</Context.Provider>;
}
