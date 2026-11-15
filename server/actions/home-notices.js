// 홈 알림은 본문/사진 없이 기존 판정에 필요한 번호·시각·건수만 반환한다.
import {db,run,selectAll} from '../lib/db.js';
import {requireActor} from '../lib/request-context.js';
import {kstDateTime,fmtTs,normId} from '../lib/util.js';
import marks from './new-marks.js';
import chat from './chat.js';
import centers from './center-send.js';
import calendar from './calendar.js';
async function getNoticeIndex(body){
 const actor=requireActor(),nid=actor.nid;
 const [newMarks,connect,center,posts,ads,events,replies,encouragements]=await Promise.all([
  marks.getNewMarks(body),chat.getConnectUnread(body),centers.getCenterSendBadge(body),
  run(db().from('plaza_posts').select('id,category,member_id,created_at').neq('status','삭제').order('created_at',{ascending:false}).order('id',{ascending:false}).limit(30)),
  calendar.getCalendarAds({}),
  selectAll(()=>db().from('calendar_events').select('id,event_id,category').order('id')),
  selectAll(()=>db().from('feedbacks').select('id,receipt_no').eq('nid',nid).in('source',['교관요청','사람에스컬레이션']).eq('status','완료').neq('handler_answer','').order('id')),
  db().from('encouragements').select('id',{count:'exact',head:true}).eq('to_nid',nid).eq('is_read',false),
 ]);
 if(encouragements.error)throw Error('격려 알림을 읽지 못했어요.');
 return{at:kstDateTime(),marks:newMarks,connect,center,encouragements:encouragements.count||0,
  posts:posts.map(p=>({category:p.category,createdAt:fmtTs(p.created_at),isMine:normId(p.member_id)===nid})),
  ads:ads.rows.map(a=>({updatedAt:a.updatedAt})),official:events.filter(e=>!['부서','내일정'].includes(e.category)).map(e=>e.event_id).filter(Boolean),
  replies:replies.map(r=>r.receipt_no)};
}
export default{getNoticeIndex};
