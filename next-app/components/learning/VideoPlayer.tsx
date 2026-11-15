'use client';
import {useEffect,useRef,useState} from 'react';
import {useMember} from '../MemberArea';
import {loadSession} from '../../lib/session';
import {Modal,ErrorNote} from '../Ui';
import {createProgressSaver,receivePlayback,resumeAt,type Playback,type Video,type Lesson,type Lecture,type ProgressResult} from '../../lib/learning';
import TranscriptPanel from './TranscriptPanel';
export default function VideoPlayer({video,lecture,index=0,onClose,onStep,onProgress}:{video:Video|Lesson;lecture?:Lecture;index?:number;onClose:()=>void;onStep?:(index:number)=>void;onProgress?:(id:string,progress:Pick<Lesson,'pct'|'completed'|'duration'|'lastPos'>)=>void}){
 const {request,session}=useMember(),frame=useRef<HTMLIFrameElement>(null);
 const p=useRef<Playback>({buckets:new Set(),lastT:null,state:-1,duration:lecture?(video as Lesson).duration:0,pos:lecture?(video as Lesson).lastPos:0});
 const [duration,setDuration]=useState(p.current.duration),[pct,setPct]=useState(lecture?(video as Lesson).pct:0),[completed,setCompleted]=useState(lecture?(video as Lesson).completed:false),[error,setError]=useState(''),[saving,setSaving]=useState(false);
 const alive=useRef(true),changed=useRef(false),done=useRef(completed),notify=useRef(onProgress),closeLock=useRef(false),pingTimers=useRef<ReturnType<typeof setTimeout>[]>([]);
 const [start]=useState(()=>lecture?resumeAt(video as Lesson):0);
 notify.current=onProgress;
 const [save]=useState(()=>createProgressSaver({
  active:()=>loadSession()?.token===session.token,
  body:()=>lecture&&changed.current?{lectureId:lecture.lectureId,videoKey:video.id,buckets:[...p.current.buckets],duration:p.current.duration,lastPos:Math.floor(p.current.pos||0)}:undefined,
  send:body=>request<ProgressResult>('saveLectureProgress',body),
  saved:(body,r)=>{if(alive.current){done.current=r.completed;setCompleted(r.completed);setPct(r.pct);setError('');notify.current?.(video.id,{pct:r.pct,completed:r.completed,duration:body.duration,lastPos:body.lastPos});}},
  failed:e=>{if(alive.current)setError(e instanceof Error?e.message:'진도를 저장하지 못했어요.');},
 }));
 useEffect(()=>{
  alive.current=true;
  const receive=(e:MessageEvent)=>{
   if(e.source!==frame.current?.contentWindow||!/^https:\/\/www\.youtube(-nocookie)?\.com$/.test(e.origin))return;
   let data;try{data=typeof e.data==='string'?JSON.parse(e.data):e.data;}catch{return;}
   const info=data?.info;if(!info||typeof info!=='object'||(info.videoData?.video_id&&info.videoData.video_id!==video.videoId))return;
   receivePlayback(p.current,info);setDuration(p.current.duration);
   if(lecture){changed.current=true;setPct(done.current?100:p.current.duration?Math.min(100,Math.round(Math.min(p.current.duration,p.current.buckets.size*10)/p.current.duration*100)):0);if(info.playerState===0)void save();}
  };
  window.addEventListener('message',receive);
  const visibility=()=>{if(document.hidden)void save();};document.addEventListener('visibilitychange',visibility);
  const timer=lecture?setInterval(()=>{if(!document.hidden)void save();},20000):undefined;
  return()=>{alive.current=false;clearInterval(timer);pingTimers.current.forEach(clearTimeout);window.removeEventListener('message',receive);document.removeEventListener('visibilitychange',visibility);void save();};
 },[video.id,video.videoId,lecture?.lectureId,save]);
 async function leave(next?:number){
  if(closeLock.current)return;closeLock.current=true;setSaving(true);
  const success=await save();if(alive.current){if(success){if(next===undefined)onClose();else onStep?.(next);}setSaving(false);}closeLock.current=false;
 }
 async function retry(){if(closeLock.current)return;closeLock.current=true;setSaving(true);await save(true);if(alive.current)setSaving(false);closeLock.current=false;}
 function message(func:string,args:unknown[]){frame.current?.contentWindow?.postMessage(JSON.stringify({event:'command',func,args}),'https://www.youtube-nocookie.com');}
 function listen(){pingTimers.current.forEach(clearTimeout);const ping=()=>frame.current?.contentWindow?.postMessage(JSON.stringify({event:'listening',id:1,channel:'widget'}),'https://www.youtube-nocookie.com');ping();pingTimers.current=[setTimeout(ping,1500),setTimeout(ping,4000)];}
 return <Modal title={lecture?`${lecture.title} · ${index+1}/${lecture.lessons.length}강`:video.title} onClose={()=>void leave()} busy={saving}>
  <div className="learning-video-frame"><iframe ref={frame} title={video.title} src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(video.videoId)}?autoplay=1&rel=0&playsinline=1&enablejsapi=1${start?'&start='+start:''}&origin=${typeof location!=='undefined'?encodeURIComponent(location.origin):''}`} allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" onLoad={listen}/></div>
  <h3>{video.title}</h3><p>{video.part} · {video.uploadDate}</p>{video.description?<p>{video.description}</p>:null}
  {lecture?<><p role="status">{completed?'이수한 강의예요':`${pct}% 봤어요 · 90% 이상이면 이수`}</p><progress max={100} value={pct}/>{start?<p>지난번 본 {Math.floor(start/60)}분 {start%60}초부터 이어서 재생해요.</p>:null}<ErrorNote message={error}/>{error?<div className="toolbar"><button className="secondary" disabled={saving} onClick={()=>void retry()}>진도 저장 다시 시도</button><button className="secondary" disabled={saving} onClick={onClose}>저장하지 못한 진도는 남기지 않고 닫기</button></div>:null}<div className="toolbar"><button className="secondary" disabled={saving||index===0} onClick={()=>void leave(index-1)}>이전 강</button><button className="secondary" disabled={saving||index>=lecture.lessons.length-1} onClick={()=>void leave(index+1)}>다음 강</button></div><p className="help">앞으로 건너뛴 부분과 유튜브 앱에서 본 부분은 진도에 들어가지 않아요.</p></>:null}
  <a href={`https://www.youtube.com/watch?v=${encodeURIComponent(video.videoId)}`} target="_blank" rel="noopener noreferrer">재생되지 않으면 유튜브에서 열기 ↗</a>
  <TranscriptPanel video={video} duration={duration} seek={seconds=>{message('seekTo',[seconds,true]);message('playVideo',[]);frame.current?.scrollIntoView({block:'start',behavior:'smooth'});}}/>
 </Modal>;
}
