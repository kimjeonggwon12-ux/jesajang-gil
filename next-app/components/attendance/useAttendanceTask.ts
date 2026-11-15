'use client';
import {useEffect,useRef,useState} from 'react';
import {useMember} from '../MemberArea';
import {loadSession} from '../../lib/session';
export function useAttendanceTask(){const {session}=useMember(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),alive=useRef(true),locked=useRef(false);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);const active=()=>alive.current&&loadSession()?.token===session.token;async function run(fn:()=>Promise<void>){if(locked.current||!active())return;locked.current=true;setBusy(true);setError('');setNotice('');try{await fn();}catch(e){if(active())setError(e instanceof Error?e.message:'처리하지 못했어요.');}finally{locked.current=false;if(active())setBusy(false);}}return{busy,error,notice,setError,setNotice,active,run};}
