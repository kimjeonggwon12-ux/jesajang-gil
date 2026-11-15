// 1:1 채팅 + 안 읽은 알림 수
import { db, run, selectAll } from '../lib/db.js';
import { normId, str, kstDateTime, fmtTs, sameId } from '../lib/util.js';
import { findTeacher } from './roster.js';
import { AccessError, requireActor } from '../lib/request-context.js';

function requireParticipant(chatId) {
  const ids = chatId.split('__');
  const actor = requireActor();
  if (ids.length !== 2 || ids.some((id) => !id) || !ids.some((id) => sameId(id, actor.memberId))) {
    throw new AccessError('참여한 대화만 열 수 있어요.');
  }
}

/** 두 사람의 대화방 번호(누가 먼저 보내든 같다). */
const chatIdOf = (a, b) => [str(a), str(b)].sort().join('__');

/** 내가 보냈거나 받은 메시지 전부. */
async function myMessages(me) {
  const nid = normId(me);
  const rows = await selectAll(() => db().from('chat_messages').select('*')
    .or(`from_nid.eq.${nid},to_nid.eq.${nid}`).order('id'));
  return rows.filter((m) => sameId(m.from_id, me) || sameId(m.to_id, me));
}

async function sendMessage(body) {
  const fromId = str(body.fromId);
  const toId = str(body.toId);
  const message = str(body.message);
  if (!fromId || !toId) return { error: 'fromId, toId 가 필요합니다.' };
  if (!message) return { error: '메시지 내용이 필요합니다.' };
  if (sameId(fromId, toId)) return { error: '본인에게는 보낼 수 없습니다.' };
  const chatId = chatIdOf(fromId, toId);
  const now = kstDateTime();
  await run(db().from('chat_messages').insert({ chat_id: chatId, from_id: fromId, to_id: toId, message, sent_at: now }));
  return { ok: true, chatId, sentAt: now };
}

const messageRow = m => ({ id: m.id, fromId: m.from_id, toId: m.to_id, message: m.message, sentAt: fmtTs(m.sent_at), read: m.is_read });
function cursor(value) {
  if (value == null || value === '') return 0;
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value)<0) throw new AccessError('대화 위치를 확인해 주세요.',400);
  return Number(value);
}

/** 새 화면: 최근 50개·ID 증분·이전 페이지. 옛 화면의 전체/시각 조회 계약은 유지한다. */
async function getMessages(body) {
  const chatId = str(body.chatId).split('__').map((x) => x.trim()).sort().join('__');   // 11/6: 앱이 가린 번호로 만든 방 번호 → 원래 번호 순서로
  if (!chatId) return { error: 'chatId 가 필요합니다.' };
  requireParticipant(chatId);
  const afterId=cursor(body.afterId), beforeId=cursor(body.beforeId);
  if(body.afterId!=null && body.beforeId!=null)throw new AccessError('대화 위치를 하나만 지정해 주세요.',400);
  const build=()=>db().from('chat_messages').select('id, from_id, to_id, message, sent_at, is_read').eq('chat_id',chatId);
  if(body.paged===true || body.afterId!=null || body.beforeId!=null) {
    const limit=Math.min(100,Math.max(1,Number.isFinite(Number(body.limit)) ? Math.trunc(Number(body.limit)) || 50 : 50));
    const forward=body.afterId!=null;
    let query=build().order('id',{ascending:forward});
    if(forward)query=query.gt('id',afterId);
    if(beforeId)query=query.lt('id',beforeId);
    const data=await run(query.limit(limit+1));
    const page=data.slice(0,limit);if(!forward)page.reverse();
    return {rows:page.map(messageRow),hasMore:data.length>limit,nextCursor:page.at(-1)?.id||afterId,olderCursor:page[0]?.id||beforeId};
  }
  const after=String(body.after||'');
  if(after && !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}$/.test(after))throw new AccessError('대화 시각을 확인해 주세요.',400);
  const data=await selectAll(()=>{let q=build().order('id');return after?q.gt('sent_at',after):q;});
  return { rows:data.map(messageRow).sort((a,b)=>a.sentAt.localeCompare(b.sentAt)||a.id-b.id) };
}

