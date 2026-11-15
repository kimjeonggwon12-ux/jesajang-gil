import {createHash} from 'node:crypto';
import {requireMeetingTask} from '../lib/education-access.js';
import {AccessError} from '../lib/request-context.js';
import {findMeeting} from './attendance.js';
import {eduFor,eduPreview,validEduPhase,testChat,jungjinKindFor,jungjinPreview} from '../lib/edu-attendance.js';
import {deliverEduParts} from '../lib/edu-delivery.js';

export const eduText=text=>String(text||'').replace(/<\/?(?:b|i|u|s)>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
async function context(body){
  const id=String(body.meetingId||'');await requireMeetingTask(id,'reports');
  const m=await findMeeting(id);if(!m)throw new AccessError('모임을 찾을 수 없어요.',404);
  const audience=String(body.audience||'education');
  if(!['education','jungjin'].includes(audience))throw new AccessError('보고 대상을 골라 주세요.',400);
  const ordinary=await eduFor(m),kind=await jungjinKindFor(m),audiences=[...(ordinary?['education']:[]),...(kind?['jungjin']:[])];
  if(audience==='education'&&!ordinary)return{m,edu:null,jungjinAvailable:!!kind};
  const phase=validEduPhase(body.phase),preview=audience==='jungjin'?await jungjinPreview(m,phase):await eduPreview(m,phase,ordinary);
  if(!preview)throw new AccessError('중진 보고 대상 교육을 골라 주세요.',400);
  const edu=audience==='jungjin'?preview.edu:ordinary;
  // 실제 개인 자료는 서버에만 두고 미리보기 이후 재적/집계/수신 대상 변경을 검출한다.
  const revision=createHash('sha256').update(JSON.stringify({audience,phase,series:edu.series,policy:edu.policy,people:preview.P.people,outside:preview.P.outside,summary:preview.C,rooms:preview.parts.map(p=>[p.room.dept,p.room.chat_id,p.part,p.text,p.docCaption])})).digest('hex');
  return{m,edu,phase,...preview,revision,audience,audiences};
}
async function getEduAttendanceReport(body){
  const c=await context(body);if(!c.edu)return{enabled:false,jungjinAvailable:c.jungjinAvailable};
  return{enabled:true,audience:c.audience,audiences:c.audiences,meetingId:c.m.meetingId,title:c.m.title,rosterKey:c.edu.series.roster_key,mode:c.edu.series.summary_to,phase:c.phase,sessions:c.P.sessions,summary:c.C,outside:c.P.outside.length,revision:c.revision,
    parts:c.parts.map((p,i)=>({id:i,room:p.room.dept,title:p.room.title||p.room.dept,part:p.part||'명단',type:p.doc?'excel':p.caption?'image':'text',text:eduText(p.docCaption||p.text),fileName:p.fileName||''}))};
}
async function getEduAttendanceAsset(body){
  const c=await context(body);if(!c.edu)throw new AccessError('별도 재적이 연결된 교육을 골라 주세요.',400);
  if(body.revision!==c.revision)throw new AccessError('집계나 수신 대상이 바뀌었어요. 미리보기를 다시 확인해 주세요.',409);
  const p=c.parts[Number(body.partId)];if(!p)throw new AccessError('보고 자료를 골라 주세요.',400);
  if(p.doc)return{type:'excel',fileName:p.fileName,base64:p.doc.toString('base64')};
  if(p.png)return{type:'image',base64:p.png.toString('base64')};
  return{type:'text',text:eduText(p.text)};
}
async function sendEduAttendanceReport(body){
  const c=await context(body);if(!c.edu)throw new AccessError('별도 재적이 연결된 교육을 골라 주세요.',400);
  if(body.confirmed!==true)throw new AccessError('교육·집계 시간·받는 방을 확인해 주세요.',400);
  if(body.revision!==c.revision)throw new AccessError('집계나 수신 대상이 바뀌었어요. 미리보기를 다시 확인해 주세요.',409);
  return deliverEduParts(c.m,c.phase,c.parts,{manual:true,testChat:c.edu.series.summary_to==='test'?testChat():''});
}
export default {getEduAttendanceReport,getEduAttendanceAsset,sendEduAttendanceReport};
