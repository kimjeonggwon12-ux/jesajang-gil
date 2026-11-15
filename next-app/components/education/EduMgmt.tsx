'use client';
// 교육 관리 > 화전단·목사교 (A: app.html eduMgmt 와 같은 메뉴·입력·결과). 숫자·권한·저장은 서버(edu-mgmt.js).
import {useEffect,useState} from 'react';
import {useMember} from '../MemberArea';
import {useAttendanceTask} from '../attendance/useAttendanceTask';
import {ErrorNote} from '../Ui';
import {EM_HEAD,EM_SOURCE,emCells,emPeopleGroups,emPersonText,emItemHead,emSessionsText,emDraft,emChanges,emChangeProblem,emHistoryText,emToday,
 type EmAccess,type EmWeek,type EmDetail,type EmScope,type EmDraft,type EmChange,type EmRow} from '../../lib/edu-mgmt';

function Table({rows,total,onPick}:{rows:EmRow[];total:EmRow;onPick?:(r:EmRow)=>void}){
 return <div className="em-scroll"><table className="em-tbl"><thead><tr>{EM_HEAD.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>
  {rows.map(r=><tr key={r.key}>{emCells(r).map((c,i)=><td key={i}>{i===0&&onPick?<button className="text-button" onClick={()=>onPick(r)}>{c}</button>:c}</td>)}</tr>)}
  <tr className="sum">{emCells(total).map((c,i)=><td key={i}>{c}</td>)}</tr></tbody></table></div>;
}

export default function EduMgmt({access}:{access:EmAccess}){
 const [view,setView]=useState<'week'|'excused'|'heads'>('week');
 const tabs:[typeof view,string][]=[['week','주간 출석 현황'],['excused','공무 사전보고'],...(access.owner?[['heads','부서장 지정'] as [typeof view,string]]:[])];
 return <section className="em-wrap"><div className="att-actions" role="tablist">{tabs.map(([k,l])=><button key={k} role="tab" aria-selected={view===k} className={view===k?'primary':'secondary'} onClick={()=>setView(k)}>{l}</button>)}</div>
  {view==='week'?<Weekly/>:view==='excused'?<Excused/>:<Heads/>}</section>;
}

function Weekly(){
 const {request}=useMember(),task=useAttendanceTask(),[date,setDate]=useState(emToday),[week,setWeek]=useState<EmWeek|null>(null),[detail,setDetail]=useState<EmDetail|null>(null);
 const load=()=>task.run(async()=>{setDetail(null);const w=await request<EmWeek>('getEduWeekly',{date});if(task.active())setWeek(w);});
 const open=(meetingId:string,group:string)=>task.run(async()=>{const d=await request<EmDetail>('getEduWeeklyDetail',{date,meetingId,group});if(task.active())setDetail(d);});
 // eslint-disable-next-line react-hooks/exhaustive-deps
 useEffect(()=>{void load();},[]);
 const download=()=>task.run(async()=>{const r=await request<{filename:string;mime:string;text:string}>('exportEduWeekly',{date});const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([r.text],{type:r.mime}));a.download=r.filename;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);});
 return <>
  <fieldset disabled={task.busy} className="att-form-row"><label>주(그 주 아무 날짜)<input type="date" value={date} onChange={e=>{setDate(e.target.value);setWeek(null);setDetail(null);}}/></label>
   <button className="secondary" onClick={()=>{void load();}}>조회</button><button className="secondary" disabled={!week||!week.items.length} onClick={()=>{void download();}}>요약 CSV 내려받기</button></fieldset>
  <p className="muted">참석 = 정시 + 지각. 공무(사전보고)는 불참에서 빼고 참석률 분모(재적)에는 넣어요. 실제로 온 공무자는 참석으로 세요.</p>
  {task.busy?<p role="status">처리하는 중…</p>:null}<ErrorNote message={task.error}/>
  {week?(week.items.length?<><p className="muted">{week.week.from} ~ {week.week.to}</p>{week.items.map(it=><div className="card em-card" key={it.meetingId}><h3>{emItemHead(it)}</h3>
   <p className="muted">{it.basisLabel} · {emSessionsText(it)}{it.scope==='dept'?' · 맡은 부서만':''} · 조직 이름을 누르면 상세</p>
   <Table rows={it.rows} total={it.total} onPick={r=>{void open(it.meetingId,r.key);}}/></div>)}</>
   :<p className="muted">{week.week.from} ~ {week.week.to} 에 볼 수 있는 화요전도단·목요사명자교육이 없어요.</p>):null}
  {detail?<div className="card em-card"><h3>{detail.group.label} 상세 · {detail.date} {detail.title}</h3><Table rows={detail.rows} total={detail.total}/>
   {emPeopleGroups(detail.people).map(g=><p key={g.status} className="muted"><b>{g.status} {g.people.length}명</b> — {g.people.map(emPersonText).join(', ')}</p>)}</div>:null}
 </>;
}

