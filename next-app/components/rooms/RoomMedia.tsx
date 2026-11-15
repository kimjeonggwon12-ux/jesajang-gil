'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useRoomSession} from './RoomArea';

export default function RoomMedia({targetId,id,kind,name}:{targetId:string;id:number;kind:'photo'|'file';name:string}){
 const {session}=useRoomSession(),element=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(false),[preview,setPreview]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),alive=useRef(true),downloads=useRef(new Set<string>());
 const load=useCallback(async(variant:string,signal?:AbortSignal)=>{
  const response=await fetch('/api/room-attachment',{method:'POST',cache:'no-store',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({_tk:session.token,targetId,id,kind,variant})});
  if(!response.ok){const data=await response.json();throw Error(data.error||'첨부를 열지 못했어요.');}const encoded=response.headers.get('content-disposition')?.match(/filename\*=UTF-8''([^;]+)/)?.[1];return {blob:await response.blob(),filename:encoded?decodeURIComponent(encoded):name};
 },[session.token,targetId,id,kind,name]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;for(const url of downloads.current)URL.revokeObjectURL(url);downloads.current.clear();};},[]);
 useEffect(()=>{if(kind!=='photo'||!element.current)return;const observer=new IntersectionObserver(rows=>{if(rows.some(r=>r.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'100px'});observer.observe(element.current);return()=>observer.disconnect();},[kind]);
 useEffect(()=>{
  if(kind!=='photo'||!visible)return;const controller=new AbortController();let url='';
  void load('preview',controller.signal).then(({blob})=>{if(controller.signal.aborted)return;url=URL.createObjectURL(blob);setPreview(url);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
  return()=>{controller.abort();if(url)URL.revokeObjectURL(url);};
 // 같은 세션/방/메시지의 미리보기만 유지한다. 전체 방 새로고침마다 파일을 다시 받지 않는다.
 },[load,kind,visible]);
 async function download(){if(busy)return;setBusy(true);setError('');try{const {blob,filename}=await load('original');if(!alive.current)return;const url=URL.createObjectURL(blob);downloads.current.add(url);const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>{URL.revokeObjectURL(url);downloads.current.delete(url);},60000);}catch(e){if(alive.current)setError((e as Error).message);}finally{if(alive.current)setBusy(false);}}
 return <div ref={element}>{kind==='photo'?(preview?<img src={preview} alt="대화 사진" decoding="async"/>:<p>사진을 확인하고 있어요.</p>):null}<button className="text-button" type="button" disabled={busy} onClick={()=>void download()}>{busy?'확인 중…':kind==='photo'?'사진 원본 받기':name+' 받기'}</button>{error?<p role="alert">{error}</p>:null}</div>;
}
