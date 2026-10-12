// 1:1 채팅 + 안 읽은 알림 수
import { db, run, selectAll } from '../lib/db.js';
import { normId, str, kstDateTime, fmtTs, sameId } from '../lib/util.js';
import { findTeacher } from './roster.js';

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

/** 대화방의 메시지(오래된 것부터). after 를 주면 그 시각 뒤의 것만. */
async function getMessages(body) {
  const chatId = str(body.chatId);
  if (!chatId) return { error: 'chatId 가 필요합니다.' };
  const after = String(body.after || '');
  const data = await selectAll(() => db().from('chat_messages').select('*').eq('chat_id', chatId).order('id'));
  const rows = data
    .map((m) => ({ fromId: m.from_id, toId: m.to_id, message: m.message, sentAt: fmtTs(m.sent_at), read: m.is_read }))
    .filter((m) => !after || m.sentAt > after)
    .sort((a, b) => (a.sentAt < b.sentAt ? -1 : 1));
  return { rows };
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
  const chatId = str(body.chatId);
  const me = str(body.memberId);
  if (!chatId || !me) return { error: 'chatId, memberId 가 필요합니다.' };
  const unread = await run(db().from('chat_messages').select('id, to_id').eq('chat_id', chatId).eq('is_read', false));
  const ids = unread.filter((m) => sameId(m.to_id, me)).map((m) => m.id);
  if (ids.length) await run(db().from('chat_messages').update({ is_read: true }).in('id', ids));
  return { ok: true, updated: ids.length };
}

/** 내 명함의 전화번호를 메시지로 보낸다. */
async function shareContact(body) {
  const fromId = str(body.fromId);
  const toId = str(body.toId);
  if (!fromId || !toId) return { error: 'fromId, toId 가 필요합니다.' };
  const profiles = await run(db().from('teacher_profiles').select('member_id, phone').eq('nid', normId(fromId)).order('id'));
  const phone = profiles.find((p) => sameId(p.member_id, fromId))?.phone || '';
  if (!phone) return { error: '등록된 전화번호가 없습니다. 먼저 내 명함에 전화번호를 입력해주세요.' };
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
    run(db().from('chat_messages').select('to_id').eq('to_nid', nid).eq('is_read', false)),
    run(db().from('coop_requests').select('to_id').eq('to_nid', nid).eq('status', '대기')),
  ]);
  const unread = messages.filter((m) => sameId(m.to_id, me)).length;
  const pendingCoop = requests.filter((r) => sameId(r.to_id, me)).length;
  return { unread, pendingCoop, total: unread + pendingCoop };
}

export default { sendMessage, getMessages, getChatList, markRead, shareContact, getConnectUnread };
