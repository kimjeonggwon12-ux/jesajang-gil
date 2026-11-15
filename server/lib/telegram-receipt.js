import {createHash} from 'node:crypto';
import {db,run} from './db.js';

const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const botKey=()=>/^(\d+):/.exec(process.env.ATT_BOT_TOKEN||'')?.[1]||'attendance';
// 원문/연락처/봇 키를 저장하지 않는다. 처리 도중 실패한 요청은 자동 재실행하지 않는다.
export async function receiveTelegramUpdate(update,handle){
 if(!update||typeof update!=='object'||!Number.isSafeInteger(update.update_id)||update.update_id<0)return{status:400,body:{ok:false,error:'invalid_update'}};
 const bot_key=botKey(),update_id=update.update_id;
 const payload_hash=createHash('sha256').update(JSON.stringify(canonical(update))).digest('hex');
 const {error}=await db().from('telegram_update_receipts').insert({bot_key,update_id,payload_hash,status:'processing'});
 if(error){
  if(error.code!=='23505')throw Error('receipt_unavailable'); // 아직 업무 처리를 시작하지 않음: 재전달 가능
  const [old]=await run(db().from('telegram_update_receipts').select('status,payload_hash').eq('bot_key',bot_key).eq('update_id',update_id));
  const done=old?.status==='done'&&old.payload_hash===payload_hash;
  return{status:200,body:{ok:done,duplicate:true,...(!done?{needsReview:true}:{})}};
 }
 try{
  await handle(update);
  const rows=await run(db().from('telegram_update_receipts').update({status:'done',finished_at:new Date().toISOString()}).eq('bot_key',bot_key).eq('update_id',update_id).select('update_id'));
  if(rows.length!==1)throw Error('receipt_completion_missing');
  return{status:200,body:{ok:true}};
 }catch{
  // 저장/답장이 이미 일부 실행됐을 수 있다. 실패를 숨기지 않되 Telegram 재전달로 중복 실행하지 않는다.
  try{await run(db().from('telegram_update_receipts').update({status:'unknown',finished_at:new Date().toISOString()}).eq('bot_key',bot_key).eq('update_id',update_id));}catch{}
  console.log('교육 웹훅 확인 필요: '+bot_key+'/'+update_id);
  return{status:200,body:{ok:false,needsReview:true}};
 }
}