function Excused(){
 const {request}=useMember(),task=useAttendanceTask(),[kind,setKind]=useState('목사교'),[date,setDate]=useState(emToday),[scope,setScope]=useState<EmScope|null>(null),[drafts,setDrafts]=useState<Record<string,EmDraft>>({}),[confirm,setConfirm]=useState<EmChange[]|null>(null),[follow,setFollow]=useState<Record<string,{m:string;r:string;d:boolean}>>({});
 const take=(s:EmScope)=>{setScope(s);setDrafts(Object.fromEntries(s.people.map(p=>[p.memberId,emDraft(p)])));setFollow(Object.fromEntries(s.people.map(p=>[p.memberId,{m:p.followMethod,r:p.followResult,d:p.followDone}])));setConfirm(null);};
 const fetchScope=(aff:string)=>request<EmScope>('getEduExcusedScope',{kind,date,affiliation:aff});
 const load=(aff=scope?.affiliation||'')=>task.run(async()=>{const s=await fetchScope(aff);if(task.active())take(s);});
 // eslint-disable-next-line react-hooks/exhaustive-deps
 useEffect(()=>{void load();},[]);
 const edit=(id:string,patch:Partial<EmDraft>)=>setDrafts(d=>({...d,[id]:{...d[id],...patch}}));
 function review(){if(!scope)return;const changes=emChanges(scope.people,drafts),bad=emChangeProblem(changes);if(bad){task.setError(bad);setConfirm(null);return;}task.setError('');setConfirm(changes);}
 const save=()=>task.run(async()=>{if(!scope||!confirm)return;const r=await request<{added:number;removed:number;updated:number}>('applyEduExcusedScope',{kind,date,affiliation:scope.affiliation,revision:scope.revision,changes:confirm});const s=await fetchScope(scope.affiliation);if(task.active()){take(s);task.setNotice(`저장했어요. 추가 ${r.added}명 · 해제 ${r.removed}명 · 사유 수정 ${r.updated}명. 이미 보낸 보고는 바뀌지 않아요.`);}});
 const saveFollow=(id:string)=>task.run(async()=>{if(!scope)return;const p=scope.people.find(x=>x.memberId===id),f=follow[id];if(!p||!f)return;await request('saveEduExcusedFollowup',{kind,date,affiliation:scope.affiliation,memberId:id,version:p.version,followMethod:f.m.trim(),followResult:f.r.trim(),followDone:f.d});const s=await fetchScope(scope.affiliation);if(task.active()){take(s);task.setNotice(`${p.name} 교육 결과를 저장했어요. 출석 기록과 보낸 보고는 그대로예요.`);}});
 const nameOf=(id:string)=>scope?.people.find(p=>p.memberId===id)?.name||'';
 return <>
  <fieldset disabled={task.busy} className="att-form-row">
   <label>교육<select value={kind} onChange={e=>{setKind(e.target.value);setScope(null);}}><option value="목사교">목요사명자교육</option><option value="화전단">화요전도단</option></select></label>
   <label>날짜<input type="date" value={date} onChange={e=>{setDate(e.target.value);setScope(null);}}/></label>
   {scope&&scope.options.length>1?<label>소속<select value={scope.affiliation} onChange={e=>{void load(e.target.value);}}>{scope.options.map(o=><option key={o}>{o}</option>)}</select></label>:null}
   <button className="secondary" onClick={()=>{void load();}}>조회</button></fieldset>
  <p className="muted">고른 소속의 사명자만 저장돼요(다른 부서 기록은 그대로). 저장해도 Telegram 보고는 다시 보내지 않아요.</p>
  {task.busy?<p role="status">처리하는 중…</p>:null}<ErrorNote message={task.error}/>{task.notice?<p role="status">{task.notice}</p>:null}
  {scope?<div className="card em-card"><h3>{scope.affiliation} · {scope.date} <small>({scope.role==='head'?'부서장':'교육 담당'})</small></h3>
   <p className="muted">재적 {scope.people.length}명 · 공무 {scope.people.filter(p=>p.excused).length}명</p>
   {scope.people.map(p=>{const d=drafts[p.memberId]||emDraft(p),f=follow[p.memberId],lock=task.busy||!!confirm;return <div className="em-p" key={p.memberId}>
    <label className="check-label"><input type="checkbox" checked={d.on} disabled={lock} onChange={e=>edit(p.memberId,{on:e.target.checked})}/> <b>{p.name}</b> <small>{p.position}</small></label>{p.source?<small className="muted"> {EM_SOURCE[p.source]||''}</small>:null}
    {d.on?<div className="em-two"><input aria-label={p.name+' 공무 사유'} placeholder="공무 사유(필수)" maxLength={300} value={d.reason} disabled={lock} onChange={e=>edit(p.memberId,{reason:e.target.value})}/><input aria-label={p.name+' 추후 교육 방법'} placeholder="추후 교육 방법" maxLength={300} value={d.followMethod} disabled={lock} onChange={e=>edit(p.memberId,{followMethod:e.target.value})}/></div>
     :p.excused?<div className="em-two"><input aria-label={p.name+' 취소 이유'} placeholder="취소 이유" maxLength={300} value={d.cancelReason} disabled={lock} onChange={e=>edit(p.memberId,{cancelReason:e.target.value})}/></div>:null}
    {p.excused&&p.version!=null&&f?<><div className="em-two"><input aria-label={p.name+' 교육 방법'} placeholder="교육 방법" maxLength={300} value={f.m} onChange={e=>setFollow(x=>({...x,[p.memberId]:{...f,m:e.target.value}}))}/><input aria-label={p.name+' 교육 결과'} placeholder="교육 결과" maxLength={500} value={f.r} onChange={e=>setFollow(x=>({...x,[p.memberId]:{...f,r:e.target.value}}))}/></div>
     <label className="check-label"><input type="checkbox" checked={f.d} onChange={e=>setFollow(x=>({...x,[p.memberId]:{...f,d:e.target.checked}}))}/> 추후 교육 완료</label> <button className="secondary" disabled={task.busy} onClick={()=>{void saveFollow(p.memberId);}}>교육 결과 저장</button></>:null}
   </div>;})}
   {confirm?null:<button className="primary" disabled={task.busy} onClick={review}>변경 내용 확인</button>}</div>:null}
  {scope&&confirm?<div className="card em-card"><h3>변경 내용 확인 · {scope.affiliation} · {kind==='화전단'?'화요전도단':'목요사명자교육'} {scope.date}</h3>
   {confirm.map(c=><p key={c.memberId} className="muted">{c.op==='register'?'공무 등록·수정':'공무 취소'} — {nameOf(c.memberId)}{c.reason?' : '+c.reason:''}</p>)}
   <button className="primary" disabled={task.busy} onClick={()=>{void save();}}>확인하고 저장</button> <button className="secondary" onClick={()=>setConfirm(null)}>다시 고치기</button></div>:null}
  {scope?<div className="card em-card"><h3>변경 이력</h3>{scope.history.length?scope.history.map(h=><p key={h.id} className="em-hist">{emHistoryText(h)}</p>):<p className="muted">아직 없어요.</p>}</div>:null}
 </>;
}

