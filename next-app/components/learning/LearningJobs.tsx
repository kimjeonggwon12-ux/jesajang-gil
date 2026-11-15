'use client';
import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {useMember} from '../MemberArea';
import {loadSession} from '../../lib/session';
import type {Video} from '../../lib/learning';
type Job={title:string;running:boolean;message:string;error:string;version:number;token:string};
type Request=<T>(action:string,body?:Record<string,unknown>)=>Promise<T>;
type Options={restart?:boolean;duration?:number};
const Context=createContext<{jobs:Record<string,Job>;run:(video:Video,options:Options,session:{token:string;request:Request})=>void}|null>(null);
export function useLearningJobs(){
 const c=useContext(Context),{session,request}=useMember();if(!c)throw Error('자료 작업 컨텍스트가 필요합니다.');
 const jobs=useMemo(()=>Object.fromEntries(Object.entries(c.jobs).filter(([,job])=>job.token===session.token)),[c.jobs,session.token]);
 const run=useCallback((video:Video,options:Options={})=>c.run(video,options,{token:session.token,request}),[c.run,session.token,request]);
 return {jobs,run};
}
// 최상위 화면에서 유지하되, 각 단계 전 계정이 그대로인지 확인한다. 로그아웃 뒤 새 AI 요청은 보내지 않는다.
export function LearningJobsProvider({children}:{children:ReactNode}){
 const [jobs,setJobs]=useState<Record<string,Job>>({}),locks=useRef(new Set<string>()),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const run=useCallback((video:Video,options:Options,{token,request}:{token:string;request:Request})=>{
  const active=()=>alive.current&&loadSession()?.token===token,key=token+':'+video.id;
  if(!active()||locks.current.has(key))return;locks.current.add(key);
  const update=(patch:Partial<Job>)=>{if(active())setJobs(old=>({...Object.fromEntries(Object.entries(old).filter(([,j])=>j.token===token)),[video.id]:{...(old[video.id]?.token===token?old[video.id]:{title:video.title,running:true,message:'자료를 만들고 있어요.',error:'',version:0,token}),...patch}}));};
  update({running:true,error:'',message:'녹취·요약·교안 자료를 만들고 있어요.'});
  void(async()=>{try{for(let step=0;step<32&&active();step++){
   const res=await request<{status:string;step:string;done:number;segs:number}>('videoTranscribe',{id:video.id,...(step===0?options:{})});
   if(!active())return;
   update({version:Date.now(),message:res.status==='완료'?'자료를 완성했어요.':res.step==='녹취'?`녹취 ${res.done}/${res.segs} 구간 완료`:'요약·교안 자료를 만들고 있어요.'});
   if(res.status==='완료')return;
  }if(active())update({error:'처리할 자료가 남았어요. 상태를 확인한 뒤 이어서 만들어 주세요.'});
  }catch(e){update({error:e instanceof Error?e.message:'자료를 만들지 못했어요. 상태를 확인한 뒤 다시 눌러 주세요.'});}
  finally{locks.current.delete(key);update({running:false});}})();
 },[]);
 return <Context.Provider value={{jobs,run}}>{children}</Context.Provider>;
}