/** 내 대화방 목록: 상대 정보, 마지막 메시지, 안 읽은 수(최근 대화가 위). */
async function getChatList(body) {
  const me = str(body.memberId);
  if (!me) return { error: 'memberId 가 필요합니다.' };
  const byChat = new Map();
  for (const m of await myMessages(me)) {
    if (!m.chat_id) continue;
    const fromMe = sameId(m.from_id, me);
    if (!byChat.has(m.chat_id)) {
      byChat.set(m.chat_id, { chatId: m.chat_id, otherId: fromMe ? m.to_id : m.from_id, lastMessage: '', lastAt: '', unreadCount: 0 });
    }
    const chat = byChat.get(m.chat_id);
    const sentAt = fmtTs(m.sent_at);
    if (sentAt >= chat.lastAt) { chat.lastMessage = m.message; chat.lastAt = sentAt; }
    if (sameId(m.to_id, me) && !m.is_read) chat.unreadCount++;
  }

  const chats = [...byChat.values()];
  const otherNids = [...new Set(chats.map((c) => normId(c.otherId)))];
  const [teachers, profiles] = otherNids.length ? await Promise.all([
    run(db().from('teachers').select('nid, name, dept, region').in('nid', otherNids)),
    run(db().from('teacher_profiles').select('nid, photo_url').in('nid', otherNids).order('id')),
  ]) : [[], []];
  const teacherOf = new Map(teachers.map((t) => [t.nid, t]));
  const photoOf = new Map(profiles.map((p) => [p.nid, p.photo_url]));

  const rows = chats.map((c) => {
    const nid = normId(c.otherId);
    const t = teacherOf.get(nid);
    return { ...c, otherName: t?.name || '', otherDept: t?.dept || '', otherRegion: t?.region || '', otherPhotoUrl: photoOf.get(nid) || '' };
  }).sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
  return { rows };
}

/** 그 대화방에서 내가 받은 메시지를 모두 읽음으로. */
async function markRead(body) {
  const chatId = str(body.chatId).split('__').map((x) => x.trim()).sort().join('__');   // 11/6: 앱이 가린 번호로 만든 방 번호 → 원래 번호 순서로
  const me = str(body.memberId);
  if (!chatId || !me) return { error: 'chatId, memberId 가 필요합니다.' };
  requireParticipant(chatId);
  const through=cursor(body.throughId);
  let query=db().from('chat_messages').update({is_read:true},{count:'exact'}).eq('chat_id',chatId).eq('to_nid',normId(me)).eq('is_read',false);
  if(body.throughId!=null)query=query.lte('id',through);
  const {count,error}=await query;if(error)throw new Error(error.message);
  return {ok:true,updated:count||0};
}

/** 기존 프로필의 전화번호를 확인한 뒤 메시지로 보낸다. 명함의 공개 번호와 별개다. */
async function shareContact(body) {
  const fromId = str(body.fromId);
  const toId = str(body.toId);
  if (!fromId || !toId) return { error: 'fromId, toId 가 필요합니다.' };
  const profiles = await run(db().from('teacher_profiles').select('member_id, phone').eq('nid', normId(fromId)).order('id'));
  const phone = profiles.find((p) => sameId(p.member_id, fromId))?.phone || '';
  if (!phone) return { error: '프로필에 등록된 전화번호가 없습니다. 명함의 공개 전화번호와는 별개입니다.' };
  if (body.preview === true) return { phone };
  if (body.expectedPhone != null && body.expectedPhone !== phone) return { error: '전화번호가 변경됐어요. 다시 확인한 뒤 공유해 주세요.' };
  const fromName = String(body.fromName || '') || (await findTeacher(fromId))?.name || '';
  const masked = fromName.length >= 2 ? fromName.charAt(0) + '*' + fromName.slice(2) : fromName;
  return sendMessage({ fromId, toId, message: `${masked || '교사'} 교사님이 연락처를 공유했습니다\n${phone}` });
}

/** 빨간 점 숫자: 안 읽은 채팅 + 대기 중인 협력 요청. */
async function getConnectUnread(body) {
  const me = str(body.memberId);
  if (!me) return { error: 'memberId 가 필요합니다.' };
  const nid = normId(me);
  const [messages, requests] = await Promise.all([
    db().from('chat_messages').select('id',{count:'exact',head:true}).eq('to_nid', nid).eq('is_read', false),
    db().from('coop_requests').select('id',{count:'exact',head:true}).eq('to_nid', nid).eq('status', '대기'),
  ]);
  if(messages.error || requests.error)throw new Error('알림 수를 읽지 못했어요.');
  const unread = messages.count || 0;
  const pendingCoop = requests.count || 0;
  return { unread, pendingCoop, total: unread + pendingCoop };
}

export default { sendMessage, getMessages, getChatList, markRead, shareContact, getConnectUnread };
