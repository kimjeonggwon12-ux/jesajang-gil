// 개강 피드백의 조직 담당 범위. 명시한 최종 책임자 외의 관리자는 기존 담당 범위를 유지한다.
import {isSystemOwner} from './system-owner.js';
import {db,run,selectAll} from './db.js';
import {normId,str} from './util.js';
export const COUNSEL_STAGES=['상담1','상담2','복음방','센터소개','센터수강'];
const DEPT_ROLES=['회장','총무','총교관','서기','전도부장'];
const REGION_ROLES=['지역장','교관','섭외교관','복음방교관'];
export async function roomScopes(memberId){
 if(isSystemOwner(memberId))return [{systemOwner:true}];
 const nid=normId(memberId);
 const [[teacher],admins]=await Promise.all([
  run(db().from('teachers').select('dept,region,position').eq('nid',nid).order('sort_order').order('member_id').limit(1)),
  selectAll(()=>db().from('admins').select('dept,region,position').eq('nid',nid).order('id')),
 ]);
 return [teacher,...admins].filter(Boolean).flatMap(row=>{
  const dept=str(row.dept),region=str(row.region),position=str(row.position).replace(/\s/g,'');
  if(!dept)return [];
  if(DEPT_ROLES.includes(position))return [{dept,region:''}];
  return region&&REGION_ROLES.includes(position)?[{dept,region}]:[];
 });
}
export const roomScopeCovers=(scopes,teacher)=>scopes.some(s=>s.systemOwner)||!!teacher&&scopes.some(s=>s.dept===teacher.dept&&(!s.region||s.region===teacher.region));
export async function roomTeachers(targets){
 const nids=[...new Set(targets.map(t=>t.creator_nid).filter(Boolean))],out=new Map();
 for(let i=0;i<nids.length;i+=150){
  const rows=await selectAll(()=>db().from('teachers').select('nid,member_id,dept,region').in('nid',nids.slice(i,i+150)).order('sort_order').order('member_id'));
  for(const row of rows)if(!out.has(row.nid))out.set(row.nid,row);
 }
 return out;
}
export const isRoomManager=(target,scopes,teacher)=>scopes.some(s=>s.systemOwner)||COUNSEL_STAGES.includes(str(target.stage))&&roomScopeCovers(scopes,teacher);
// 초대 뒤 구버전이 관리자 역할로 바꾼 행은 초대 근거를 보존한다. 이전 담당/자동 관리자 행 자체는 권한이 아니다.
export const explicitlyInvited=member=>!!member&&(member.role==='초대'||member.role==='관리자'&&!!str(member.invited_by));
export const ownsRoom=(target,nid)=>[target.creator_nid,target.leader_nid,target.helper_nid].some(n=>n&&n===normId(nid));
export const mayReadRoom=(target,member,nid,manager,guest=false)=>!!target&&(guest?explicitlyInvited(member):isSystemOwner(nid)||ownsRoom(target,nid)||manager||explicitlyInvited(member));
