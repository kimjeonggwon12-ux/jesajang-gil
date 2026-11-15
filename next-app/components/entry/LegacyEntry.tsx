'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {resolveLegacyEntry} from '../../lib/legacy-entry.mjs';
import {rememberEntry} from '../../lib/entry-handoff';
import {loadSession} from '../../lib/session';
export default function LegacyEntry({onHome}:{onHome?:()=>void}={}){const router=useRouter(),started=useRef(false),[error,setError]=useState('');useEffect(()=>{if(started.current)return;started.current=true;const result=resolveLegacyEntry(location.pathname,location.search,location.hash);if(!result){router.replace('/');return;}if(result.error){history.replaceState(null,'',location.pathname);setError(result.error);return;}rememberEntry(result,loadSession()?.token||'');history.replaceState(null,'',location.pathname);if(result.href==='/'&&location.pathname==='/'&&onHome)onHome();else router.replace(result.href);},[router,onHome]);return <main className="login-page"><section className="login-card"><h1>교사광장</h1>{error?<><p role="alert">{error}</p><Link href="/attendance">모임 출석</Link> · <Link href="/rooms">피드백방</Link> · <Link href="/">홈</Link></>:<p role="status">화면을 여는 중이에요.</p>}</section></main>;}
