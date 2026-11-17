'use client';
import {useState} from 'react';
import Link from 'next/link';
import {activityPeople,type Activity,type Target} from '../../lib/activities';
import {TARGET_FLOW,TARGET_FLOW_SHORT} from '../../lib/target-insights';
import {classicFlowStep,classicStageStyle} from '../../lib/classic-activity.mjs';
import {createReportTools} from '../../lib/activity-report.mjs';
import {maskName} from '../../lib/status-extra';
import ClassicActivityHistory from './ClassicActivityHistory';
import ClassicMasterFeedback from './ClassicMasterFeedback';
import ClassicMovingFeedback from './ClassicMovingFeedback';
import ActivityList from '../activities/ActivityList';
import TargetInsights from '../activities/TargetInsights';
import TargetCenter from '../centers/TargetCenter';
import CaseDraft from '../community/CaseDraft';
import CoachConversation from '../connect/CoachConversation';
type Person=ReturnType<typeof activityPeople>[number];
export default function ClassicPersonDetail({person,targets,room,version,onBack,onEdit,onTarget,onChanged}:{person:Person;targets:Target[];room:string;version:number;onBack:()=>void;onEdit:(row:Activity)=>void;onTarget:()=>void;onChanged:()=>void}){
 const [cell,setCell]=useState(''),[busy,setBusy]=useState(false),[caseDraft,setCaseDraft]=useState(false),[coach,setCoach]=useState<string|null>(null);
 const t=person.target,prof=t?.reportProfile||{},step=classicFlowStep(person.stage,prof.course),latest=person.latest,posted=latest?.tgPosts?.some(p=>p.kind==='post'),tools=createReportTools({});
 const lessons=(prof.lessons||[]).map(l=>typeof l==='string'?l:l.title).filter(Boolean),info=[t?.gender,t?.ageGroup,prof.age&&prof.age+'세',prof.faith,prof.recruitType&&'섭외 '+prof.recruitType].filter(Boolean).join(' · ');
 function choose(value:string){if(!busy)setCell(v=>v===value?'':value);}
 return <div className="er-wrap"><button type="button" className="er-back" disabled={busy} onClick={onBack}>‹ 섭외자 전체</button><div className="er-head"><span className="er-ava lg">{person.name.charAt(0)}</span><div className="er-head-m"><div className="er-head-n">{maskName(person.name)}{person.stage?<span className="er-st" style={classicStageStyle(person.stage)}>{person.stage}{person.stage==='센터수강'&&prof.course?' · '+prof.course:''}</span>:null}</div>{info?<div className="er-head-i">{info}</div>:null}{person.stage==='센터수강'&&tools.rpEnrollLine(prof)?<div className="er-head-i er-enroll">🎓 {tools.rpEnrollLine(prof)}</div>:null}</div></div>
  <div className="er-gauge"><div className="er-flow full" aria-label={'현재 단계 '+person.stage}>{TARGET_FLOW.map((label,i)=><i key={label} title={label} className={(i>=8?'c ':'')+(i<step?'done':i===step?'now':'')}/>)}</div><div className="er-flow-lb">{TARGET_FLOW_SHORT.map((label,i)=><span key={i} title={TARGET_FLOW[i]} className={(i>=8?'c ':'')+(i<step?'done':i===step?'now':'')}>{label}</span>)}</div>{step>=0?<div className="er-flow-now">지금 <b>{TARGET_FLOW[step]}</b> · {step+1}/{TARGET_FLOW.length}단계{step<TARGET_FLOW.length-1?' · 다음 '+TARGET_FLOW[step+1]:' · 🎉'}</div>:null}</div>
  {latest?<div className="er-head-r"><button className={'er-rep'+(posted?'':' warn')+(cell==='report'?' open':'')} disabled={busy} onClick={()=>choose('report')}>{posted?'📤 보고 완료':'⚠️ 미보고'}</button><button className="er-redo" disabled={busy} onClick={()=>onEdit(latest)}>✏️ 재보고</button>{t?<button className={'er-case-btn'+(['센터소개','센터수강'].includes(person.stage)?' hot':'')} disabled={busy} onClick={()=>setCaseDraft(true)}>✍️ 사례로 남기기</button>:null}</div>:null}
  <div className="er-cells">{t?<button className={'er-act ready'+(cell==='info'?' open':'')} disabled={busy} onClick={()=>choose('info')}><span className="er-act-i">🗂</span><b>정보 기록</b><span>기록하기</span></button>:null}<button className={'er-act '+(person.feedbackCount?'done':'ready')+(cell==='fb'?' open':'')} disabled={busy} onClick={()=>choose('fb')}><span className="er-act-i">📈</span><b>단계향상 피드백</b><span>{person.feedbackCount?`${person.feedbackCount}회 · 받음`:'받기'}</span></button>{t?<>
   <button className={'er-act ready'+(cell==='moving'?' open':'')} disabled={busy} onClick={()=>choose('moving')}><span className="er-act-i">💝</span><b>감동주기 방법</b><span>받기</span></button>
   <button className={'er-act off'+(cell==='hearts'?' open':'')} disabled={busy} onClick={()=>choose('hearts')}><span className="er-act-i">♡</span><b>HEARTS</b><span>상세피드백</span></button>
   <button className={'er-act ready'+(cell==='center'?' open':'')} disabled={busy} onClick={()=>choose('center')}><span className="er-act-i">📮</span><b>센터 보내기</b><span>{person.stage==='복음방'?'지역장 승인 요청':'복음방 아님 · 진행 상태 확인'}</span></button>
   <button className={'er-act '+(t.goalPlan?'done':'ready')+(cell==='plan'?' open':'')} disabled={busy} onClick={()=>choose('plan')}><span className="er-act-i">🧭</span><b>{t.goalCohort?Number(t.goalCohort.slice(5))+'월 ':''}개강 계획</b><span>{t.goalPlan?'설계 받음':t.goalCohort?'설계받기':'목표 정하기'}</span></button>
   <Link className="er-act ready" prefetch={false} href={'/rooms?target='+encodeURIComponent(t.targetId)} onClick={e=>{if(busy)e.preventDefault();}} aria-disabled={busy}><span className="er-act-i">💬</span><b>피드백방</b><span>초대·중요 정보</span></Link>
  </>:null}</div>
  {cell?<div className="er-open">{cell==='moving'&&t?<ClassicMovingFeedback targetId={t.targetId} onBusy={setBusy}/>:t&&['info','hearts','plan'].includes(cell)&&!(cell==='plan'&&person.stage==='센터수강')?<TargetInsights target={t} view={cell as 'info'|'hearts'|'plan'} busy={busy} onBusy={setBusy} onEdit={onTarget} onCoach={setCoach}/>:cell==='plan'&&person.stage==='센터수강'?<><div className="er-o-h">센터 수강 <span>{tools.rpEnrollLine(prof)||'개강·센터·기수를 아직 안 적었어요'}</span></div><div className="er-course">{['개강','초등','중등','고등','수료'].map((v,i)=><span key={v} className={i<step-8?'done':i===step-8?'now':''}>{v}</span>)}</div><div className="er-o-note">센터수강 기록을 남길 때 개강 월·수강 센터·기수·수강 과정을 고르면 여기와 단계 게이지가 바뀌어요.</div>{latest?<button className="er-o-main" onClick={()=>onEdit(latest)}>✏️ 최근 기록에서 수강 정보 고치기</button>:null}</>:cell==='center'&&t?<TargetCenter targetId={t.targetId} stage={person.stage} onBusy={setBusy}/>:latest&&['fb','report'].includes(cell)?<ClassicActivityHistory key={cell} kind={cell as 'fb'|'report'} name={person.name} latest={latest} targets={targets} room={room} onChanged={onChanged} onBusy={setBusy}/>:null}</div>:null}
  {t?<ClassicMasterFeedback targetId={t.targetId} feedbackCount={person.feedbackCount} total={person.total} onBusy={setBusy}/>:null}
  {t?<><div className="er-sec">📚 누적 교육 제목 <span>{lessons.length}</span></div><div className="er-ls">{lessons.length?<ol className="er-lessons">{lessons.map((l,i)=><li key={i}>{l}</li>)}</ol>:<div className="er-o-note">아직 없어요. 기록 양식의 &apos;누적 교육 제목&apos;에 적으면 여기에 그대로 보여요.</div>}{latest?<button className="er-ls-edit" disabled={busy} onClick={()=>onEdit(latest)}>✏️ 기록 양식에서 고치기</button>:null}</div></>:null}
  <div className="er-sec">🗂 교육 이력 <span>{person.total}회</span></div><ActivityList targetName={person.name} version={version} onOpen={()=>{}} inlineDetails={{targets,room,onEdit,onChanged}}/>
  {t?<details className="classic-person-tools"><summary>대상자 정보·담당자 이력</summary><button className="secondary" disabled={busy} onClick={onTarget}>정보 수정·담당자 일지·삭제</button></details>:null}
  {caseDraft&&t?<CaseDraft targetId={t.targetId} onClose={()=>setCaseDraft(false)}/>:null}{coach!==null?<CoachConversation text={coach} onClose={()=>setCoach(null)}/>:null}
 </div>;
}
