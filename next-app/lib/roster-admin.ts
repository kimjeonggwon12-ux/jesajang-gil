export type AdminRecord = {name:string;dept:string;region:string;position:string;phone:string};
export type AdminAssignment = AdminRecord & {assignmentId:number};
export type RosterPerson = {rosterRevision?:string;memberId:string;name:string;dept:string;region:string;affiliation:string;position:string;note:string;tier:string;inRoster:boolean;admin:AdminRecord|null;admins?:AdminAssignment[]};
export type RosterLog = {at:string;actor:string;kind:string;targetId:string;targetName:string;before:Record<string,unknown>|null;after:Record<string,unknown>|null};
export const ROSTER_DEPTS=['교역자','자문회','장년회','부녀회','청년회','교육부','전도부','기타'];
export const ROSTER_REGIONS=[...Array.from({length:13},(_,i)=>String(i+1).padStart(2,'0')+'지역'),'새신자','유아모','기타'];
export const FIELD_LABELS={name:'이름',dept:'부서',region:'지역',affiliation:'소속',position:'직책',note:'비고',tier:'등급',phone:'연락처'};
export const displayId=(id:string)=>/^r_/.test(id)?'':id;
export function logDifference(row:RosterLog):string {
 if(['엑셀 반영','명단 되돌리기'].includes(row.kind)||/^교육생/.test(row.kind))return Object.entries(row.after||{}).filter(([key])=>key!=='스냅샷').map(([key,value])=>`${key} ${value}`).join(' · ');
 if(row.before&&row.after)return Object.entries(FIELD_LABELS).filter(([key])=>(row.before![key]||'')!==(row.after![key]||'')).map(([key,label])=>`${label}: ${row.before![key]||'(빈칸)'} → ${row.after![key]||'(빈칸)'}`).join(' / ');
 const value=row.after||row.before||{};return [value.dept,value.region,value.position].filter(Boolean).join(' · ');
}

export type RosterReview={review:string;mode:'create'|'update'|'remove';name:string;before:Record<string,string>|null;after:Record<string,string>|null};
