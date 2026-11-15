import {createHash} from 'node:crypto';
import {db,run} from './db.js';
import {str,normId} from './util.js';
import {sensitiveActor} from './sensitive-actor.js';
import {requireActor,AccessError} from './request-context.js';
import {isOwner,hasDuty} from '../actions/roster.js';
import {isSystemOwner} from './system-owner.js';
export const CENTER_MODES=Object.freeze({legacy_global:'기존 교육·전도 전체 승인',role_scoped:'직책별 부서·지역 승인'});
const SCOPED_DEPT=['회장','총무','총교관','서기','전도부장'];
const LEGACY_DEPT=['회장','총무','총교관','전도부장','교육부장','전도과장','전도 과장','전도팀장','서기'];
const compact=v=>str(v).replace(/\s/g,'');
function scopesOf(rows,strict){
 const scopes=[];
 for(const row of rows.filter(Boolean)){
  const dept=str(row.dept),region=str(row.region),p=str(row.position),role=compact(p);
  if(!dept||!p)continue;
  if(strict?SCOPED_DEPT.includes(role):LEGACY_DEPT.some(w=>p.includes(w)))scopes.push({dept,region:'',role:p});
  else if(region&&(strict?['지역장','복음방교관'].includes(role):p.includes('지역장')||p.includes('교관')))scopes.push({dept,region,role:p});
 }
 return scopes;
}
export async function centerAccess(memberId){
 const nid=normId(memberId),state=await run(db().rpc('center_scope_state',{p_nid:nid}));
 if(!state?.policy||!Object.hasOwn(CENTER_MODES,state.policy.mode))throw Error('센터 승인 기준을 불러오지 못했습니다.');
 const {teacher,admins,centers,policy}=state,roles=[teacher,...admins];
 const hq=isOwner(nid)||roles.some(r=>hasDuty(r,'교육')||hasDuty(r,'전도'));
 return {nid,teacher,hq,systemOwner:isSystemOwner(nid),approvalGlobal:isSystemOwner(nid)||policy.mode==='legacy_global'&&hq,
  scopes:scopesOf(roles,policy.mode==='role_scoped'),documentScopes:scopesOf(roles,true),centers,policy,state,
  canConfigure:isOwner(nid),name:str(teacher?.name||admins[0]?.name),position:str(admins.find(a=>a.position)?.position||teacher?.position)};
}
const covers=(scopes,r)=>scopes.some(s=>s.dept===r.dept&&(!s.region||s.region===r.region));
export const canApproveCenter=(acc,r)=>acc.approvalGlobal||covers(acc.scopes,r);
export const canReadCenter=(acc,r)=>acc.systemOwner||r.teacher_nid===acc.nid||covers(acc.documentScopes,r)||(r.status==='전달'&&acc.centers.includes(r.center_id));
export const canDecideCenter=acc=>acc.approvalGlobal||acc.scopes.length>0;
export const centerExpected=r=>Object.fromEntries(['id','status','dept','region','center_id','teacher_nid'].filter(k=>Object.hasOwn(r,k)).map(k=>[k,r[k]]));
export async function guardedReferral(acc,r,patch,extra={}){
 const identity=await sensitiveActor();
 return run(db().rpc('center_referral_apply',{p:{...identity,scopeState:acc.state,expected:centerExpected(r),operation:'write',patch,...extra}}));
}
const owner=()=>{const actor=requireActor();if(!isOwner(actor.nid))throw new AccessError('앱 관리자만 센터 승인 기준을 바꿀 수 있어요.');return actor;};
async function policy(){const [p]=await run(db().from('center_approval_policy').select('mode,version').eq('id',1).limit(1));if(!p)throw Error('센터 승인 기준이 없습니다.');return p;}
async function getCenterPolicy(){owner();const [current,history]=await Promise.all([policy(),run(db().from('center_policy_changes').select('changed_at,actor_name,before_mode,after_mode,reason,version').order('id',{ascending:false}).limit(30))]);return {policy:current,history,modes:CENTER_MODES};}
async function plan(body){
 owner();if(!Object.hasOwn(CENTER_MODES,body.mode))return {error:'승인 방식을 선택해 주세요.'};
 const reason=str(body.reason).slice(0,300);if(!reason)return {error:'변경 근거를 적어 주세요.'};
 const [current,identity]=await Promise.all([policy(),sensitiveActor()]);
 if(body.expectedVersion!==current.version)return {error:'승인 기준이 바뀌었어요. 다시 조회해 주세요.',stale:true};
 const request={...identity,expectedVersion:current.version,mode:body.mode,reason};
 return {request,before:current.mode,after:body.mode,reason,review:createHash('sha256').update(JSON.stringify(request)).digest('hex')};
}
async function previewCenterPolicy(body){const p=await plan(body);return p.error?p:{ok:true,before:p.before,after:p.after,reason:p.reason,review:p.review};}
async function saveCenterPolicy(body){const p=await plan(body);if(p.error)return p;if(body.confirmed!==true||!body.review)return {error:'변경할 승인 기준을 먼저 확인해 주세요.'};if(body.review!==p.review)return {error:'검토 내용이나 로그인이 바뀌었어요. 다시 확인해 주세요.',stale:true};return run(db().rpc('center_policy_apply',{p:p.request}));}
export default {getCenterPolicy,previewCenterPolicy,saveCenterPolicy};
