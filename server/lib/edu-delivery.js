import {createHash,randomUUID} from 'node:crypto';
import {db,run} from './db.js';
import {AccessError} from './request-context.js';
import {sendRoomText,sendRoomBoardConfirmed} from './report-room.js';

const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
async function sendDoc(chat,bytes,fileName,caption){
  const [id,thread]=String(chat).split('/');
  for(const token of [process.env.ATT_BOT_TOKEN,process.env.TEACHERSQUARE_BOT_TOKEN].filter(Boolean)){
    const form=new FormData();form.set('chat_id',id);if(thread)form.set('message_thread_id',thread);
    form.set('caption',caption.slice(0,1000));form.set('parse_mode','HTML');
    form.set('document',new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),fileName);
    // 통신 오류의 실제 도착 여부는 불명확하다. 다른 봇으로 무작정 재전송하지 않는다.
    const response=await fetch(`https://api.telegram.org/bot${token}/sendDocument`,{method:'POST',body:form});
    const json=await response.json();if(response.ok&&json.ok)return;
  }
  throw Error('교육 파일 전달을 확인하지 못했어요.');
}
export async function sendEduPart(p,to,prefix=''){
  if(p.doc)return sendDoc(to.chat_id,p.doc,p.fileName,prefix+p.docCaption);
  if(p.caption)return sendRoomBoardConfirmed(to,p.png,prefix+p.caption,prefix+p.text);
  return sendRoomText(to.chat_id,prefix+p.text);
}

// 메시지 전달과 DB 기록 사이에는 외부 서비스 경계가 있다. 불명확한 결과는 자동 재시도하지 않는다.
export async function deliverEduParts(m,phase,parts,{testChat='',manual=false,prefix=''}={}){
  if(!parts.length)throw new AccessError('보낼 교육 보고가 없어요. 연결된 방과 보고 종류를 확인해 주세요.',409);
  const batch=manual?randomUUID():'auto',sent=[],failed=[],skipped=[],lastAt=new Map(),indices=new Map();
  const ordered=parts.map(p=>{const room=p.room.dept;const index=indices.get(room)||0;indices.set(room,index+1);return{p,index};});
  // 같은 방 안 순서를 유지하고 방들을 번갈아 처리한다. topic도 실제 chat 기준으로 간격을 지킨다.
  const queues=new Map();for(const item of ordered){const key=testChat||item.p.room.chat_id;if(!queues.has(key))queues.set(key,[]);queues.get(key).push(item);}
  const work=[];for(let i=0;[...queues.values()].some(q=>i<q.length);i++)for(const q of queues.values())if(i<q.length)work.push(q[i]);
  const legacy=new Map();
  for(const {p,index} of work){
    const room=p.room.dept,to=testChat?{...p.room,chat_id:testChat}:p.room,ref={room,part:index+1};
    if(!manual){
      // 이전 버전이 이미 완료 표시한 방은 새 기록 방식 도입만으로 다시 보내지 않는다.
      if(!legacy.has(room))legacy.set(room,(await run(db().from('cohort_summary_log').select('ref_id').eq('cohort_id','#edu-att').eq('kind',phase).eq('ref_id',(testChat?'test:':'')+room+'|'+m.meetingId).eq('date',m.date).limit(1))).length>0);
      if(legacy.get(room)){skipped.push({...ref,state:'legacy'});continue;}
    }
    const key=createHash('sha256').update(JSON.stringify([batch,m.meetingId,m.date,phase,room,to.chat_id,index])).digest('hex');
    const {error}=await db().from('edu_delivery_log').insert({delivery_key:key,meeting_id:m.meetingId,phase,room_key:room,part_no:index+1,mode:manual?'manual':'auto',status:'sending'});
    if(error){
      if(error.code!=='23505')throw new AccessError('전송 기록을 준비하지 못했어요. 실제 수신 상태를 확인해 주세요.',503);
      const [existing]=await run(db().from('edu_delivery_log').select('status').eq('delivery_key',key));
      if(existing?.status==='sent')skipped.push({...ref,state:'sent'});else failed.push({...ref,state:'확인 필요'});
      continue;
    }
    const chat=String(to.chat_id).split('/')[0],wait=(lastAt.get(chat)||0)+3200-Date.now();
    if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait));lastAt.set(chat,Date.now());
    const pre=prefix+(testChat?`🧪 <b>[시험]</b> 실제로는 → ${esc(p.room.title||room)} (${esc(room)})\n`:'');
    try{
      await sendEduPart(p,to,pre);
      const saved=await run(db().from('edu_delivery_log').update({status:'sent',finished_at:new Date().toISOString()}).eq('delivery_key',key).select('delivery_key'));
      if(saved.length!==1)throw Error('보고 완료 기록 없음');
      sent.push(ref);
    }catch{
      await db().from('edu_delivery_log').update({status:'unknown',finished_at:new Date().toISOString()}).eq('delivery_key',key);
      failed.push({...ref,state:'확인 필요'});
    }
  }
  return{ok:failed.length===0,sent,failed,skipped};
}
