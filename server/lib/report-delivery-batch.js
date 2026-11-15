import {createHash,randomUUID} from 'node:crypto';
import {db,run} from './db.js';
import {kstDateTime} from './util.js';

const deliveryKey=({namespace,kind,ref,date,room},batch='auto')=>createHash('sha256').update(JSON.stringify([namespace,batch,kind,ref,date,room.chat_id])).digest('hex');
const legacyQuery=c=>db().from('cohort_summary_log').select('ref_id').eq('cohort_id',c.namespace).eq('kind',c.kind).eq('ref_id',c.ref).eq('date',c.date).limit(1);
export async function reportBatchState(c){
 if((await run(legacyQuery(c))).length)return 'legacy';
 const [row]=await run(db().from('edu_delivery_log').select('status').eq('delivery_key',deliveryKey(c)));
 return row?.status||'pending';
}
export async function reportBatchStates(contexts){
 if(!contexts.length)return [];
 const c=contexts[0];
 if(contexts.some(x=>x.namespace!==c.namespace||x.kind!==c.kind||x.date!==c.date))throw Error('같은 보고 묶음의 상태만 함께 조회할 수 있어요.');
 const keys=contexts.map(x=>deliveryKey(x));
 const [legacy,rows]=await Promise.all([
  run(db().from('cohort_summary_log').select('ref_id').eq('cohort_id',c.namespace).eq('kind',c.kind).eq('date',c.date).in('ref_id',contexts.map(x=>x.ref))),
  run(db().from('edu_delivery_log').select('delivery_key,status').in('delivery_key',keys)),
 ]);
 const done=new Set(legacy.map(x=>x.ref_id)),states=new Map(rows.map(x=>[x.delivery_key,x.status]));
 return contexts.map((x,i)=>done.has(x.ref)?'legacy':states.get(keys[i])||'pending');
}
async function completeLegacy(c){
 const {error}=await db().from('cohort_summary_log').insert({cohort_id:c.namespace,kind:c.kind,ref_id:c.ref,date:c.date,sent_at:kstDateTime()});
 if(error&&error.code!=='23505')throw Error('보고는 전달됐지만 완료 기록을 확인해야 해요. 자동으로 다시 보내지 않습니다.');
}
// 여러 메시지로 구성된 보고 전체를 한 번 주장한다. 일부만 전달된 경우도 재조합/자동 재전송하지 않는다.
// 기존 완료 기록은 존중하고, 새 완료 기록은 전송 응답과 DB 결과를 확인한 뒤 남긴다.
export async function deliverReportBatch(c,send,{manual=false,prepare}={}){
 if(!manual){const state=await reportBatchState(c);if(state==='legacy')return{ok:true,state};if(state==='sent'){await completeLegacy(c);return{ok:true,state};}if(state!=='pending')return{ok:false,state:'unknown'};}
 const prepared=await prepare?.();
 const key=deliveryKey(c,manual?randomUUID():'auto');
 const {error}=await db().from('edu_delivery_log').insert({delivery_key:key,meeting_id:c.ref,phase:c.kind,room_key:c.room.dept,part_no:0,mode:manual?'manual':'auto',status:'sending'});
 if(error){if(error.code!=='23505')throw Error('보고 전송 기록을 준비하지 못했어요.');return{ok:false,state:'unknown'};}
 try{
  await send(prepared);
  const saved=await run(db().from('edu_delivery_log').update({status:'sent',finished_at:new Date().toISOString()}).eq('delivery_key',key).select('delivery_key'));
  if(saved.length!==1)throw Error('보고 완료 기록 없음');
 }catch{
  await db().from('edu_delivery_log').update({status:'unknown',finished_at:new Date().toISOString()}).eq('delivery_key',key);
  return{ok:false,state:'unknown'};
 }
 if(!manual)await completeLegacy(c);
 return{ok:true,state:'delivered'};
}

// 예약 응답에는 성공과 확인 필요를 분리한다. 한 방 실패로 다른 방의 처리를 막지 않는다.
export async function runReportBatch(c,send,failures=[],options={}){
 let result;
 try{result=await deliverReportBatch(c,send,options);}catch{result={ok:false,state:'review'};}
 if(!result.ok)failures.push({scope:c.namespace,ref:c.ref,phase:c.kind,date:c.date,state:result.state});
 return result;
}
