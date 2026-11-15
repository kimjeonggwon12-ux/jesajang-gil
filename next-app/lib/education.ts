export type EducationTask='settings'|'members'|'schedule'|'attendance'|'assignments'|'exams'|'reports';
export type EducationAccess={owner:boolean;eligible:boolean;grants:{scope_type:string;scope_id:string;permissions:EducationTask[]}[];tasks:Record<string,string>;telegramLinked:boolean};
export type Cohort={cohortId:string;title:string;status:string;useAttend:boolean;useAssign:boolean;tgChat:string;createdAt:string;startDate:string;endDate:string;days:string;startTime:string;endTime:string;hostDept:string;managerName:string;managerPhone:string;memberCount?:number};
export type Student={seq:number;memberId:string;name:string;church:string;addedAt:string;attended:number;held:number;submitted:number;expected:number};
export type ClassMeeting={meetingId:string;title:string;date:string;start:string;end:string;status:string;count?:number};
export type ScheduleItem={itemId:string;date:string;start:string;end:string;title:string;sub:string;kind:string};
export type Absence={date:string;church:string;name:string;type:string;text:string;missed:string};
export type StudentSheet=Student&{attend:(string|null)[];daily:string[];perAssign:number[];scores:(number|null)[]};
export type Assignment={assignmentId:string;cohortId:string;title:string;guide:string;due:string;status:string;repeat:string;days:string;dates:string;dueTime:string;createdAt:string;repeatText:string;onToday:boolean;doneToday:number;doneAll:number;expectAll:number;dayCount:number};
export type Exam={examId:string;cohortId:string;subject:string;days:string;dates:string;date:string;dueTime:string;status:string;examText:string;onToday:boolean;doneToday:number};
export type Submission={assignmentId:string;memberId:string;name:string;content?:string;workDate:string;late:boolean;source:string;at:string;title?:string;church?:string};
export type AssignmentGrid={groups:{label:string;span:number}[];head:string[];headFill:string[];rows:(string|number)[][];cols:{date:string;id:string;color:string}[];foot:string;sub:string};
export type CourseSheet={cohort:Cohort;dates:string[];classDates:string[];rows:StudentSheet[];absences:Absence[];assignments:Assignment[];exams:{date:string;subject:string}[];assignGrid:AssignmentGrid|null;submissions?:Submission[]};
export type CourseDetail={cohort:Cohort;today:string;total:number;members:Student[];meetings:ClassMeeting[];heldCount:number;todayMeetings:ClassMeeting[];assignments:Assignment[];examRoutines:Exam[];exams:{date:string;subject:string;count:number;avg:number}[];permissions:EducationTask[];canDelegate:boolean;freeMeetings:ClassMeeting[];sheet:CourseSheet};
export const COURSE_DAYS=['월','화','수','목','금','토','일'];
export const SCHEDULE_KINDS=['교육','시험','과제','실습','활동','예배','식사','기타','주간메모'];
export const KIND_COLORS:Record<string,string>={교육:'#ffffff',시험:'#fde8e8',과제:'#fff4cc',실습:'#e8f0fe',활동:'#e3f6ef',예배:'#f1f1f1',식사:'#f1f1f1',기타:'#ffffff',주간메모:'#f6f2ff'};
export const educationToday=()=>new Date(Date.now()+9*3600e3).toISOString().slice(0,10);
export const shortDate=(d:string)=>String(d||'').slice(5).replace('-','/');
export const weekday=(d:string)=>'일월화수목금토'[new Date(d+'T00:00:00Z').getUTCDay()];
export const addDays=(d:string,n:number)=>{const v=new Date(d+'T00:00:00Z');v.setUTCDate(v.getUTCDate()+n);return v.toISOString().slice(0,10);};
export const mondayOf=(d:string)=>addDays(d,-((new Date(d+'T00:00:00Z').getUTCDay()+6)%7));
export const phaseOf=(c:Cohort,today=educationToday())=>c.status&&c.status!=='진행'?'done':!c.startDate?'prep':today<c.startDate?'soon':c.endDate&&today>c.endDate?'done':'live';
export const phaseText=(c:Cohort,today=educationToday())=>({done:c.status!=='진행'?c.status:'종료',prep:'준비 중',soon:'시작 전',live:'진행 중'})[phaseOf(c,today)];
export const emptyCohort=():Cohort=>({cohortId:'',title:'',status:'진행',useAttend:true,useAssign:true,tgChat:'',createdAt:'',startDate:'',endDate:'',days:'',startTime:'',endTime:'',hostDept:'',managerName:'',managerPhone:''});
export function parseStudents(text:string){return text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean).map(l=>{const p=l.split(/\t|,/).map(s=>s.trim()).filter(Boolean),index=p.findIndex(s=>s.replace(/\D/g,'').length>=5&&!/[가-힣]/.test(s)),memberId=index>=0?p.splice(index,1)[0]:'';return p.length>=2?{church:p[0],name:p[1],memberId}:{church:'',name:p[0]||'',memberId};});}
export function periodDates(c:Cohort,today=educationToday()){const from=c.startDate||today,to=c.endDate||addDays(from,27),out:string[]=[];for(let d=from;d<=to&&out.length<120;d=addDays(d,1))out.push(d);return out;}
export function courseWeeks(c:Cohort,items:ScheduleItem[],today=educationToday()){const weeks=new Set(items.map(i=>mondayOf(i.date)));if(c.startDate)for(let d=mondayOf(c.startDate);d<=(c.endDate||c.startDate);d=addDays(d,7))weeks.add(d);if(!weeks.size)weeks.add(mondayOf(today));return [...weeks].sort();}
export function timetable(c:Cohort,items:ScheduleItem[],week:string){
 const selected=items.filter(i=>i.date>=week&&i.date<=addDays(week,6)),days=Array.from({length:7},(_,i)=>({date:addDays(week,i),i})).filter(({date,i})=>((!c.startDate||date>=c.startDate)&&(!c.endDate||date<=c.endDate)&&(c.days?c.days.includes(weekday(date)):i<5))||selected.some(x=>x.date===date&&x.kind!=='주간메모')).map(x=>x.date);
 const timed=selected.filter(i=>i.start&&i.kind!=='주간메모'),allDay=selected.filter(i=>!i.start&&i.kind!=='주간메모'),memos=selected.filter(i=>i.kind==='주간메모'),times=[...new Set(timed.map(i=>i.start))].sort(),covered=new Set<string>();
 const rows=times.map((time,index)=>({time,end:timed.filter(i=>i.start===time&&i.end).map(i=>i.end).sort()[0]||'',cells:days.map(date=>{if(covered.has(date+'|'+index))return null;const here=timed.filter(i=>i.date===date&&i.start===time),end=here[0]?.end,span=end?1+times.filter((t,j)=>j>index&&t<end).length:1;for(let n=index+1;n<index+span;n++)covered.add(date+'|'+n);return {date,span,items:here};})}));
 return {days,rows,allDay,memos};
}
export const attendanceColumns=(s:CourseSheet,today:string)=>s.dates.map((date,index)=>({date,index})).filter(({date})=>s.classDates.includes(date)&&date<=today);
export const attendanceMark=(v:string|null)=>v==null?'':v==='출석'?'○':v||'×';
export function reorderStudents(members:Student[],index:number,step:number){const ids=members.map(m=>m.memberId),to=index+step;if(index<0||to<0||index>=ids.length||to>=ids.length)return ids;[ids[index],ids[to]]=[ids[to],ids[index]];return ids;}

export type EducationTableView={search:string;limit:number};
