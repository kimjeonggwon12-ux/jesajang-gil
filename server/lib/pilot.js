import {db,run} from './db.js';
import {isSystemOwner,systemOwnerNid} from './system-owner.js';
import {normId} from './util.js';
import {requireActor,AccessError} from './request-context.js';
import {sensitiveActor} from './sensitive-actor.js';
export const pilotEnabled=()=>process.env.PILOT_ROUTING_ENABLED==='1';
export const canManagePilot=isSystemOwner;
const operator=()=>{const a=requireActor();if(a.guest||!canManagePilot(a.nid))throw new AccessError('최종 책임자만 사용자 배정을 관리할 수 있어요.');return a;};
export async function pilotSite(actor,ownerView='B'){
 if(!pilotEnabled())return {site:'B',enabled:false};
 if(!actor||actor.guest)return {site:'common',enabled:true};
 if(isSystemOwner(actor.nid))return {site:ownerView==='A'?'A':'B',enabled:true,owner:true};
 if(process.env.PILOT_FORCE_A==='1')return {site:'A',enabled:true};
 const state=await run(db().rpc('site_pilot_route',{p_nid:actor.nid}));
 if(!['A','B'].includes(state?.site))throw Error('사용자 접속 설정을 불러오지 못했어요.');
 return {...state,enabled:true};
}
async function getPilotAdmin(body){
 operator();
 const page=Number.isInteger(body.page)&&body.page>=0&&body.page<=10000?body.page:0;
 const [policy,users,history,selectedCount]=await Promise.all([
  run(db().from('site_pilot_policy').select('enabled,version').eq('id',1).single()),
  run(db().rpc('site_pilot_search_assignable',{p_excluded_nid:systemOwnerNid(),p_query:String(body.query||'').slice(0,80),p_selected:body.selectedOnly===true,p_page:page,p_sort:['recent','visits','name'].includes(body.sort)?body.sort:'recent'})),
  run(db().from('site_pilot_changes').select('id,changed_at,actor_name,operation,targets,reason,version').order('id',{ascending:false}).limit(30)),
  db().from('site_pilot_members').select('*',{count:'exact',head:true}).neq('nid',systemOwnerNid()),
 ]);
 if(selectedCount.error)throw Error('배정 인원을 확인하지 못했어요.');
 users.rows=users.rows.map(row=>({...row,assignable:!isSystemOwner(row.memberId),selected:!isSystemOwner(row.memberId)&&row.selected}));
 return {policy,users,history,selectedCount:selectedCount.count,routingEnabled:pilotEnabled(),forceA:process.env.PILOT_FORCE_A==='1'};
}
async function savePilotAdmin(body){
 const actor=operator(),op=body.operation,ids=body.targetIds;
 if(!['start','stop','assign','remove'].includes(op)||body.confirmed!==true||!Number.isSafeInteger(body.expectedVersion))return {error:'변경 내용을 확인해 주세요.'};
 const reason=String(body.reason||'').trim();
 if(!reason||reason.length>300)return {error:'변경 사유를 1~300자로 입력해 주세요.'};
 if(!Array.isArray(ids)||ids.length>100)return {error:'변경할 사용자를 확인해 주세요.'};
 // 명단은 member_id의 원래 하이픈/공백/선행 0 표기를 반환한다. 허용한 구분자만
 // 제거해 검사한 뒤 기존 nid 규칙으로 정규화한다. 임의 문자까지 제거해 허용하지 않는다.
 const numbers=ids.map(x=>typeof x==='string'&&x.length<=80?x.replace(/[\s-]/g,''):null);
 if(numbers.some(x=>x===null||!/^\d{8,40}$/.test(x)||normId(x)==='0'))return {error:'선택한 사용자의 고유번호 형식을 확인해 주세요. 명단을 다시 조회해 주세요.'};
 const targetIds=[...new Set(numbers.map(normId))];
 if(targetIds.some(isSystemOwner))return {error:'최종 책임자는 사용자 배정 대상에서 제외됩니다. 본인 화면 선택을 이용해 주세요.'};
 if((['assign','remove'].includes(op)?!targetIds.length:targetIds.length))return {error:'변경할 사용자를 확인해 주세요.'};
 const identity=await sensitiveActor();
 return run(db().rpc('site_pilot_apply',{p:{...identity,operatorIds:[actor.nid],operation:op,targetIds,reason,expectedVersion:body.expectedVersion}}));
}
export default {getPilotAdmin,savePilotAdmin};
