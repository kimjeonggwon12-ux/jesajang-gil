'use client';
import {useEffect,useRef,useState} from 'react';
import {useMember} from '../MemberArea';
import {useQuery} from '../../lib/use-query';
import {ErrorNote,Modal,Loading} from '../Ui';
import type {CenterPolicy} from '../../lib/centers';
const policyTime=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const displayTime=(value:string)=>{const d=new Date(value);return Number.isNaN(d.getTime())?'확인 필요':policyTime.format(d);};
type Review={review:string;before:string;after:string;reason:string};
type Data={policy:CenterPolicy;modes:Record<string,string>;history:{changed_at:string;actor_name:string;before_mode:string;after_mode:string;reason:string;version:number}[]};
export default function CenterPolicySettings({onSaved}:{onSaved:()=>void}){
 const [open,setOpen]=useState(false);
 return <><button className="secondary" onClick={()=>setOpen(true)}>센터 승인 기준 설정</button>{open?<PolicyEditor onClose={()=>setOpen(false)} onSaved={()=>{setOpen(false);onSaved();}}/>:null}</>;
}
function PolicyEditor({onClose,onSaved}:{onClose:()=>void;onSaved:()=>void}){
 const {request}=useMember(),q=useQuery<Data>('getCenterPolicy'),[mode,setMode]=useState(''),[reason,setReason]=useState(''),[review,setReview]=useState<Review|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const data=q.data,pending=useRef(false),reviewRef=useRef<HTMLElement>(null);
 useEffect(()=>{if(review)reviewRef.current?.focus();},[review]);
 async function submit(save=false){
  if(pending.current||!data||save&&!review)return;pending.current=true;setBusy(true);setError('');
  const body={mode:mode||data.policy.mode,reason,expectedVersion:data.policy.version};
  try{if(save){await request('saveCenterPolicy',{...body,review:review!.review,confirmed:true});onSaved();}else setReview(await request<Review>('previewCenterPolicy',body));}
  catch(e){setReview(null);setError((e as Error).message);}finally{pending.current=false;setBusy(false);}
 }
 return <Modal title="센터 승인 기준 설정" onClose={onClose} busy={busy}><ErrorNote message={q.error} retry={q.reload}/>{q.loading?<Loading/>:data?<><p>현재: {data.modes[data.policy.mode]}</p><p>승인·반려·전달·되돌림의 범위를 바꿉니다. 상담·서류 열람은 담당 범위를 유지합니다.</p><form onSubmit={e=>{e.preventDefault();void submit(!!review);}}><fieldset disabled={busy}><label>승인 방식<select value={mode||data.policy.mode} disabled={!!review} onChange={e=>setMode(e.target.value)}>{Object.entries(data.modes).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><p>직책별: 회장·총무·총교관·서기·전도부장은 자기 부서, 지역장·복음방교관은 자기 부서·지역을 담당합니다.</p><p>기존 방식: 교육·전도 담당자의 전체 승인 범위와 기존 직책 범위를 유지합니다.</p><label>변경 근거<textarea required maxLength={300} readOnly={!!review} value={reason} onChange={e=>setReason(e.target.value)}/></label>{review?<section className="notice" role="status" ref={reviewRef} tabIndex={-1}><p>{data.modes[review.before]} → {data.modes[review.after]}</p><p>{review.reason}</p><p>저장 뒤 다음 요청부터 새 기준으로 확인합니다. 처리 중 기준이 바뀐 요청은 재확인을 요구할 수 있습니다.</p><button type="button" className="secondary" onClick={()=>setReview(null)}>다시 선택</button></section>:null}<ErrorNote message={error}/><button type="submit" className="primary" disabled={busy||!reason.trim()}>{busy?'처리 중…':review?'확인하고 기준 저장':'변경 내용 확인'}</button>{error?<button type="button" className="secondary" onClick={()=>{setReview(null);q.reload();}}>현재 기준 다시 조회</button>:null}</fieldset></form><h3>최근 기준 변경</h3><p className="help">변경 시각은 한국 시간입니다.</p>{data.history.length?<ol>{data.history.map(h=><li key={h.version}>{data.modes[h.before_mode]} → {data.modes[h.after_mode]}<br/>{h.actor_name} · {displayTime(h.changed_at)}<p>{h.reason}</p></li>)}</ol>:<p>변경 기록이 없어요.</p>}</>:null}</Modal>;
}
