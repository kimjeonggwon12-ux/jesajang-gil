'use client';
// 나의 교실 > 출석 — 화요 전도단·목요 사명자 교육 공무 보고(A app.html excusedSelfPageHtml 과 같은 동선).
// 로그인한 대상자만, 누르면 소속까지 서버가 기록.
import {useState} from 'react';
import {useMember} from '../MemberArea';
import {useQuery} from '../../lib/use-query';
import {useAttendanceTask} from '../attendance/useAttendanceTask';
import {ErrorNote,Loading} from '../Ui';
import {exsGroupText,exsLine,exsWindowText,type ExsData} from '../../lib/edu-excused-self';
import {EM_THEME} from '../../lib/edu-mgmt';
export default function ExcusedSelfCard(){
 const {request}=useMember(),q=useQuery<ExsData>('getMyExcused'),task=useAttendanceTask(),[reason,setReason]=useState(''),[busy,setBusy]=useState('');
 const d=q.data;
 if(q.error)return <ErrorNote message={q.error} retry={q.reload}/>;
 if(!d)return <Loading/>;
 if(!d.enabled)return <p className="exs-empty">공무 보고는 아직 준비 중이에요.</p>;
 if(!d.eligible)return <p className="exs-empty">{d.reason||'공무 보고 대상이 아니에요.'}</p>;
 const act=(kind:string,date:string,cancel:boolean)=>{setBusy(kind+date);void task.run(async()=>{if(cancel){await request('cancelMyExcused',{kind,date});task.setNotice('공무 결석 신고를 취소했어요');}else{const r=await request<{label:string}>('submitMyExcused',{kind,date,reason:reason.trim()});task.setNotice(r.label+' 공무 결석으로 신고했어요');setReason('');}q.reload();}).finally(()=>setBusy(''));};
 return <section className="exs-card" aria-label="공무 결석 보고"><strong>📋 {d.title}</strong><small>{d.name} · {exsGroupText(d)} — 누르면 소속까지 자동으로 기록돼요</small>
  <input aria-label="결석 사유 기록" maxLength={200} placeholder="결석 사유 기록" value={reason} onChange={e=>setReason(e.target.value)}/>
  {(d.kinds||[]).map(k=><div className={'exs-k '+(EM_THEME[k.kind]?.cls||'')} key={k.kind}><b className="exs-kt"><span>{EM_THEME[k.kind]?.icon}</span>{k.title}</b>{exsWindowText(k.kind)?<small className="exs-win">{exsWindowText(k.kind)}</small>:null}{k.dates.map(x=><div className="exs-row" key={x.date}><b>{x.label}</b><span className={x.mine?'on':''}>{exsLine(x)}</span>{x.mine?<button className="secondary" disabled={task.busy} onClick={()=>act(k.kind,x.date,true)}>취소</button>:<button className="primary" disabled={task.busy} onClick={()=>act(k.kind,x.date,false)}>{busy===k.kind+x.date?'신고하는 중…':'공무 결석으로 신고'}</button>}</div>)}</div>)}
  <ErrorNote message={task.error}/>{task.notice?<p role="status">{task.notice}</p>:null}</section>;
}
