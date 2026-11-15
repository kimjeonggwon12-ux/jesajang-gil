'use client';
import {Suspense,createContext,useCallback,useContext,useEffect,useMemo,useState,type ReactNode} from 'react';
import {callApi,readApi,SessionExpired,type ReadAction} from '../lib/api';
import {clearSession,loadSession,MEMBER_KEY,TOKEN_KEY,type Session} from '../lib/session';
import type {MemberAccess} from '../lib/contracts';
import LoginForm from './LoginForm';
import {ExitNotice} from './Ui';
import AccountSettings from './AccountSettings';
import {ClassicIdentity} from './presentation/ClassicIdentity';
import {acceptPinSession,logVisitOnce} from '../lib/account-settings';
import ClassicAdminFrame from './presentation/ClassicAdminFrame';
import ClassicNavigation from './presentation/ClassicNavigation';

type Request = <T>(action:string,body?:Record<string,unknown>)=>Promise<T>;
type Query = <T>(action:ReadAction,body?:Record<string,unknown>)=>Promise<T>;
type MemberContextValue={session:Session;access:MemberAccess;request:Request;query:Query;refreshAccess:()=>Promise<void>;renewPinSession:(result:{ok?:boolean;token?:string;pinVer?:string;ver?:string})=>void};
const MemberContext=createContext<MemberContextValue|null>(null);
export function useMember(){const value=useContext(MemberContext);if(!value)throw Error('인증 화면 안에서 사용해야 합니다.');return value;}

function VerifiedArea({session,logout,children,onRenewed,notice}:{session:Session;logout:(message?:string)=>void;children:ReactNode;onRenewed:(session:Session)=>void;notice:string}) {
  const [accountOpen,setAccountOpen]=useState(false);
  const [access,setAccess]=useState<MemberAccess|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  const request=useCallback<Request>(async<T,>(action:string,body:Record<string,unknown>={})=>{
    try {const result=await callApi<T>(action,body,session.token);if(result.error)throw Error(result.error);return result;}
    catch(error){if(error instanceof SessionExpired&&loadSession()?.token===session.token)logout(error.message);throw error;}
  },[session.token,logout]);
  const query=useCallback<Query>(async<T,>(action:ReadAction,body:Record<string,unknown>={})=>{
    try {const result=await readApi<T>(action,session.token,body);if(result.error)throw Error(result.error);return result;}
    catch(error){if(error instanceof SessionExpired&&loadSession()?.token===session.token)logout(error.message);throw error;}
  },[session.token,logout]);
  const refreshAccess=useCallback(async()=>{const result=await request<MemberAccess>('checkAdmin');setAccess(result);},[request]);
  useEffect(()=>{
    let active=true;setError('');
    readApi<MemberAccess>('checkAdmin',session.token).then(result=>{
      if(!active)return;if(result.error)throw Error(result.error);setAccess(result);
    }).catch(error=>{if(!active)return;if(error instanceof SessionExpired)logout(error.message);else setError(error.message);});
    return()=>{active=false;};
  },[session.token,attempt,logout]);
  const renewPinSession=useCallback((result:{ok?:boolean;token?:string;pinVer?:string;ver?:string})=>{const next=acceptPinSession(session,result);if(next)onRenewed(next);},[session,onRenewed]);
  useEffect(()=>{if(access)logVisitOnce(session.account,()=>callApi('logVisit',{memberId:session.account.memberId,name:session.account.name},session.token));},[access,session]);
  const value=useMemo(()=>access?{session,access,request,query,refreshAccess,renewPinSession}:null,[session,access,request,query,refreshAccess,renewPinSession]);
  if(!value)return <main className="overview"><p role="status">로그인 정보를 확인하고 있어요.</p>{error?<p className="error" role="alert">{error} <button onClick={()=>setAttempt(v=>v+1)}>다시 확인</button></p>:null}<button className="text-button" onClick={()=>logout()}>로그아웃</button></main>;
  return <MemberContext.Provider value={value}><ClassicIdentity name={value.access.name} tier={value.access.roster?.tier} logout={()=>logout()} openAccount={()=>setAccountOpen(true)}><div className="classic-ui"><ExitNotice token={session.token}/><a className="skip-link" href="#main-content">본문으로 이동</a><Suspense fallback={<div className="classic-nav-loading"/>}><ClassicNavigation name={value.access.name} tier={value.access.roster?.tier} isAdmin={value.access.isAdmin} logout={()=>logout()}/></Suspense><main id="main-content" className="workspace classic-workspace">{notice?<p className="notice" role="status">{notice}</p>:null}<Suspense fallback={<p role="status">화면을 여는 중이에요.</p>}><ClassicAdminFrame isAdmin={value.access.isAdmin}>{children}</ClassicAdminFrame></Suspense></main>{accountOpen?<AccountSettings onClose={()=>setAccountOpen(false)}/>:null}</div></ClassicIdentity></MemberContext.Provider>;
}

export default function MemberArea({children}:{children:ReactNode}) {
  const [ready,setReady]=useState(false),[session,setSession]=useState<Session|null>(null),[message,setMessage]=useState(''),[notice,setNotice]=useState('');
  const logout=useCallback((message='')=>{clearSession();setSession(null);setMessage(message);setNotice('');},[]);
  const onRenewed=useCallback((next:Session)=>{setSession(next);setNotice('PIN을 바꿨어요. 이 기기에서는 새 로그인 정보로 계속 이용할 수 있어요.');},[]);
  useEffect(()=>{
    const sync=()=>{const current=loadSession();if(current?.account.guest||current?.token.startsWith('g')){location.replace('/rooms');return;}setSession(current);setNotice('');setReady(true);};
    const changed=(event:StorageEvent)=>{if(event.key===TOKEN_KEY||event.key===MEMBER_KEY||event.key===null)sync();};
    sync();window.addEventListener('storage',changed);window.addEventListener('ts-session-change',sync);return()=>{window.removeEventListener('storage',changed);window.removeEventListener('ts-session-change',sync);};
  },[]);
  if(!ready)return <main className="login-page"><p role="status">교사광장을 여는 중이에요.</p></main>;
  return session?<VerifiedArea key={session.token} session={session} logout={logout} onRenewed={onRenewed} notice={notice}>{children}</VerifiedArea>:<LoginForm key={message} initialMessage={message} onLogin={value=>{setMessage('');setSession(value);}}/>;
}
