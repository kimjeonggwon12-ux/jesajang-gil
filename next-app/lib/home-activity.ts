import type {ActivitySummary,Target} from './activities.ts';
import type {TierStatus} from './contracts.ts';
export const ACTIVITY_ROLES=['인도자','교사','섬김이','협력교사'] as const;
export type ActivityRole=typeof ACTIVITY_ROLES[number];
export const ROLE_LABEL:Record<ActivityRole,string>={'인도자':'인도','교사':'교사','섬김이':'섬김','협력교사':'협력'};
// 본인 번호의 공백/0 보정은 유지하되 타인의 가림 참조를 숫자로 재구성하지 않는다.
export function sameMember(a:string|undefined,b:string){if(!a||!b)return false;if(a===b)return true;return /^[\d\s-]+$/.test(a)&&/^[\d\s-]+$/.test(b)&&a.replace(/\D/g,'').replace(/^0+/,'')===b.replace(/\D/g,'').replace(/^0+/,'');}
export function targetsByActivityRole(summary:ActivitySummary,targets:Target[],memberId:string){
 const names=new Map<string,Set<string>>();
 for(const row of summary.overview.names){if(!row.name)continue;const roles=names.get(row.name)||new Set<string>();for(const role of row.roles)roles.add(role);names.set(row.name,roles);}
 const result:Record<ActivityRole,Target[]>={'인도자':[],'교사':[],'섬김이':[],'협력교사':[]};
 for(const target of targets){if(target.completed)continue;const roles=new Set(names.get(target.targetName)||[]);if(sameMember(target.leaderId,memberId))roles.add('인도자');if(sameMember(target.helperId,memberId))roles.add('섬김이');for(const role of ACTIVITY_ROLES)if(roles.has(role))result[role].push(target);}
 return result;
}
export function growthConditions(tier:TierStatus){
 const rows:{label:string;count:number;goal:number;description:string}[]=[];
 if(!tier.nextTier)return rows;
 if(tier.tier==='휴교사')rows.push({label:'이번 달 내 활동 기록',count:tier.recentRecords||0,goal:tier.activeGoal||4,description:`이번 달 ${tier.activeGoal||4}건 기록하면 바로 활동교사`});
 if(tier.leadGoal!==null)rows.push({label:'센터 인도(등록)',count:tier.leadCount||0,goal:tier.leadGoal,description:`최근 1년 ${tier.leadGoal}명 이상`});
 if(tier.tier==='활동교사')rows.push({label:'이번 달 활동 기록',count:tier.recentRecords||0,goal:tier.activeGoal||4,description:`매달 ${tier.activeGoal||4}건 이상(4건 미만이면 다음 달 휴교사)`});
 return rows;
}
