'use client';
import {Suspense,useEffect,useState} from 'react';
import {resolveLegacyEntry} from '../lib/legacy-entry.mjs';
import LegacyEntry from './entry/LegacyEntry';
import MemberArea from './MemberArea';
import PersonalOverview from './PersonalOverview';
import Activities from './activities/Activities';
export default function SessionApp(){const [mode,setMode]=useState<'loading'|'entry'|'home'|'notices'>('loading');useEffect(()=>{const sync=()=>setMode(resolveLegacyEntry('/',location.search,location.hash)?'entry':new URLSearchParams(location.search).get('view')==='notices'||location.hash==='#notices'?'notices':'home');sync();window.addEventListener('hashchange',sync);window.addEventListener('popstate',sync);return()=>{window.removeEventListener('hashchange',sync);window.removeEventListener('popstate',sync);};},[]);return mode==='entry'?<LegacyEntry onHome={()=>setMode('home')}/>:mode==='home'||mode==='notices'?<MemberArea>{mode==='notices'?<PersonalOverview/>:<Suspense fallback={<p role="status">활동을 여는 중이에요.</p>}><Activities/></Suspense>}</MemberArea>:<main className="login-page"><p role="status">교사광장을 여는 중이에요.</p></main>;}
