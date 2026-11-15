import {ROLES,BASE_ITEMS,COOP_ITEMS,ROLE_ITEMS,type RegionSummary,activityAnalysis,roleBreakdown} from './status.ts';
export const TIER_ORDER=['휴교사','기타','활동교사','정교사','우수교사'];
const TIER_COLORS:Record<string,string>={'휴교사':'#9ca3af','기타':'#7c93b8','활동교사':'#4f46e5','정교사':'#059669','우수교사':'#d97706'};
const ACTIVITY_PALETTE=['#4f46e5','#0ea5e9','#059669','#d97706','#dc2626','#7c3aed','#db2777','#65a30d','#0891b2','#ea580c','#64748b'];
export const wholePercent=(count:number,total:number)=>total>0?Math.round(count/total*100):0;
export const regionLabel=(dept:string,region:string)=>region||(dept==='교역자'?'전체':dept||'전체');
export type PercentChartData={labels:string[];datasets:{label:string;backgroundColor:string;data:number[]}[]};
export function tierChart(dept:string,rows:RegionSummary[]):PercentChartData{
 return {labels:rows.map(row=>regionLabel(dept,row.region)),datasets:TIER_ORDER.map(tier=>({label:tier,backgroundColor:TIER_COLORS[tier],data:rows.map(row=>wholePercent(row.tierCounts[tier]||0,row.totalTeachers))}))};
}
export function activityChart(dept:string,analysis:ReturnType<typeof activityAnalysis>):PercentChartData{
 return {labels:analysis.regionStats.map(row=>row.region?regionLabel(dept,row.region):'(미상)'),datasets:analysis.types.map((type,index)=>({label:type,backgroundColor:ACTIVITY_PALETTE[index%ACTIVITY_PALETTE.length],data:analysis.regionStats.map(row=>wholePercent(row.counts[type]||0,row.total))}))};
}
type Breakdown=ReturnType<typeof roleBreakdown>;
export const roleItems=(role:string)=>role==='협력교사'?COOP_ITEMS:BASE_ITEMS;
// 표의 합계는 보이는 역할 항목만 센다. AI/전체 집계의 알 수 없는 항목까지 임의로 제거하지 않는다.
export function displayedRoleTotal(b:Breakdown,region:string,role:string){return roleItems(role).reduce((sum,item)=>sum+(b.counts[region]?.[role]?.[item]||0),0);}
export function strongItems(b:Breakdown){return [...b.allRegions].sort((a,c)=>a.localeCompare(c,'ko',{numeric:true})).map(region=>({region,items:ROLE_ITEMS.map(item=>({item,count:b.regionItemTotal[region]?.[item]||0})).filter(row=>row.count>0).sort((a,c)=>c.count-a.count).slice(0,3)}));}

// 기존 고정 12지역 시연 값. 실자료/교사 전체 현황과 별도로 사용한다.
export function sampleRoleBreakdown():Breakdown&{isSample:true}{
 const allRegions=Array.from({length:12},(_,i)=>`${i+1}지역`),strong=['섭외','친분','만남1','만남2','상담1','상담2','피드백','복음방','동행교사','센터소개','센터수강','친분'];
 const seed=(a:number,b:number,c:number,range:number)=>{const x=Math.sin(a*12.9898+b*78.233+c*37.719)*43758.5453;return Math.floor((x-Math.floor(x))*range);};
 const counts:Breakdown['counts']={},itemGrandTotal:Record<string,number>={},regionRoleTotal:Breakdown['regionRoleTotal']={},regionItemTotal:Breakdown['regionItemTotal']={};let grandTotal=0;
 allRegions.forEach((region,ri)=>{
  counts[region]={};regionRoleTotal[region]={};regionItemTotal[region]={};
  ROLES.forEach((role,roi)=>{
   counts[region][role]={};const factor=role==='교사'?1.3:role==='인도자'?1.1:1;
   roleItems(role).forEach((item,ii)=>{const count=Math.round((2+seed(ri,roi,ii,6)+(item===strong[ri]?10+seed(ri,roi,ii,6):0))*factor);counts[region][role][item]=count;itemGrandTotal[item]=(itemGrandTotal[item]||0)+count;grandTotal+=count;});
   regionRoleTotal[region][role]=Object.values(counts[region][role]).reduce((a,b)=>a+b,0);
  });
  ROLE_ITEMS.forEach(item=>{regionItemTotal[region][item]=ROLES.reduce((sum,role)=>sum+(counts[region][role][item]||0),0);});
 });
 return {counts,allRegions,regionRoleTotal,regionItemTotal,itemGrandTotal,grandTotal,isSample:true};
}