function Heads(){
 const {request}=useMember(),task=useAttendanceTask(),[data,setData]=useState<{affiliations:string[];heads:{memberId:string;name:string;affiliation:string}[]}|null>(null),[id,setId]=useState(''),[aff,setAff]=useState('');
 const load=()=>task.run(async()=>{const d=await request<NonNullable<typeof data>>('listEduDeptHeads',{});if(task.active()){setData(d);setAff(a=>a||d.affiliations[0]||'');}});
 const set=(op:'grant'|'revoke',memberId:string,affiliation:string)=>task.run(async()=>{await request('setEduDeptHead',{op,memberId:memberId.trim(),affiliation});const d=await request<NonNullable<typeof data>>('listEduDeptHeads',{});if(task.active()){setData(d);setId('');task.setNotice(op==='grant'?'부서장을 지정했어요.':'부서장 지정을 거두었어요.');}});
 // eslint-disable-next-line react-hooks/exhaustive-deps
 useEffect(()=>{void load();},[]);
 if(!data)return <><button className="secondary" disabled={task.busy} onClick={()=>{void load();}}>부서장 목록 불러오기</button><ErrorNote message={task.error}/></>;
 return <><p className="muted">24부서 소속별 부서장을 지정하면 그 사람은 자기 소속 사명자의 공무만 등록·수정·취소할 수 있어요.</p>
  <fieldset disabled={task.busy} className="att-form-row"><label>고유번호<input value={id} autoComplete="off" onChange={e=>setId(e.target.value)}/></label><label>소속<select value={aff} onChange={e=>setAff(e.target.value)}>{data.affiliations.map(a=><option key={a}>{a}</option>)}</select></label>
   <button className="secondary" onClick={()=>{void set('grant',id,aff);}}>지정</button></fieldset>
  <ErrorNote message={task.error}/>{task.notice?<p role="status">{task.notice}</p>:null}
  {data.heads.length?data.heads.map(h=><p key={h.memberId+h.affiliation} className="em-p">{h.affiliation} · <b>{h.name}</b> <button className="secondary" disabled={task.busy} onClick={()=>{void set('revoke',h.memberId,h.affiliation);}}>거두기</button></p>):<p className="muted">지정된 부서장이 없어요.</p>}</>;
}
