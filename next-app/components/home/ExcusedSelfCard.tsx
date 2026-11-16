'use client';
// 공무 본인 신고 카드(A app.html excusedSelfBannerHtml 과 같은 동선) — 로그인한 대상자만, 누르면 소속까지 서버가 기록.
import {useState} from 'react';
import {useMember} from '../MemberArea';
import {useQuery} from '../../lib/use-query';
import {useAttendanceTask} from '../attendance/useAttendanceTask';
import {ErrorNote} from '../Ui';
import {exsGroupText,exsLine,type ExsData} from '../../lib/edu-excused-self';
export default function ExcusedSelfCard(){
 const {request}=useMember(),q=useQuery<ExsData>('getMyExcused'),task=useAttendanceTask(),[reason,setReason]=useState(''),[busy,setBusy]=useState('');
 const d=q.data;if(!d||!d.enabled||!d.eligible)return null;
 const act=(date:string,cancel:boolean)=>{setBusy(date);void task.run(async()=>{if(cancel){await request('cancelMyExcused',{date});task.setNotice('공무 신고를 취소했어요');}else{const r=await request<{label:string}>('submitMyExcused',{date,reason:reason.trim()});task.setNotice(r.label+' 공무로 신고했어요');setReason('');}q.reload();}).finally(()=>setBusy(''));};
 return <section className="exs-card" aria-label="공무 신고"><strong>📋 {d.title} 공무 신고</strong><small>{d.name} · {exsGroupText(d)} — 누르면 소속까지 자동으로 기록돼요</small>
  <input aria-label="공무 사유(선택)" maxLength={200} placeholder="사유(선택) — 비워 두면 '공무'" value={reason} onChange={e=>setReason(e.target.value)}/>
  {(d.dates||[]).map(x=><div className="exs-row" key={x.date}><b>{x.label}</b><span className={x.mine?'on':''}>{exsLine(x)}</span>{x.mine?<button className="secondary" disabled={task.busy} onClick={()=>act(x.date,true)}>취소</button>:<button className="primary" disabled={task.busy} onClick={()=>act(x.date,false)}>{busy===x.date?'신고하는 중…':'공무로 신고'}</button>}</div>)}
  <ErrorNote message={task.error}/>{task.notice?<p role="status">{task.notice}</p>:null}</section>;
}
