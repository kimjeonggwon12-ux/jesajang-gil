import type {Suggestion} from './directory';
export type Summary={totalTeachers:number;tierCounts:Record<string,number>;activeCount:number;monthlyActivityCount:number;promotionCount:number};
export type RegionSummary=Summary&{region:string;roleActivityCounts:Record<string,number>};
export type OrgSummary={asOf:string;month:string;totalTeachers:number;tierCounts:Record<string,number>;roleActivityCounts:Record<string,number>;orgs:(Summary&{dept:string;roleActivityCounts:Record<string,number>})[]};
export type DistrictTeacher={memberId:string;name:string;region:string;dept:string;tier:string;tierChangedAt:string;monthlyCount:number;lastActivityDate:string;conditionText:string;suggestion:Suggestion|null};
export type AnalysisRow={memberId:string;count:number;activities:string[];roles:string[]};
export type DistrictReport={asOf:string;month:string;dept:string;region:string;regions:string[];rows:DistrictTeacher[];total:number;summary:Summary;byRegion:RegionSummary[];roleActivityCounts:Record<string,number>;targetStageCounts:Record<string,number>;analysisRows?:AnalysisRow[]};
export type SettlementPerson={memberId:string;name:string;dept?:string;region?:string;currentTier?:string;tier?:string;suggestedTier?:string;reason?:string;lastActivityDate?:string;monthlyCount?:number;inactivity?:string;leadCount?:number;type?:string;coachApprover?:string;leaderApprover?:string;inactive?:boolean;noEdu?:boolean};
export type Settlement={asOf:string;month:string;promotionsTotal:number;demotionsTotal:number;inactiveTotal:number;inactiveWarn:number;inactiveDanger:number;pendingApprovalCount:number;centerLeadTotal?:number;details?:boolean;promotions?:SettlementPerson[];demotions?:SettlementPerson[];inactive?:SettlementPerson[];leaders?:SettlementPerson[];pendingApprovals?:SettlementPerson[]};
export type NonParticipant={memberId:string;name:string;dept:string;region:string;tier:string;inactive:boolean;noEdu:boolean;act:number;edu:number};
export type Participation={asOf:string;month:string;from:string;meetings:{date:string;title:string}[];depts:{dept:string;total:number;inactive:number;noEdu:number;both:number}[];rows?:NonParticipant[];details?:boolean};

export const ROLES=['인도자','교사','섬김이','협력교사'];
export const BASE_ITEMS=['피드백','섭외','친분','만남1','만남2','상담1','상담2','복음방','동행교사','센터소개','센터수강'];
export const COOP_ITEMS=['동아리','잎사귀','만남 동행','밭보기','육상담','부스담당','은사','멘토교사','동행교사','식구 복음방','전도 행사 지원'];
export const ROLE_ITEMS=BASE_ITEMS.concat(COOP_ITEMS.filter(item=>!BASE_ITEMS.includes(item)));
const ACTIVITY_ORDER=['전도 섭외','전도 대상자 만남','복음방 이전 상담 활동','상담 활동','상담 교육','복음방 교사 교육','동행 교사','피드백','선교센터 섬김이','선교센터 교사로 출석','선교센터 인도자'];
const dictionary=<T>()=>Object.create(null) as Record<string,T>;

// 기존 loadReport의 표시 순서. 응답 자체를 바꾸지 않아 집계/캐시와 분리한다.
export function orderedRegions<T extends {region:string}>(rows:T[]):T[]{
 return [...rows].sort((a,b)=>String(a.region||'').localeCompare(String(b.region||''),'ko',{numeric:true}));
}

// app.html의 buildActivityAnalysis와 같은 표시 집계. 번호를 보정하지 않고 응답 문자열 그대로 연결한다.
export function activityAnalysis(report:DistrictReport){
 const regionOf=dictionary<string>(),teacherCounts=dictionary<number>(),counts=dictionary<Record<string,number>>(),totals=dictionary<number>();
 for(const row of report.rows){regionOf[String(row.memberId).trim()]=row.region||'';teacherCounts[row.region||'']=(teacherCounts[row.region||'']||0)+1;}
 for(const row of report.analysisRows||[]){const region=regionOf[String(row.memberId).trim()];if(region===undefined)continue;
  for(const type of row.activities||[]){if(!type)continue;(counts[region]??=dictionary<number>())[type]=(counts[region][type]||0)+row.count;totals[region]=(totals[region]||0)+row.count;}}
 const seen=new Set<string>();Object.values(counts).forEach(values=>Object.keys(values).forEach(type=>seen.add(type)));
 const types=ACTIVITY_ORDER.filter(type=>seen.has(type)).concat([...seen].filter(type=>!ACTIVITY_ORDER.includes(type)));
 const regionStats=Object.keys(teacherCounts).map(region=>({region,total:totals[region]||0,teacherCount:teacherCounts[region],perTeacher:teacherCounts[region]?(totals[region]||0)/teacherCounts[region]:0,counts:counts[region]||{},grade:'-'})).sort((a,b)=>b.total-a.total);
 const ranked=[...regionStats].sort((a,b)=>b.perTeacher-a.perTeacher),positions=new Map(ranked.map((row,index)=>[row.region,index]));
 for(const row of regionStats){const rank=positions.get(row.region)!;row.grade=ranked.length<=1?'-':rank<ranked.length/3?'상':rank<ranked.length/3*2?'중':'하';}
 return {types,regionStats};
}
// 역할이 없는 옛 기록은 제외하고 중복 역할·활동 항목은 기존 표시식대로 센다.
export function roleBreakdown(report:DistrictReport){
 const regionOf=new Map(report.rows.map(row=>[String(row.memberId).trim(),row.region||'']));
 const counts=dictionary<Record<string,Record<string,number>>>(),itemGrandTotal=dictionary<number>();let grandTotal=0;
 for(const row of report.analysisRows||[]){const region=regionOf.get(String(row.memberId).trim());if(region===undefined)continue;
  for(const role of (row.roles||[]).filter(role=>ROLES.includes(role)))for(const item of row.activities||[]){if(!item)continue;counts[region]??=dictionary();counts[region][role]??=dictionary();counts[region][role][item]=(counts[region][role][item]||0)+row.count;itemGrandTotal[item]=(itemGrandTotal[item]||0)+row.count;grandTotal+=row.count;}}
 const allRegions=report.byRegion.map(row=>row.region),regionRoleTotal=dictionary<Record<string,number>>(),regionItemTotal=dictionary<Record<string,number>>();
 for(const region of allRegions){regionRoleTotal[region]=Object.fromEntries(ROLES.map(role=>[role,Object.values(counts[region]?.[role]||{}).reduce((a,b)=>a+b,0)]));regionItemTotal[region]=Object.fromEntries(ROLE_ITEMS.map(item=>[item,ROLES.reduce((n,role)=>n+(counts[region]?.[role]?.[item]||0),0)]));}
 return {counts,allRegions,regionRoleTotal,regionItemTotal,itemGrandTotal,grandTotal};
}
