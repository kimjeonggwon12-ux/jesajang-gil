'use client';
import {useEffect,useRef,useState} from 'react';
import {useMember} from '../MemberArea';
import {Modal,ErrorNote} from '../Ui';
import {attendanceWhen,attendanceLabel,attendancePath} from '../../lib/attendance';
import {seriesWhen,downloadAttendance,type AdminMeeting,type AttendSeries} from '../../lib/attendance-admin';
import {loadSession} from '../../lib/session';
import {qrLibrary} from '../../lib/qr';
export default function AttendanceQr({entry,onClose}:{entry:AdminMeeting|AttendSeries;onClose:()=>void}){
 const {query,session}=useMember(),series='weekdays'in entry,id=series?entry.seriesId:entry.meetingId,course=id.startsWith('CH'),box=useRef<HTMLDivElement>(null),alive=useRef(false),[url,setUrl]=useState(''),[count,setCount]=useState<number|null>(course?null:series?0:entry.count),[error,setError]=useState(''),[countError,setCountError]=useState(''),[ready,setReady]=useState(false),[notice,setNotice]=useState('');
 useEffect(()=>{alive.current=true;let active=true,wake:WakeLockSentinel|undefined,inFlight=false,timer:ReturnType<typeof setTimeout>|undefined;const target=box.current,valid=()=>active&&loadSession()?.token===session.token;
  const link=location.origin+attendancePath(id);setUrl(link);
  void qrLibrary().then(QR=>{if(!valid()||!target)return;target.replaceChildren();const size=Math.max(180,Math.min(window.innerWidth-96,400));new QR(target,{text:link,width:size,height:size,correctLevel:QR.CorrectLevel.M});setReady(true);}).catch(e=>{if(valid())setError(e.message);});
  async function poll(){if(!valid()||document.hidden||inFlight)return;inFlight=true;clearTimeout(timer);try{const r=await query<{count:number}>('getAttendCount',{meetingId:id});if(valid()){setCount(r.count);setCountError('');}}catch{if(valid())setCountError('인원수를 새로 확인하지 못했어요. 잠시 후 다시 확인해요.');}finally{inFlight=false;if(valid()&&!document.hidden)timer=setTimeout(poll,10000);}}
  async function holdScreen(){try{const result=await navigator.wakeLock.request('screen');if(!valid()||document.hidden){void result.release();return;}wake=result;}catch{/* 지원하지 않는 환경은 화면 유지 없이 동작한다. */}}
  const visibility=()=>{clearTimeout(timer);if(document.hidden){void wake?.release();wake=undefined;}else{void poll();void holdScreen();}};document.addEventListener('visibilitychange',visibility);void poll();if(!document.hidden)void holdScreen();
  return()=>{alive.current=false;active=false;clearTimeout(timer);document.removeEventListener('visibilitychange',visibility);void wake?.release();target?.replaceChildren();};
 },[id,query,session.token]);
 return <Modal title="출석 QR" onClose={onClose}><section className="att-qr"><h3>{entry.title}</h3><p>{attendanceLabel(entry)} · {series?seriesWhen(entry):attendanceWhen(entry)}</p>{entry.place?<p>{entry.place}</p>:null}<div ref={box} className="att-qr-image" aria-label="출석 QR 그림"/><ErrorNote message={error}/><p>휴대폰 카메라로 QR을 찍어 출석해 주세요.</p><p className="att-qr-count">{course?'현재 모임':series?'오늘':'지금까지'} <b>{count??'…'}</b>명 출석</p>{course?<p>오늘 QR이 연결하는 모임의 인원이에요. 교육 출석 화면의 하루 합계와 다를 수 있어요.</p>:null}{countError?<p role="status">{countError}</p>:null}{series?<p>매주 같은 QR을 사용해요. 그림을 저장해 두세요.</p>:null}<a href={url} target="_blank" rel="noreferrer">출석 화면 열기</a><div className="att-actions"><button className="secondary" disabled={!ready} onClick={()=>{const canvas=box.current?.querySelector('canvas');if(!canvas){setError('이 브라우저에서는 QR 그림을 저장할 수 없어요.');return;}canvas.toBlob(blob=>{if(blob&&alive.current&&loadSession()?.token===session.token)downloadAttendance('출석QR_'+entry.title+'.png',blob);},'image/png');}}>QR 그림 저장</button><button className="secondary" disabled={!url} onClick={()=>{void navigator.clipboard.writeText(url).then(()=>{if(alive.current&&loadSession()?.token===session.token)setNotice('출석 링크를 복사했어요.');}).catch(()=>{if(alive.current&&loadSession()?.token===session.token)setNotice('복사하지 못했어요. 출석 화면 주소를 복사해 주세요.');});}}>출석 링크 복사</button></div>{notice?<p role="status">{notice}</p>:null}</section></Modal>;
}
