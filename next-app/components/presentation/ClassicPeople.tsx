'use client';
import type {ReactNode} from 'react';
import {activityPeople} from '../../lib/activities';
import {maskName} from '../../lib/status-extra';
import {relativeActivityTime,classicStageStyle,classicFlowStep} from '../../lib/classic-activity.mjs';
import ClassicIcon from './ClassicIcon';
type Person=ReturnType<typeof activityPeople>[number];
const flow=['섭외','친분','만남1','만남2','상담1','상담2','복음방','개강 준비','개강','초등','중등','고등','수료'];
export default function ClassicPeople({people,visiblePeople=people,disabled=false,roomPrompt,onOpen,onDelete}:{people:Person[];visiblePeople?:Person[];disabled?:boolean;roomPrompt:ReactNode;onOpen:(person:Person)=>void;onDelete:(person:Person)=>void}){
 const total=people.reduce((n,p)=>n+p.total,0),sent=(stage:string)=>stage==='센터소개'||stage==='센터수강';
 return <div className="er-wrap"><section className="er-hero"><h2 className="er-hero-t">내 활동 보고</h2><div className="er-hero-s">{roomPrompt}</div><div className="er-hero-n"><span><b>{people.length}</b>명</span><span><b>{total}</b>번 기록</span><span><b>{people.filter(p=>sent(p.stage)).length}</b>명 센터</span></div></section>
 {!people.length?<div className="gl-empty">아직 기록한 섭외자가 없어요.<br/>오른쪽 아래 <b>＋</b> 버튼으로 첫 기록을 남기면 여기에 칸이 생겨요.</div>:!visiblePeople.length?<p className="gl-empty">조건에 맞는 대상자가 없어요.</p>:<div className="er-grid">{visiblePeople.map(p=>{const step=classicFlowStep(p.stage,p.target?.reportProfile?.course);return <article className={'er-tile'+(sent(p.stage)?' sent':'')} key={p.name}><button className="classic-people-open" onClick={()=>onOpen(p)} aria-label={maskName(p.name)+' 활동 보고'}><span className="er-ava">{p.name.charAt(0)}</span><span className="er-nm">{maskName(p.name)}</span>{p.stage?<span className="er-st" style={classicStageStyle(p.stage)}>{p.stage}{p.stage==='센터수강'&&p.target?.reportProfile?.course?' · '+p.target.reportProfile.course:''}</span>:null}<span className="er-flow full" aria-label={'현재 단계 '+p.stage}>{flow.map((label,i)=><i key={label} title={label} className={(i>=8?'c ':'')+(i<step?'done':i===step?'now':'')}/>)}</span><span className="er-ct"><b>{p.total}</b>회 기록{p.edu?' · 교육 '+p.edu+'회':''}</span>{p.latest&&!p.latest.tgPosts?.some(post=>post.kind==='post')?<span className="er-un">미보고</span>:null}<span className="er-dt">{relativeActivityTime(p.last)}</span>{sent(p.stage)?<span className="er-badge">✍️ 사례</span>:null}</button><button type="button" className="er-del" disabled={disabled} title="이 섭외자 삭제" aria-label={maskName(p.name)+' 기록 삭제'} onClick={()=>onDelete(p)}><ClassicIcon name="delete"/></button></article>;})}</div>}
 </div>;
}
