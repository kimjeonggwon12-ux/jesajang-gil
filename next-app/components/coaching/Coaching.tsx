'use client';
import {useEffect,useState} from 'react';
import ClassicSectionHeader from '../presentation/ClassicSectionHeader';
import ClassicContact from '../presentation/ClassicContact';
import {useQuery} from '../../lib/use-query';
import type {CoachInfo} from '../../lib/coaching';
import {ErrorNote} from '../Ui';
import StudentCoaching from './StudentCoaching';
import TeacherCoaching from './TeacherCoaching';
import CoachRequests from './CoachRequests';
import CoachInbox from './CoachInbox';
type Tab='student'|'teacher'|'requests'|'inbox';
export default function Coaching(){const coach=useQuery<CoachInfo>('getMyCoach'),[tab,setTab]=useState<Tab>('student'),[visited,setVisited]=useState<Tab[]>(['student']),[revision,setRevision]=useState(0);function change(t:Tab){setTab(t);setVisited(v=>v.includes(t)?v:[...v,t]);}useEffect(()=>{const mode=new URLSearchParams(location.search).get('tab');if(mode==='requests'||mode==='teacher'||mode==='inbox')change(mode);},[]);return <section id="sec-ai"><ClassicSectionHeader title="AI상담"/>{tab==='inbox'&&coach.data&&!coach.data.isCoach?<p role="status">교관으로 배정된 담당자만 교관 모드를 이용할 수 있어요. 다른 상담 메뉴를 선택해 주세요.</p>:null}<ErrorNote message={coach.error} retry={coach.reload}/><nav className="l2" aria-label="상담 메뉴">{([['teacher','교사 코칭'],['student','수강생 단계향상'],['requests','교관에게 요청'],...(coach.data?.isCoach?[['inbox','교관 모드']]:[])] as [Tab,string][]).map(([key,label])=><button key={key} className={tab===key?'on':''} aria-pressed={tab===key} onClick={()=>change(key)}>{label}</button>)}</nav><ClassicContact part="edu"/><div id="aiBody"><div hidden={tab!=='student'}><StudentCoaching onEscalated={()=>setRevision(v=>v+1)}/></div>{visited.includes('teacher')?<div hidden={tab!=='teacher'}><TeacherCoaching onEscalated={()=>setRevision(v=>v+1)}/></div>:null}{visited.includes('requests')?<div hidden={tab!=='requests'}><CoachRequests coach={coach.data} revision={revision} active={tab==='requests'}/></div>:null}{visited.includes('inbox')&&coach.data?.isCoach?<div hidden={tab!=='inbox'}><CoachInbox/></div>:null}</div></section>;}
