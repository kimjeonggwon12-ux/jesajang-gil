'use client';
import {useEffect,useState} from 'react';
import ClassroomHeader from '../presentation/ClassroomHeader';
import ExcusedSelfCard from '../home/ExcusedSelfCard';
import ClassicTierProgress from '../presentation/ClassicTierProgress';
import ClassicPeople from '../presentation/ClassicPeople';
import ClassicRoomPrompt from '../presentation/ClassicRoomPrompt';
import ClassicAttention from '../presentation/ClassicAttention';
import ClassicPersonDetail from '../presentation/ClassicPersonDetail';
import ClassicContact from '../presentation/ClassicContact';
import {useRouter,useSearchParams} from 'next/navigation';
import {useMember} from '../MemberArea';
import {Counts,ErrorNote,Loading,Pager} from '../Ui';
import {useQuery} from '../../lib/use-query';
import {activityPeople,emptyActivity,editActivity,applyTarget,localDate,type Activity,type ActivitySummary,type ActivityForm,type Target,type ReportContext} from '../../lib/activities';
import {TARGET_STAGES_FALLBACK} from '../../lib/activity-report.mjs';
import type {TierStatus} from '../../lib/contracts';
import {maskName} from '../../lib/status-extra';
import {takeEntry} from '../../lib/entry-handoff';
import ActivityEditor from './ActivityEditor';
import ActivityList,{ActivityDetail} from './ActivityList';
import TargetEditor from './TargetEditor';
import TargetDetail from './TargetDetail';
import ActivityRoleSummary from './ActivityRoleSummary';
import DeleteActivityPerson from './DeleteActivityPerson';
export default function Activities(){
 const router=useRouter(),params=useSearchParams(),requestedTarget=params.get('target');
 const [deleting,setDeleting]=useState<{name:string;total:number;targetId?:string}|null>(null);
 const {session,access}=useMember(),[version,setVersion]=useState(0),[tab,setTab]=useState('people'),[name,setName]=useState<string|undefined>(),[filter,setFilter]=useState(''),[stage,setStage]=useState(''),[page,setPage]=useState(1),[notice,setNotice]=useState('');
 const summary=useQuery<ActivitySummary>('getMyActivities',{summary:true,aggregate:true,includeRecent:false,_revision:version}),targets=useQuery<{rows:Target[];stages:string[]}>('getMyTargets',{includeHistory:false,_revision:version}),tier=useQuery<TierStatus>('getMyTierStatus',{_revision:version});
 const [form,setForm]=useState<ActivityForm|null>(null),[detail,setDetail]=useState<number|null>(null),[targetDetail,setTargetDetail]=useState<string|null>(null),[editingTarget,setEditingTarget]=useState<Target|null|undefined>(undefined);
 const context:ReportContext={memberId:session.account.memberId,name:access.name,dept:tier.data?.dept||'',targets:targets.data?.rows||[],overview:summary.data?.overview,today:localDate()},ready=!!summary.data&&!!targets.data&&!!tier.data;
 useEffect(()=>{if(ready){const draft=takeEntry('activity',session.token);if(draft)setForm(draft);}},[ready,session.token]);
 function changed(message=''){setForm(null);setDetail(null);setTargetDetail(null);setEditingTarget(undefined);setDeleting(null);setVersion(v=>v+1);setNotice(message);setPage(1);}
 function record(target?:Target){const f=emptyActivity(context);if(target)applyTarget(f,target,context);setTargetDetail(null);setForm(f);}
 function edit(row:Activity){setDetail(null);setForm(editActivity(row,context));}
 useEffect(()=>{if(params.get('newTarget')==='1'&&ready){setEditingTarget(null);router.replace('/activities',{scroll:false});}},[params,ready,router]);
 useEffect(()=>{if(!requestedTarget||!targets.data)return;if(targets.data.rows.some(t=>t.targetId===requestedTarget))setTargetDetail(requestedTarget);else setNotice('현재 담당 범위에서 해당 대상자를 찾지 못했어요.');const rest=new URLSearchParams(params.toString());rest.delete('target');router.replace('/activities'+(rest.size?'?'+rest.toString():''),{scroll:false});},[requestedTarget,targets.data,params,router]);
 const people=activityPeople(summary.data?.overview,context.targets);
 const visiblePeople=people.filter(p=>(!filter||p.name.includes(filter))&&(!stage||p.stage===stage)),visibleTargets=context.targets.filter(t=>(!filter||t.targetName.includes(filter))&&(!stage||t.stage===stage)),peoplePages=Math.max(1,Math.ceil(visiblePeople.length/50)),current=Math.min(page,peoplePages),targetPages=Math.max(1,Math.ceil(visibleTargets.length/50)),targetPage=Math.min(page,targetPages),selected=context.targets.find(t=>t.targetId===targetDetail);
 if(params.get('view')==='attend')return <section id="sec-activity"><ClassroomHeader attend/><ExcusedSelfCard/></section>;
 return <section id="sec-activity"><ClassroomHeader/>
  {notice?<p className="notice" role="status">{notice}</p>:null}
  <ErrorNote message={summary.error} retry={summary.reload}/><ErrorNote message={targets.error} retry={targets.reload}/><ErrorNote message={tier.error} retry={tier.reload}/>{summary.loading||targets.loading||tier.loading?<Loading/>:null}
  {summary.data?<>{!name&&tab==='people'?<>
   <ClassicContact part="apply"/>
   {tier.data?<ClassicTierProgress tier={tier.data}/>:null}
   <ClassicAttention/>
   {people.length>50||filter||stage?<div className="classic-list-filters"><label>대상자 검색<input value={filter} onChange={e=>{setFilter(e.target.value);setPage(1);}}/></label><label>대상자 단계<select value={stage} onChange={e=>{setStage(e.target.value);setPage(1);}}><option value="">모든 단계</option>{TARGET_STAGES_FALLBACK.map(s=><option key={s}>{s}</option>)}</select></label></div>:null}
   <ClassicPeople roomPrompt={<ClassicRoomPrompt targets={context.targets} version={version}/>} people={people} disabled={!ready} visiblePeople={visiblePeople.slice((current-1)*50,current*50)} onOpen={person=>{setName(person.name);setTab('reports');}} onDelete={person=>setDeleting({name:person.name,total:person.total,targetId:person.target?.targetId})}/>
   {people.length>50||filter||stage?<div className="classic-list-filters"><Pager page={current} pages={peoplePages} total={visiblePeople.length} onPage={setPage}/></div>:null}
  </>:name!==undefined&&people.some(p=>p.name===name)?<ClassicPersonDetail key={name} person={people.find(p=>p.name===name)!} targets={context.targets} room={summary.data.reportRoom?.title||''} version={version} onBack={()=>{setName(undefined);setTab('people');}} onEdit={edit} onTarget={()=>setTargetDetail(people.find(p=>p.name===name)!.target!.targetId)} onChanged={()=>setVersion(v=>v+1)}/>:<div className="er-wrap"><button className="er-back" onClick={()=>setTab('people')}>‹ 섭외자 전체</button><ActivityList key={version} version={version} onOpen={setDetail}/></div>}
  {params.get('view')==='tools'?<details open className="classic-existing-tools"><summary>활동 기록·대상자 관리</summary>
   {targets.data?<ActivityRoleSummary summary={summary.data} targets={context.targets} stages={targets.data.stages} memberId={session.account.memberId} onTarget={setTargetDetail}/>:null}
   <details><summary>올해 역할별 활동 건수</summary><Counts values={summary.data.roleCounts}/>{Object.entries(summary.data.roleItemCounts).map(([role,counts])=><div key={role}><h3>{role}</h3><Counts values={counts}/></div>)}</details>
   <div className="toolbar"><button className="secondary" onClick={()=>{setName(undefined);setTab('reports');}}>전체 활동 기록</button><button className="secondary" disabled={!ready} onClick={()=>setEditingTarget(null)}>대상자 등록</button></div>
   <label>대상자 검색<input value={filter} onChange={e=>{setFilter(e.target.value);setPage(1);}}/></label><label>대상자 단계<select value={stage} onChange={e=>{setStage(e.target.value);setPage(1);}}><option value="">모든 단계</option>{TARGET_STAGES_FALLBACK.map(s=><option key={s}>{s}</option>)}</select></label>
   <div className="activity-cards">{visibleTargets.slice((targetPage-1)*50,targetPage*50).map(target=><button className="activity-card" key={target.targetId} onClick={()=>setTargetDetail(target.targetId)}><strong>{maskName(target.targetName)}</strong><span>{target.stage} · {target.completed?'관리 완료':'진행 중'}</span><span>다음 만남 {target.nextMeetingDate||'미정'} · 개강 목표 {target.goalCohort||'없음'}</span></button>)}</div>
   <Pager page={targetPage} pages={targetPages} total={visibleTargets.length} onPage={setPage}/>
  </details>:null}</>:null}
  <button type="button" className="act-fab" disabled={!ready} onClick={()=>record()} aria-label="새 보고 쓰기">✍️ 새 보고 쓰기</button>
  {deleting?<DeleteActivityPerson person={deleting} onClose={()=>setDeleting(null)} onDeleted={message=>{setName(undefined);setTab('people');changed(message);}}/>:null}
  {form?<ActivityEditor initial={form} context={context} room={summary.data?.reportRoom?.title||''} onClose={()=>setForm(null)} onSaved={changed}/>:null}
  {detail!==null?<ActivityDetail targetsReady={!!targets.data} targets={context.targets} id={detail} room={summary.data?.reportRoom?.title||''} onClose={()=>setDetail(null)} onEdit={edit} onChanged={()=>setVersion(v=>v+1)}/>:null}
  {editingTarget!==undefined?<TargetEditor target={editingTarget||undefined} onClose={()=>setEditingTarget(undefined)} onSaved={()=>changed('대상자 정보를 저장했어요.')}/>:null}
  {selected?<TargetDetail target={selected} stage={people.find(p=>p.target?.targetId===selected.targetId)?.stage||selected.stage} onClose={()=>{setTargetDetail(null);setVersion(v=>v+1);}} onEdit={()=>{setTargetDetail(null);setEditingTarget(selected);}} onRecord={()=>record(selected)} onDeleted={message=>{setName(undefined);setTab('people');changed(message);}}/>:null}
 </section>;
}
