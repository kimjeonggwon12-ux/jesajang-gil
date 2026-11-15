import type {DistrictTeacher,OrgSummary,SettlementPerson} from './status';
export const PARTICIPATION_DEPTS=['교역자','자문회','장년회','부녀회','청년회'];
export const TOP_DEPTS=['자문회','장년회','부녀회','청년회'];
export const ASPECTS=['만남','상담','복음방','센터인도','종합'];
export type RegionRank={region:string;dept?:string;count:number};
export type TopRegions={byAspect:Record<string,RegionRank[]>;isSample:boolean;byRole?:{role:string;topRegion:string;topDept:string;totalCount:number;topItem:string;isSample:boolean}[]};
export type CenterLead={memberId:string;name:string;date:string;leadName:string;registeredBy:string};
export type Distribution={year:number;total:number;stages:{stage:string;count:number}[]};
export const ITEM_LABELS:Record<string,string>={'피드백':'섭외자피드백','섭외':'섭외찾기(전단지)','만남1':'만남','센터수강':'센터수강생관리','동아리':'동호회활동','동행교사':'동행 복음방'};
export function participationRows(report:OrgSummary){return PARTICIPATION_DEPTS.map(dept=>{const row=report.orgs.find(r=>r.dept===dept);return {dept,total:row?.totalTeachers||0,active:row?.activeCount||0};});}
export function participationTitle(month:string){const [year,m]=month.split('-');return `${year?Number(year)+'년 ':''}${m?Number(m)+'월 ':''}부서별 참여 현황`;}
export const percent=(n:number,total:number)=>total>0?Math.round(n/total*1000)/10:0;
export function monthlyMvp(rows:DistrictTeacher[]){const top=rows.reduce<DistrictTeacher|null>((best,row)=>!best||row.monthlyCount>best.monthlyCount?row:best,null);return top?.monthlyCount?top:null;}
export function maskName(value:string){const text=String(value||'').trim();return text.length<=1?text:text.length===2?text[0]+'*':text[0]+'*'.repeat(text.length-2)+text.at(-1);}
export const transition=(row:SettlementPerson)=>`${row.currentTier} → ${row.suggestedTier}`;
export function leadMonths(rows:CenterLead[]){return [...new Set(rows.flatMap(row=>row.date&&row.date.length>=7?[row.date.slice(0,7)]:[]))].sort().reverse();}
export function monthlyLeaders(rows:CenterLead[],month:string){
 const selected=rows.filter(row=>row.date&&row.date.startsWith(month)),people:Record<string,{memberId:string;name:string;count:number}>=Object.create(null);
 for(const row of selected){const key=String(row.memberId).trim(),person=people[key]||{memberId:row.memberId,name:row.name,count:0};person.count++;people[key]=person;}
 return {total:selected.length,people:Object.values(people).sort((a,b)=>b.count-a.count)};
}
