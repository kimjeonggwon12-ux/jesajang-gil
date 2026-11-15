import {db} from '../lib/db.js';
import {requireActor,AccessError} from '../lib/request-context.js';
import {isOwner} from './roster.js';

// 전체 방에 걸친 운영 기록이다. 과정 위임·Telegram 방 관리자에게 권한을 확대하지 않는다.
async function getDeliveryReview(body){
  if(!isOwner(requireActor().nid))throw new AccessError('전달 확인 기록은 앱 관리자만 볼 수 있어요.');
  const source=body.source||'reports',page=Number(body.page??1),pageSize=50;
  if(!['reports','webhooks'].includes(source)||!Number.isSafeInteger(page)||page<1||page>100000)throw new AccessError('조회할 종류와 쪽을 확인해 주세요.',400);
  const query=source==='reports'
    ?db().from('edu_delivery_log').select('meeting_id,phase,room_key,part_no,mode,status,created_at,finished_at',{count:'exact'}).in('status',['sending','unknown']).order('created_at',{ascending:false}).order('delivery_key')
    :db().from('telegram_update_receipts').select('bot_key,update_id,status,received_at,finished_at',{count:'exact'}).in('status',['processing','unknown']).order('received_at',{ascending:false}).order('bot_key').order('update_id');
  let {data,error,count}=await query.range((page-1)*pageSize,page*pageSize-1);
  // 처리 완료로 마지막 쪽이 사라질 수 있다. 범위 오류만 총계로 재확인하고 나머지 실패는 숨기지 않는다.
  if(error?.code==='PGRST103'){
    const table=source==='reports'?'edu_delivery_log':'telegram_update_receipts',states=source==='reports'?['sending','unknown']:['processing','unknown'];
    const checked=await db().from(table).select('status',{count:'exact',head:true}).in('status',states);
    if(!checked.error&&checked.count!==null&&(page-1)*pageSize>=checked.count){data=[];count=checked.count;error=null;}
  }
  if(error||count===null)throw Error('전달 확인 기록을 읽지 못했어요. 다시 확인해 주세요.');
  return{source,page,pageSize,total:count,hasMore:page*pageSize<count,rows:data,checkedAt:new Date().toISOString()};
}
export default {getDeliveryReview};
