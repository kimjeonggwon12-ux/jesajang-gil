'use client';
// 11/17(사용자): 단계향상 피드백 옆 '감동주기 방법' — 쌓인 기록 전부(정보 기록·수업 반응·활동·HEARTS·교관·이전 AI)를 모아 그분 맞춤 감동 방법(A erMovingRun 과 같음)
import {useRef,useState} from 'react';
import {useMember} from '../MemberArea';
import {useQuery} from '../../lib/use-query';
import {ErrorNote} from '../Ui';
import {checkedFeedbackText,type TargetInfo,type SavedFeedback} from '../../lib/target-insights';
export default function ClassicMovingFeedback({targetId,onBusy}:{targetId:string;onBusy:(busy:boolean)=>void}){
 const {request}=useMember(),info=useQuery<TargetInfo>('getTargetInfo',{targetId}),[added,setAdded]=useState<SavedFeedback[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),pending=useRef(false);
 const list=[...added,...(info.data?.moving||[])];
 async function generate(){if(pending.current)return;pending.current=true;setBusy(true);onBusy(true);setError('');try{const r=await request<SavedFeedback>('targetMovingFeedback',{targetId});setAdded(a=>[{...r,text:checkedFeedbackText(r.text)},...a]);}catch(e){setError((e as Error).message);}finally{pending.current=false;setBusy(false);onBusy(false);}}
 return <><button className="er-o-main" disabled={busy} onClick={()=>void generate()}>{busy?'기록 전부 모아 읽는 중… (30초쯤)':list.length?'🔄 지금까지 쌓인 기록으로 다시 받기':'💝 감동주기 방법 받기'}</button><ErrorNote message={error}/><ErrorNote message={info.error} retry={info.reload}/>
  {list.length?<><div className="er-o-h">받은 감동주기 방법 <span>{list.length}회 · 새것부터</span></div>{list.map((x,i)=><details key={i} className="er-o-card" open={i===0}><summary>{x.at?.slice(5,16)} {x.basis}</summary><div className="pre-wrap">{x.text}</div></details>)}</>
   :<div className="er-o-note">정보 기록(수업 반응 포함)·활동 기록·HEARTS·교관 답을 전부 모아, 이분이 &quot;나를 알아주는구나&quot; 하고 마음이 열리는 맞춤 방법을 알려 드려요.</div>}</>;
}
