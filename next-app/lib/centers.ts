export type CenterStaff={memberId:string;name:string;role:string;key?:string};
export type Center={id:number;name:string;cohortNo:string;openMonth:string;openDate:string;staff:CenterStaff[];memo:string;active:boolean;label:string;received?:number};
export type Referral={canReadDocument?:boolean;id:number;targetId:string;targetName:string;teacherId:string;teacherName:string;dept:string;region:string;stage:string;status:string;requestNote:string;hopeCenter:string;requestedAt:string;decidedBy:string;decidedAt:string;decideNote:string;sentBy:string;sentAt:string;sendNote:string;centerId:number|null;centerLabel:string;centerReadAt:string;assigneeId:string;assigneeName:string};
export type CenterDeskData={me:{name:string;position:string;hq:boolean;approvalGlobal:boolean;canConfigure:boolean;scopes:{dept:string;region:string;role:string}[];centers:number[];canDecide:boolean};policy:CenterPolicy;rows:Referral[];inbox:Referral[];centers:Center[];staffRoles:string[]};
export type Snapshot={builtAt?:string;basis?:string;target?:{name?:string;gender?:string;ageGroup?:string;stage?:string;createdAt?:string;goalCohort?:string;goalPlan?:string;profile?:{age?:string;faith?:string;recruitType?:string;phone4?:string;center?:string;enroll?:string;cohortNo?:string;course?:string;lessons?:string[]}};teacher?:{name?:string;dept?:string;region?:string;affiliation?:string;tier?:string};master?:{at:string;text:string};sections?:Partial<Record<'info'|'acts'|'history'|'coaching'|'notes',string[]>>};
export type ReferralDocument={row:Referral;snapshot:Snapshot|null};
export type CenterResult={ok?:boolean;done?:number;skipped?:number;notGospel?:string[];center?:string;moved?:number};
export const CENTER_ORGS=['교역자','자문회','장년회','부녀회','청년회'];
export const centerOrg=(r:{dept:string})=>CENTER_ORGS.find(o=>String(r.dept||'').includes(o.replace('회','')))||'기타';
export const centerName=(c:Pick<Center,'name'|'cohortNo'>)=>[c.name,c.cohortNo].filter(Boolean).join(' ');
export const centerMonth=(c:Pick<Center,'openMonth'|'openDate'>)=>c.openDate?c.openDate.slice(5).replace('-','/')+' 개강':c.openMonth?Number(c.openMonth.slice(5))+'월 개강':'개강일 미정';
export const referralRows=(rows:Referral[],tab:string)=>rows.filter(r=>tab==='waiting'?['요청','승인'].includes(r.status):r.status===(tab==='sent'?'전달':'반려'));
export const documentLines=(raw:string[]=[])=>raw.filter(l=>!/^\-?\s*\(?없음\)?$/.test(String(l).trim()));
export const referralMatches=(r:Referral,q:string)=>(r.targetName+' '+r.teacherName+' '+r.dept+' '+r.region).includes(q.trim());

export type CenterPolicy={mode:'legacy_global'|'role_scoped';version:number};
