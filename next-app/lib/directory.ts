export const ORG_DEPTS=['교역자','자문회','장년회','부녀회','청년회','기타'];
export type Suggestion={suggestedTier:string;reason:string;approvalCount?:number;approvers?:string[]};
export type MonthStats=Partial<Record<'edu'|'counsel'|'gospel'|'family'|'companion'|'task'|'lead'|'teach'|'serve',number>>&{month?:string;tierRaw?:string};
export type Teacher={memberId:string;name:string;dept:string;region:string;affiliation:string;position:string;tier:string;note:string;tierChangedAt:string;
 regLeads:number|null;unregLeads:number|null;counsel:number;gospelRoom:number;companion:number;activeState:string;monthStats?:MonthStats|null;affilSel?:string;genderSel?:string;
 monthlyCount:number;leads1y:number;actTotal:number;actTypes:Record<string,number>;lastActivityDate:string;conditionText:string;suggestion:Suggestion|null;
 apply:{roles:string[];scheduleType:string;from:string;to:string;days:string[];times:string[];hours:string}|null;
 visits:number;lastVisit:string;card:boolean;cases:number;caseRank:number;groups:Record<string,number>;groupsMonth:Record<string,number>;groupsPrev:Record<string,number>;prevCount:number;attend1m:number};
export type Directory={rows:Teacher[];total:number;page:number;pages:number;limit:number;tiers:string[];regionsByDept:Record<string,string[]>;adminCount:number;pendingTotal:number};
export type DirectoryFilter={query:string;dept:string;region:string;adminOnly:boolean;tier:string;apply:string;pendingOnly:boolean;minLeads:number};
export const defaultDirectoryFilter:DirectoryFilter={query:'',dept:'',region:'',adminOnly:false,tier:'',apply:'',pendingOnly:false,minLeads:0};
export function directoryParams(filter:DirectoryFilter,page:number,limit:number){return {...filter,page,...(limit===0?{all:true}:{limit})};}
export function tierChanges(rows:Teacher[],tier:string,suggested:boolean){
 return rows.flatMap(row=>{const newTier=suggested?row.suggestion?.suggestedTier:tier;return newTier&&newTier!==row.tier?[{memberId:row.memberId,newTier,prevTier:row.tier,reason:suggested?row.suggestion?.reason||'':'최근 1년 센터 등록·활동 실적 기준 일괄 승인'}]:[];});
}
export function selectionAfterChange(selected:Map<string,Teacher>,changed:{memberId:string}[]){const next=new Map(selected);for(const row of changed)next.delete(row.memberId);return next;}
export function scheduleText(value:Teacher['apply']){if(!value)return '없음';return [value.roles?.join('·'),value.scheduleType==='직접'?[value.from,value.to].filter(Boolean).join(' ~ '):value.scheduleType,value.days?.join('·'),value.times?.join('·'),value.hours].filter(Boolean).join(' · ');}
