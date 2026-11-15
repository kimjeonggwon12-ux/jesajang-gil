'use client';
import Link from 'next/link';
import {Suspense,createContext,useCallback,useContext,useEffect,useRef,useState,type FormEvent,type ReactNode} from 'react';
import {callApi,readApi,SessionExpired,type ReadAction} from '../../lib/api';
import {clearSession,loadSession,saveGuestSession,MEMBER_KEY,TOKEN_KEY,type Session} from '../../lib/session';
import {LOGIN_DEPTS} from '../../../shared/login-options.js';
import {cleanRoomCode} from '../../lib/rooms';
import LoginForm from '../LoginForm';
import {ErrorNote,Loading,ExitNotice} from '../Ui';
import Rooms from './Rooms';
import ClassicAdminFrame from '../presentation/ClassicAdminFrame';
import ClassicNavigation from '../presentation/ClassicNavigation';
import {ClassicIdentity} from '../presentation/ClassicIdentity';

type Request=<T>(action:string,body?:Record<string,unknown>)=>Promise<T>;
const Context=createContext<{request:Request;query:Request;session:Session;isAdmin:boolean}|null>(null);
export function useRoomSession(){const value=useContext(Context);if(!value)throw Error('로그인을 확인해 주세요.');return value;}
export function useRoomQuery<T>(action:ReadAction,body:Record<string,unknown>={},enabled=true){
  const {query}=useRoomSession(),params=JSON.stringify(body),[version,setVersion]=useState(0);
  const key=JSON.stringify([action,params,version]),[result,setResult]=useState<{key:string;data:T|null;error:string}>({key:'',data:null,error:''});
  useEffect(()=>{if(!enabled)return;let active=true;query<T>(action,JSON.parse(params)).then(data=>{if(active)setResult({key,data,error:''});}).catch(error=>{if(active)setResult({key,data:null,error:error.message});});return()=>{active=false;};},[action,params,key,enabled,query]);
  return {data:enabled&&result.key===key?result.data:null,error:enabled&&result.key===key?result.error:'',loading:enabled&&result.key!==key,reload:()=>setVersion(v=>v+1)};
}
function SignedIn({session,logout,children}:{session:Session;logout:(message?:string)=>void;children:ReactNode}){
  const [isAdmin,setAdmin]=useState(false),[tier,setTier]=useState<string>();
  const request=useCallback<Request>(async<T,>(action:string,body:Record<string,unknown>={})=>{try{const data=await callApi<T>(action,body,session.token);if(data.error)throw Error(data.error);return data;}catch(error){if(error instanceof SessionExpired&&loadSession()?.token===session.token)logout(error.message);throw error;}},[session.token,logout]);
  const query=useCallback<Request>(async<T,>(action:string,body:Record<string,unknown>={})=>{try{const data=await readApi<T>(action as ReadAction,session.token,body);if(data.error)throw Error(data.error);return data;}catch(error){if(error instanceof SessionExpired&&loadSession()?.token===session.token)logout(error.message);throw error;}},[session.token,logout]);
  useEffect(()=>{if(session.account.guest)return;let active=true;query<{isAdmin:boolean;roster?:{tier?:string}}>('checkAdmin').then(r=>{if(active){setAdmin(r.isAdmin);setTier(r.roster?.tier);}}).catch(()=>{});return()=>{active=false;};},[query,session.account.guest]);
  return <Context.Provider value={{request,query,session,isAdmin}}><ClassicIdentity name={session.account.name} tier={tier} logout={()=>logout()}><div className="classic-ui"><ExitNotice token={session.token}/><a className="skip-link" href="#main-content">본문으로 이동</a>{!session.account.guest?<Suspense fallback={<div className="classic-nav-loading"/>}><ClassicNavigation name={session.account.name} tier={tier} isAdmin={isAdmin} logout={()=>logout()}/></Suspense>:<header className="site-header"><Link href="/rooms" className="brand">✦ 피드백방</Link><nav aria-label="주 메뉴">{!session.account.guest?<><Link href="/menu">전체 메뉴</Link><Link href="/activities">활동 보고</Link></>:<span>{session.account.name}님 · 손님</span>}<button className="text-button" onClick={()=>logout()}>로그아웃</button></nav></header>}<main id="main-content" className="workspace classic-workspace"><Suspense fallback={<Loading/>}><ClassicAdminFrame isAdmin={isAdmin}>{children}</ClassicAdminFrame></Suspense></main></div></ClassicIdentity></Context.Provider>;
}
function GuestEntry({code,onLogin}:{code:string;onLogin:(session:Session,code:string)=>void}){
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),pending=useRef(false),active=useRef(true);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();if(pending.current)return;pending.current=true;const form=new FormData(event.currentTarget);setBusy(true);setError('');try{const data=await callApi<{token?:string;name:string}>('guestLogin',{memberId:form.get('memberId'),name:form.get('name'),dept:form.get('dept'),code:cleanRoomCode(String(form.get('code')||''))});if(data.error||!data.token)throw Error(data.error||'입장 정보를 확인해 주세요.');if(!active.current)return;onLogin(saveGuestSession(data.token,{memberId:'',name:data.name,dept:String(form.get('dept')||'')}),cleanRoomCode(String(form.get('code')||'')));}catch(error){setError((error as Error).message);}finally{pending.current=false;setBusy(false);}}
  return <main className="login-page"><section className="login-card"><h1>초대받은 손님 입장</h1><p>교사명단에 없는 분은 초대받은 방만 이용할 수 있어요.</p><form onSubmit={submit}><label>초대 코드<input name="code" defaultValue={code} required maxLength={9}/></label><label>부서<select name="dept" required><option value="">부서 선택</option>{LOGIN_DEPTS.map(dept=><option key={dept}>{dept}</option>)}</select></label><label>이름<input name="name" maxLength={20} required autoComplete="name"/></label><label>고유번호<input name="memberId" required inputMode="numeric" minLength={8} maxLength={40}/></label><ErrorNote message={error}/><button className="primary" disabled={busy}>{busy?'확인 중…':'손님으로 입장'}</button></form></section></main>;
}
export default function RoomArea(){
  const [ready,setReady]=useState(false),[session,setSession]=useState<Session|null>(null),[guest,setGuest]=useState(false),[message,setMessage]=useState('');
  const [route,setRoute]=useState({target:'',code:''});
  const logout=useCallback((message='')=>{clearSession();setSession(null);setMessage(message);},[]);
  useEffect(()=>{
    const locationChanged=()=>{const params=new URLSearchParams(location.search);setRoute({target:params.get('target')||'',code:cleanRoomCode(params.get('code')||location.hash.match(/^#room=([^&]+)/)?.[1]||'')});};
    const sync=()=>{setSession(loadSession());setReady(true);};const changed=(e:StorageEvent)=>{if([TOKEN_KEY,MEMBER_KEY,null].includes(e.key))sync();};
    locationChanged();sync();window.addEventListener('storage',changed);window.addEventListener('popstate',locationChanged);return()=>{window.removeEventListener('storage',changed);window.removeEventListener('popstate',locationChanged);};
  },[]);
  function navigate(target:string){const params=new URLSearchParams();if(new URLSearchParams(location.search).get('view')==='opening')params.set('view','opening');if(target)params.set('target',target);history.pushState(null,'','/rooms'+(params.size?'?'+params.toString():''));setRoute({target,code:''});}
  if(!ready)return <Loading/>;
  if(!session)return <><div className="entry-switch toolbar"><button className="secondary" onClick={()=>setGuest(false)} aria-pressed={!guest}>교사 입장</button><button className="secondary" onClick={()=>setGuest(true)} aria-pressed={guest}>초대받은 손님</button></div>{guest?<GuestEntry code={route.code} onLogin={(value,code)=>{setRoute({target:'',code});setSession(value);}}/>:<LoginForm initialMessage={message} onLogin={setSession}/>}</>;
  return <SignedIn key={session.token} session={session} logout={logout}><Rooms targetId={route.target} code={route.code} navigate={navigate}/></SignedIn>;
}
