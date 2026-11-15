import {createHash} from 'node:crypto';
import {db,run,selectAll} from '../lib/db.js';
import {requireActor,AccessError} from '../lib/request-context.js';
import {educationGrants,permits,requireEducationScope} from '../lib/education-access.js';
import {isOwner} from './roster.js';
import {parseEduRoster,eduRosterDelta,eduNid} from '../../shared/edu-roster.mjs';
const fail=(message,status=400)=>{throw new AccessError(message,status);};
const clean=(v,max=120)=>{if(typeof v!=='string'||v.trim().length>max)fail('입력 내용을 확인해 주세요.');return v.trim();};
function policyOf(input,rows){
 if(input&&Array.isArray(input.alwaysPresent)&&Array.isArray(input.overrides)){
  const overrides={};for(const item of input.overrides){if(!item||typeof item.memberId!=='string'||Object.hasOwn(overrides,item.memberId))fail('분류 변경 대상이 중복되거나 잘못됐어요.');overrides[item.memberId]=item.dept;}
  input={...input,always_present_nids:input.alwaysPresent.map(r=>r?.memberId),dept_overrides:overrides};
 }
 if(!input||!Array.isArray(input.excluded_positions)||!Array.isArray(input.always_present_nids)||!input.dept_overrides||typeof input.dept_overrides!=='object'||Array.isArray(input.dept_overrides))fail('집계 기준을 확인해 주세요.');
 const ids=new Set(rows.map(r=>eduNid(r.member_id))),excluded_positions=[...new Set(input.excluded_positions.map(x=>clean(x,60)).filter(Boolean))];
 const always_present_nids=input.always_present_nids.map(x=>{if(!/^[0-9-]+$/.test(String(x)))fail('자동 참석 번호를 확인해 주세요.');return eduNid(x);});
 const dept_overrides={};for(const [id,dept]of Object.entries(input.dept_overrides)){if(!/^[0-9-]+$/.test(id)||dept_overrides[eduNid(id)])fail('분류 변경 번호를 확인해 주세요.');dept_overrides[eduNid(id)]=clean(dept,60);if(!dept_overrides[eduNid(id)])fail('분류할 부서를 입력해 주세요.');}
 if(excluded_positions.length>50||always_present_nids.length>1000||Object.keys(dept_overrides).length>1000)fail('집계 예외가 너무 많아요.');
 if([...always_present_nids,...Object.keys(dept_overrides)].some(id=>!ids.has(id)))fail('집계 예외 대상이 선택한 재적에 없어요. 명단과 예외를 함께 확인해 주세요.');
 const source_note=clean(input.source_note,500);if(!source_note)fail('집계 기준의 확인 근거를 적어 주세요.');
 return{excluded_positions,always_present_nids:[...new Set(always_present_nids)],dept_overrides,source_note};
}
async function context(body){
 const actor=requireActor(),seriesId=clean(body.seriesId,40);await requireEducationScope('series',seriesId,'view');
 const [series]=await run(db().from('attend_series').select('roster_key').eq('series_id',seriesId));
 const key=body.rosterKey==null?series.roster_key:clean(body.rosterKey,80),owner=isOwner(actor.nid);
 if(!owner&&key!==series.roster_key)fail('다른 재적 선택과 연결은 앱 관리자만 할 수 있어요.',403);
 const state=await run(db().rpc('edu_roster_admin_state',{p_series:seriesId,p_key:key}));if(!state.series)fail('정기 교육을 찾을 수 없어요.',404);
 const grants=await educationGrants(actor),linked=state.linked.length?state.linked:[state.series];
 const allowed=task=>permits(grants,'series',seriesId,task)&&linked.every(s=>permits(grants,'series',s.series_id,task));
 return{actor,owner,state,key,seriesId,allowed};
}
async function listEduRosterAdmin(){
 const actor=requireActor(),grants=await educationGrants(actor),rows=await selectAll(()=>db().from('attend_series').select('series_id,title,roster_key,summary_to').neq('status','삭제').order('id'));
 return{owner:isOwner(actor.nid),series:rows.filter(s=>permits(grants,'series',s.series_id,'view')&&['members','settings','reports'].some(p=>permits(grants,'series',s.series_id,p))).map(s=>({id:s.series_id,title:s.title,rosterKey:s.roster_key,mode:s.summary_to}))};
}
async function getEduRosterAdmin(body){
 const c=await context(body);if(!['members','settings','reports'].some(p=>c.allowed(p)))fail('연결된 교육의 재적·자료 권한을 확인해 주세요.',403);
 const history=await run(db().from('edu_roster_changes').select('id,kind,actor_name,source,after_summary,created_at').eq('roster_key',c.key).order('id',{ascending:false}).limit(20));
 const p=c.state.policy,policy=p?{excluded_positions:p.excluded_positions,alwaysPresent:p.always_present_nids.map(memberId=>({memberId})),overrides:Object.entries(p.dept_overrides).map(([memberId,dept])=>({memberId,dept})),source_note:p.source_note}:null;
 // 번호를 객체 키로 반환하지 않는다. 공통 번호 가림/복원은 memberId 값에 적용된다.
 return{key:c.key,series:{id:c.seriesId,title:c.state.series.title,rosterKey:c.state.series.roster_key,mode:c.state.series.summary_to},rows:c.state.rows.map(({member_id,name,dept,region,district,affiliation,position,sort_order})=>({memberId:eduNid(member_id),member_id,name,dept,region,district,affiliation,position,sort_order})),policy,linked:c.state.linked.map(s=>({id:s.series_id,title:s.title})),canImport:c.allowed('members'),canSettings:c.allowed('settings'),canLink:c.owner,history};
}
async function prepare(body){
 const c=await context(body),kind=body.kind;if(!['import','settings'].includes(kind))fail('변경 종류를 확인해 주세요.');
 if(!c.allowed(kind==='import'?'members':'settings'))fail('이 재적을 함께 쓰는 모든 교육의 해당 업무 권한이 필요해요.',403);
 if(!c.key)fail('재적 이름을 선택해 주세요.');
 const source=clean(body.source,120);if(!source)fail('파일명 또는 변경 이유를 적어 주세요.');
 let rows,policy,mode,summary;
 if(kind==='import'){
  if(!Array.isArray(body.rows)||body.rows.length>10000)fail('가져올 명단을 확인해 주세요.');
  const parsed=parseEduRoster(body.rows.map(r=>[0,r.dept,r.region,r.district,r.affiliation,r.member_id,r.name,r.position]));if(parsed.problems.length)fail(parsed.problems.slice(0,3).join(' '));rows=parsed.rows;
  if(c.state.policy)policyOf(c.state.policy,rows); // 명단 교체로 예외 대상이 조용히 사라지는 것을 막는다.
  summary=eduRosterDelta(c.state.rows,rows);
 }else{
  if(!c.state.rows.length)fail('재적 명단을 먼저 가져와 주세요.');mode=String(body.mode||'');if(!['live','room','test'].includes(mode))fail('보고 수신 범위를 골라 주세요.');
  if(!c.owner&&(c.key!==c.state.series.roster_key||mode!==c.state.series.summary_to))fail('재적 연결과 수신 범위 변경은 앱 관리자만 할 수 있어요.',403);
  policy=policyOf(body.policy,c.state.rows);summary={before:c.state.rows.length,after:c.state.rows.length,excluded:policy.excluded_positions,present:policy.always_present_nids.length,overrides:Object.keys(policy.dept_overrides).length,mode};
 }
 const review=createHash('sha256').update(JSON.stringify({revision:c.state.revision,key:c.key,kind,rows,policy,mode,source})).digest('hex');
 return{...c,kind,rows,policy,mode,source,summary,review};
}
async function previewEduRosterChange(body){const c=await prepare(body);return{review:c.review,summary:c.summary,linked:c.state.linked.map(s=>s.title),key:c.key};}
async function applyEduRosterChange(body){
 const c=await prepare(body);if(body.confirmed!==true||body.review!==c.review)fail('변경 내용을 다시 미리보고 확인해 주세요.',409);
 const summary=c.kind==='import'?{before:c.summary.before,after:c.summary.after,added:c.summary.added.length,removed:c.summary.removed.length,changed:c.summary.changed.length}:c.summary;
 const result=await run(db().rpc('edu_roster_apply_reviewed',{p:{seriesId:c.seriesId,key:c.key,kind:c.kind,revision:c.state.revision,rows:c.rows,policy:c.policy,mode:c.mode,source:c.source,summary,actorId:c.actor.nid,actorName:c.actor.name}}));if(result.error)fail(result.error,409);return result;
}
export default{listEduRosterAdmin,getEduRosterAdmin,previewEduRosterChange,applyEduRosterChange};
