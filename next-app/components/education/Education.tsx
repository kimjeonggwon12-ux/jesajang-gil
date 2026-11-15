'use client';
import Link from 'next/link';
import {useState} from 'react';
import {useRouter,useSearchParams} from 'next/navigation';
import {useMember} from '../MemberArea';
import {useQuery} from '../../lib/use-query';
import {ErrorNote,Loading} from '../Ui';
import {phaseOf,phaseText,type Cohort,type CourseDetail,type EducationAccess} from '../../lib/education';
import CourseSettings,{NewCourse} from './CourseSettings';
import CourseMembers from './CourseMembers';
import CourseTimetable from './CourseTimetable';
import CourseAttendance from './CourseAttendance';
import CourseAssignments from './CourseAssignments';
import CourseExams from './CourseExams';
import CourseReports from './CourseReports';
import EducationTelegram from './EducationTelegram';
import {Contact} from './EducationUi';
import AttendanceDelegation from '../attendance/AttendanceDelegation';
const TABS={timetable:'시간표',attendance:'출석',assignments:'과제',exams:'시험',reports:'자료·전달',members:'교육생',settings:'설정'};
type Tab=keyof typeof TABS;
export default function Education(){const {access}=useMember();return access.isAdmin?<Courses/>:<section className="panel"><h1>교육 과정 운영</h1><p>교육 운영을 맡은 관리자만 사용할 수 있어요.</p></section>;}
function Courses(){
 const router=useRouter(),params=useSearchParams(),id=params.get('course')||'',tab=(Object.hasOwn(TABS,params.get('tab')||'')?params.get('tab'):'timetable') as Tab,week=params.get('week')||'',q=useQuery<{cohorts:Cohort[]}>('cohortList',{},!id),access=useQuery<EducationAccess>('educationAccess'),[create,setCreate]=useState(false),[telegram,setTelegram]=useState(false),[search,setSearch]=useState(''),[phase,setPhase]=useState('active');
 const navigate=(course:string,section:Tab='timetable',w='')=>{const p=new URLSearchParams();if(course)p.set('course',course);if(course&&section!=='timetable')p.set('tab',section);if(w)p.set('week',w);router.push('/admin/education'+(p.size?'?'+p.toString():''));};
 const list=(q.data?.cohorts||[]).filter(c=>(c.title+' '+c.hostDept+' '+c.managerName).includes(search.trim())&&(phase==='all'||(phase==='done'?phaseOf(c)==='done':phaseOf(c)!=='done')));
 return <><div className="page-title"><div><p className="eyebrow">교육 운영</p><h1>교육 과정</h1><p className="muted">맡은 과정의 교육생과 일정을 관리하세요.</p></div><div className="edu-actions"><Link className="secondary" href="/admin/required-education">필수교육 이수 관리</Link><button className="secondary" onClick={()=>setTelegram(true)}>내 텔레그램 연결</button>{access.data?.owner?<button className="primary" onClick={()=>setCreate(true)}>새 교육 과정</button>:null}</div></div><ErrorNote message={access.error} retry={access.reload}/>
 {id?<Course key={id} id={id} tab={tab} week={week} onTab={t=>navigate(id,t,week)} onWeek={w=>navigate(id,tab,w)} onBack={()=>navigate('')} onRemoved={()=>{q.reload();navigate('');}}/>:<><div className="edu-row"><label>과정 검색<input type="search" value={search} onChange={e=>setSearch(e.target.value)}/></label><label>진행 상태<select value={phase} onChange={e=>setPhase(e.target.value)}><option value="active">진행·준비 중</option><option value="done">종료</option><option value="all">전체</option></select></label></div><ErrorNote message={q.error} retry={q.reload}/>{q.loading?<Loading/>:q.data?<><p>{list.length}개 과정</p><div className="edu-course-list">{list.map(c=><article className="panel" key={c.cohortId}><span className="eyebrow">{phaseText(c)}</span><h2><button className="text-button" onClick={()=>navigate(c.cohortId)}>{c.title}</button></h2><p>{c.startDate||'기간 미정'}{c.endDate?'~'+c.endDate:''} · {c.days||'매일'} {c.startTime}{c.endTime?'~'+c.endTime:''}</p><p>교육생 {c.memberCount||0}명 · {c.useAttend?'출석 사용':'출석 미사용'} · {c.useAssign?'과제 사용':'과제 미사용'}</p><Contact cohort={c}/><button className="secondary" onClick={()=>navigate(c.cohortId)}>교육 열기</button></article>)}</div>{!list.length?<p>이 범위에 교육 과정이 없어요. 담당 과정이 보이지 않으면 앱 관리자에게 위임을 확인해 주세요.</p>:null}</>:null}</>}
 {create?<NewCourse onClose={()=>setCreate(false)} onSaved={course=>{setCreate(false);q.reload();navigate(course,'settings');}}/>:null}{telegram?<EducationTelegram onClose={()=>setTelegram(false)}/>:null}</>;
}
function Course({id,tab,week,onTab,onWeek,onBack,onRemoved}:{id:string;tab:Tab;week:string;onTab:(t:Tab)=>void;onWeek:(w:string)=>void;onBack:()=>void;onRemoved:()=>void}){
 const q=useQuery<CourseDetail>('cohortDetail',{cohortId:id}),[memberView,setMemberView]=useState({search:'',limit:50}),[attendanceView,setAttendanceView]=useState({search:'',limit:50}),[assignmentView,setAssignmentView]=useState({search:'',limit:50}),[examView,setExamView]=useState({search:'',limit:50}),[delegation,setDelegation]=useState<{type:'cohort';id:string;title:string}|null>(null);
 return <><button className="text-button" onClick={onBack}>← 과정 목록</button><ErrorNote message={q.error} retry={q.reload}/>{q.loading?<Loading/>:q.data?<><section className="panel"><div className="edu-actions"><h2>{q.data.cohort.title}</h2><span>{phaseText(q.data.cohort,q.data.today)}</span>{q.data.canDelegate?<button className="secondary" onClick={()=>setDelegation({type:'cohort',id,title:q.data!.cohort.title})}>담당자 지정</button>:null}<button className="text-button" onClick={q.reload}>새로고침</button></div><Contact cohort={q.data.cohort}/><nav className="edu-tabs" aria-label="교육 업무">{Object.entries(TABS).map(([key,label])=><button key={key} aria-current={tab===key?'page':undefined} onClick={()=>onTab(key as Tab)}>{label}</button>)}</nav></section><div className="panel">{tab==='timetable'?<CourseTimetable data={q.data} week={week} onWeek={onWeek} onSaved={q.reload}/>:tab==='attendance'?<CourseAttendance data={q.data} onSaved={q.reload} view={attendanceView} onView={setAttendanceView}/>:tab==='assignments'?<CourseAssignments data={q.data} onSaved={q.reload} view={assignmentView} onView={setAssignmentView}/>:tab==='exams'?<CourseExams data={q.data} onSaved={q.reload} view={examView} onView={setExamView}/>:tab==='reports'?<CourseReports data={q.data}/>:tab==='members'?<CourseMembers data={q.data} onSaved={q.reload} view={memberView} onView={setMemberView}/>:<CourseSettings key={q.data.cohort.createdAt+q.data.cohort.cohortId} value={q.data.cohort} owner={q.data.canDelegate} canEdit={q.data.permissions.includes('settings')} onSaved={course=>course?q.reload():onRemoved()}/>}</div></>:null}{delegation?<AttendanceDelegation scope={delegation} onClose={()=>setDelegation(null)} onSaved={q.reload}/>:null}</>;
}
