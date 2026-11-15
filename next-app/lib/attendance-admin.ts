import {attendanceSessions,attendanceLabel,attendanceAnswer,type AttendanceMeeting,type AttendanceQuestion,type AttendanceRecord} from './attendance.ts';
export type AttendanceTask='attendance'|'reports';
export type AdminMeeting=AttendanceMeeting&{permissions:AttendanceTask[];count:number;createdAt:string;cohortId:string;seriesId:string;closesAt:string;opensAt:string};
export type AttendSeries={seriesId:string;title:string;weekdays:number[];slots:{start:string;end:string}[];place:string;openBefore:number;questions:AttendanceQuestion[];org:string;district:string|number|null;askDistrict:boolean;askDept:boolean;status:string;permissions:AttendanceTask[];todayOn:boolean;next:string};
export type AttendAdmin={canCreate:boolean;meetings:AdminMeeting[];records:AttendanceRecord[];series:AttendSeries[]};
export type AttendPerson={name:string;dept:string;position:string;memberId:string;n:number;last:string};
export const WEEKDAYS=['일','월','화','수','목','금','토'];
export const MEETING_ORGS=['','전체','교역자','자문','장년','부녀','청년','기타'];
export const DEPARTMENT_OPTIONS=['교역자','자문회','장년회','부녀회','청년회'];
export const attendanceNow=()=>new Date(Date.now()+9*3600e3).toISOString().slice(0,16).replace('T',' ');
export const seriesWhen=(x:AttendSeries)=>'매주 '+x.weekdays.map(d=>WEEKDAYS[d]).join('·')+' '+x.slots.map(t=>t.start+'~'+t.end).join(' · ');
export function meetingState(m:AdminMeeting,now=attendanceNow()){if(m.status==='집계완료')return '집계 완료';if(m.status==='닫힘')return '마감';if(m.open)return '출석 받는 중';return now>m.closesAt?'끝남':'예정';}
export function attendancePeople(meetings:AdminMeeting[],records:AttendanceRecord[],today=attendanceNow().slice(0,10)){
 const ids=new Set(meetings.map(m=>m.meetingId)),by=new Map<string,AttendPerson>();
 for(const r of records){if(!ids.has(r.meetingId))continue;const key=String(r.memberId).replace(/\D/g,'').replace(/^0+/,'')||r.memberId;let p=by.get(key);if(!p){p={name:r.name,dept:r.dept,position:r.position,memberId:r.memberId,n:0,last:''};by.set(key,p);}p.n++;if(r.at>p.last)p.last=r.at;}
 return {rows:[...by.values()].sort((a,b)=>b.n-a.n||a.name.localeCompare(b.name,'ko')),total:meetings.filter(m=>m.date<=today).length};
}
export function attendanceTallies(m:AdminMeeting,records:AttendanceRecord[]){
 const count=(values:string[],initial:string[]=[])=>{const map=new Map(initial.map(v=>[v,0]));for(const value of values)map.set(value,(map.get(value)||0)+1);return [...map].map(([label,count])=>({label,count}));};
 const tallies=m.questions.filter(q=>q.type!=='text').map(q=>({title:q.label+(records.some(r=>r.additionalRecords?.length)?' · 타임별 응답':''),values:count(records.flatMap(attendanceSessions).flatMap(r=>{const v=r.answers[q.id];return Array.isArray(v)?v:v?[v]:[];}),q.options)}));
 if(m.askDistrict&&records.length)tallies.push({title:'내 지역',values:count(records.map(r=>attendanceLabel({org:r.pickOrg,district:r.pickDistrict})||'미선택'))});
 if(m.askDept&&records.length)tallies.push({title:'24부서',values:count(records.map(r=>r.dept24||'미선택'))});
 return {departments:count(records.map(r=>r.dept||'(미등록)')),tallies};
}
export const sortedAttendance=(records:AttendanceRecord[])=>records.slice().sort((a,b)=>a.at<b.at?-1:1);
export function meetingCsvRows(m:AdminMeeting,records:AttendanceRecord[]){return [['모임 부서·지역','이름','고유번호','부서','직책','출석시각','출석 상태',...(m.askDistrict?['내 지역']:[]),...(m.askDept?['24부서']:[]),...m.questions.map(q=>q.label)],...sortedAttendance(records.filter(r=>r.meetingId===m.meetingId).flatMap(attendanceSessions)).map(r=>[attendanceLabel(m),r.name,r.memberId,r.dept,r.position,r.at,r.late||'',...(m.askDistrict?[attendanceLabel({org:r.pickOrg,district:r.pickDistrict})]:[]),...(m.askDept?[r.dept24||'']:[]),...m.questions.map(q=>attendanceAnswer(r.answers[q.id]))])];}
export function peopleCsvRows(meetings:AdminMeeting[],records:AttendanceRecord[],today?:string){const {rows,total}=attendancePeople(meetings,records,today);return [['이름','고유번호','부서','직책','출석횟수','전체모임','출석률(%)','마지막출석'],...rows.map(r=>[r.name,r.memberId,r.dept,r.position,r.n,total,total?Math.round(r.n/total*100):0,r.last])];}
export function attendanceCsv(rows:(string|number)[][]){const cell=(v:string|number)=>{let text=String(v??'');if(/^[\s]*[=+@-]/.test(text)||/^[\t\r]/.test(text))text="'"+text;return /[",\r\n]/.test(text)?'"'+text.replaceAll('"','""')+'"':text;};return '\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n');}
export function downloadAttendance(name:string,data:Blob|string){const url=URL.createObjectURL(typeof data==='string'?new Blob([data],{type:'text/csv;charset=utf-8'}):data),link=document.createElement('a');link.href=url;link.download=name.replace(/[\\/:*?"<>|]/g,'_');document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export type AttendanceForm={meetingId?:string;seriesId?:string;title:string;date:string;place:string;openBefore:number;status:string;org:string;district:string;askDistrict:boolean;askDept:boolean;slots:{start:string;end:string}[];weekdays:number[];questions:(AttendanceQuestion&{optionsText:string;key:string})[]};
export function attendanceForm(value:AdminMeeting|AttendSeries|null,repeat:boolean):AttendanceForm{
 const meeting=value&&'meetingId'in value?value:null,series=value&&'seriesId'in value&&'weekdays'in value?value:null;
 return {meetingId:meeting?.meetingId,seriesId:series?.seriesId,title:value?.title||'',date:meeting?.date||attendanceNow().slice(0,10),place:value?.place||'',openBefore:value?.openBefore??30,status:value?.status||'열림',org:value?.org||'',district:value?.district==null?'':String(value.district),askDistrict:value?.askDistrict??true,askDept:value?.askDept??false,slots:value?(value.slots.length>1||series?value.slots.map(t=>({...t})):[{start:meeting?.start||'',end:meeting?.end||''}]):Array.from({length:repeat?2:1},()=>({start:'',end:''})),weekdays:series?.weekdays.slice()||[],questions:(value?.questions||[]).map((q,i)=>({...q,optionsText:q.options.join(', '),key:'old'+i}))};
}
export function attendanceFormBody(f:AttendanceForm){const slots=f.slots.filter(s=>s.start||s.end);return {...f,start:slots[0]?.start||'',end:slots.at(-1)?.end||'',slots,district:/^\d+$/.test(f.district)?Number(f.district):f.district,questions:f.questions.filter(q=>q.label.trim()).map(({key,optionsText,...q})=>({...q,options:optionsText.split(/[,，\n]/).map(v=>v.trim()).filter(Boolean)}))};}
