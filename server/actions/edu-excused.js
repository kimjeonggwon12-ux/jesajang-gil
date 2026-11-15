import {createHash} from 'node:crypto';
import {db,run} from '../lib/db.js';
import {requireActor,AccessError} from '../lib/request-context.js';
import {educationGrants,permits} from '../lib/education-access.js';
const fail=(message,status=400)=>{throw new AccessError(message,status);};
async function context(body){
 const actor=requireActor(),kind=String(body.kind||''),date=String(body.date||'');
 if(!['화전단','목사교'].includes(kind)||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)fail('교육 종류와 날짜를 확인해 주세요.');
 const grants=await educationGrants(actor);
 if(grants!==null&&!grants.length)fail('교육 업무를 맡은 담당자만 조회할 수 있어요.',403);
 const state=await run(db().rpc('edu_excused_state',{p_kind:kind,p_date:date}));
 // 공무 선택은 같은 종류·날짜의 모든 보고에서 사용하므로 일부 교육 위임으로 전체를 바꾸지 않는다.
 const canRead=grants===null||(state.scopes.length>0&&state.scopes.every(s=>['attendance','reports'].some(task=>permits(grants,s.type,s.id,task))));
 if(!canRead)fail('함께 반영되는 모든 교육의 출석 또는 자료 업무 권한이 필요해요.',403);
 const canEdit=grants===null||(state.scopes.length>0&&state.scopes.every(s=>permits(grants,s.type,s.id,'attendance')));
 return{actor,kind,date,state,canEdit};
}
export async function getEduExcused(body){
 const c=await context(body),selected=new Set(c.state.selected),ids=new Set(c.state.people.map(p=>p.nid));
 return{kind:c.kind,date:c.date,revision:c.state.revision,canEdit:c.canEdit,scopes:c.state.scopes,
  people:c.state.people.map(p=>({memberId:p.nid,name:p.name,aff:p.affiliation,no:Number(p.district)||99,pos:p.position,on:selected.has(p.nid)})),
  unavailable:c.state.selected.filter(id=>!ids.has(id)).length};
}
async function prepare(body){
 const c=await context(body);if(!c.canEdit)fail('함께 반영되는 모든 교육의 출석 업무 권한이 필요해요.',403);
 if(body.revision!==c.state.revision)fail('명단이나 공무 선택이 바뀌었어요. 다시 조회해 주세요.',409);
 if(!Array.isArray(body.people)||body.people.length>10000)fail('공무 대상자를 확인해 주세요.');
 const ids=new Set(c.state.people.map(p=>p.nid)),nids=body.people.map(p=>p?.memberId);
 if(nids.some(id=>typeof id!=='string'||!ids.has(id))||new Set(nids).size!==nids.length)fail('명단에 없는 사람 또는 중복 선택이 있어요. 다시 확인해 주세요.');
 nids.sort();const reason=typeof body.reason==='string'?body.reason.trim():'';if(!reason||reason.length>500)fail('500자 이내로 변경 이유를 적어 주세요.');
 const review=createHash('sha256').update(JSON.stringify([c.actor.nid,c.state.revision,c.kind,c.date,nids,reason])).digest('hex');
 const before=new Set(c.state.selected),after=new Set(nids);
 return{...c,nids,reason,review,summary:{before:before.size,after:after.size,added:nids.filter(id=>!before.has(id)).length,removed:[...before].filter(id=>!after.has(id)).length}};
}
export async function previewEduExcused(body){const c=await prepare(body);return{review:c.review,summary:c.summary,scopes:c.state.scopes};}
export async function applyEduExcused(body){
 const c=await prepare(body);if(body.confirmed!==true||body.review!==c.review)fail('변경할 공무 명단과 날짜를 미리보고 확인해 주세요.',409);
 const result=await run(db().rpc('edu_excused_apply',{p:{kind:c.kind,date:c.date,revision:c.state.revision,nids:c.nids,reason:c.reason,actorId:c.actor.nid,actorName:c.actor.name}}));
 if(result.error)fail(result.error,409);return result;
}
export default{getEduExcused,previewEduExcused,applyEduExcused};
