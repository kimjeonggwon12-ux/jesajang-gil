'use client';
import {useRef,useState} from 'react';
import {useMember} from '../MemberArea';
import {useQuery} from '../../lib/use-query';
import {ErrorNote} from '../Ui';
import {checkedFeedbackText,type TargetInfo,type TargetFile,type SavedFeedback} from '../../lib/target-insights';
export default function ClassicMasterFeedback({targetId,feedbackCount,total,onBusy}:{targetId:string;feedbackCount:number;total:number;onBusy:(busy:boolean)=>void}){
 const {request}=useMember(),info=useQuery<TargetInfo>('getTargetInfo',{targetId}),file=useQuery<TargetFile>('getTargetFile',{targetId}),[saved,setSaved]=useState<SavedFeedback|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),pending=useRef(false),master=saved||info.data?.master;
 async function generate(){if(pending.current)return;pending.current=true;setBusy(true);onBusy(true);setError('');try{const r=await request<SavedFeedback>('targetMasterFeedback',{targetId});setSaved({...r,text:checkedFeedbackText(r.text)});}catch(e){setError((e as Error).message);}finally{pending.current=false;setBusy(false);onBusy(false);}}
 return <div className="ms-card"><div className="ms-h">🧠 종합 피드백 <span>쌓인 기록·피드백을 전부 모아 하나로</span></div><div className="ms-src">{[['🗂 정보 기록',info.data?.items.length??'…'],['📈 단계향상',feedbackCount],['❤️ HEARTS',file.data?.hearts.length??'…'],['🧭 개강 계획',file.data?.plans.length??'…'],['📝 기록',total]].map(([l,n])=><span key={String(l)}>{l} <b>{n}</b></span>)}</div><button className="ms-btn" disabled={busy} onClick={()=>void generate()}>{busy?'전부 모아 읽는 중…':master?'🔄 지금까지 쌓인 것으로 다시 취합하기':'🧠 모두 취합해 종합 피드백 받기'}</button><ErrorNote message={error}/><ErrorNote message={info.error} retry={info.reload}/><ErrorNote message={file.error} retry={file.reload}/>{master?<details className="er-o-card ms-out" open={!!saved}><summary>📋 {master.at?.slice(5,16)} 종합 피드백 {master.basis}</summary><div className="pre-wrap">{master.text}</div></details>:null}</div>;
}
