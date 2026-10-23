// 보고방(교자장부청 공식 보고방, 텔레그램) — 출석 봇이 보고 문자를 그대로 올린다(2026-10-23).
// 부서 → 방은 report_rooms 표. 고친 보고는 처음 올린 글에 답장으로 "수정본"을 다시 올린다.
import { db, run } from './db.js';
import { kstDateTime } from './util.js';

/**
 * 이 부서의 보고방. 부서 방이 없으면 기본 방(dept '*')으로 — 10/23 사용자: "부서를 보고 맞는 방으로, 일단은 봇을 초대한 그 방으로".
 * 둘 다 없으면 null.
 */
export async function roomForDept(dept) {
  const rows = await run(db().from('report_rooms').select('*').in('dept', [dept || '', '*']).eq('active', true)).catch(() => []);
  return rows.find((x) => x.dept === dept) || rows.find((x) => x.dept === '*') || null;
}

/** 글 하나 보내기 → 보낸 글 번호(실패하면 Error). 4096자 넘으면 잘라서 앞부분만. */
async function sendText(chatId, text, replyTo) {
  // 10/23: 보고방에는 출석 봇(@teachersquare_att_bot)이 초대돼 있어 그 봇으로 보낸다(출석 봇 웹훅은 교육 과정 방 글만 처리 — 보고방 글은 무시).
  const token = process.env.ATT_BOT_TOKEN || process.env.TEACHERSQUARE_BOT_TOKEN;
  if (!token) throw new Error('보고방 봇 설정(ATT_BOT_TOKEN)이 없습니다.');
  const body = { chat_id: chatId, text: String(text).slice(0, 4096) };
  if (replyTo) body.reply_parameters = { message_id: Number(replyTo), allow_sending_without_reply: true };
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error('보고방에 올리지 못했습니다: ' + (j.description || r.status));
  return j.result.message_id;
}

/**
 * 보고 기록 한 줄(activities 행)을 보고방에 올린다. kind 'post' = 처음, 'edit' = 고친 뒤 다시.
 * 고친 글은 처음 올린 글에 답장으로 달고, 맨 위에 [수정본] 표시를 붙인다. 새 tg_posts 를 돌려준다.
 */
export async function postReport(row, room, kind) {
  const posts = Array.isArray(row.tg_posts) ? row.tg_posts : [];
  const first = posts.find((p) => p.kind === 'post');
  const text = kind === 'edit'
    ? `✏️ [수정본] ${String(row.submitted_at || '').slice(5, 10).replace('-', '/')} 보고를 고쳐 다시 올립니다\n\n${row.report_text}`
    : row.report_text;
  const msg = await sendText(room.chat_id, text, kind === 'edit' && first ? first.msg : null);
  const next = posts.concat([{ chat: String(room.chat_id), msg, at: kstDateTime(), kind }]);
  await run(db().from('activities').update({ tg_posts: next }).eq('id', row.id));
  return next;
}

// ── 관리용(운영 키 필요) ── 봇이 들어간 방 찾기 · 부서와 방 연결. 예) { action:'reportRooms', key, op:'candidates' }
//   op 'candidates' = 최근에 봇이 받은 방들(봇 초대 뒤 그 방에 아무 글이나 하나 올리면 보인다; 이 봇은 웹훅이 없어 getUpdates 로 읽음)
//   op 'check' {chatId} = 봇이 그 방에 있는지(글 안 올림), op 'set' {dept, chatId, title} = 연결(dept '*' 는 기본 방), op 'off' {dept} = 끊기, op 'list' = 연결 목록
export async function reportRooms(body) {
  if (!process.env.TEACHERSQUARE_CRON_KEY || body.key !== process.env.TEACHERSQUARE_CRON_KEY) return { error: '권한이 없습니다.' };
  const op = String(body.op || 'list');
  if (op === 'candidates') {
    const token = process.env.TEACHERSQUARE_BOT_TOKEN;
    const r = await fetch(`https://api.telegram.org/bot${token}/getUpdates?allowed_updates=${encodeURIComponent('["message","my_chat_member"]')}`);
    const j = await r.json();
    if (!j.ok) return { error: j.description || String(r.status) };
    const chats = {};
    for (const u of j.result) {
      const m = u.message || u.my_chat_member || {};
      if (m.chat && m.chat.type !== 'private') chats[m.chat.id] = { chatId: String(m.chat.id), title: m.chat.title || '', type: m.chat.type, status: u.my_chat_member ? u.my_chat_member.new_chat_member.status : '' };
    }
    return { rooms: Object.values(chats) };
  }
  if (op === 'check') {   // 글을 올리지 않고 봇이 그 방에 있는지·글을 쓸 수 있는지만 본다
    // 앱의 봇 셋(교사광장·출석·활동 알림)을 모두 본다 — 다른 봇을 초대했는지도 알 수 있게
    const chatId = String(body.chatId || '');
    const out = [];
    for (const token of [process.env.TEACHERSQUARE_BOT_TOKEN, process.env.ATT_BOT_TOKEN, process.env.TELEGRAM_BOT_TOKEN].filter(Boolean)) {
      const tg = async (m, q) => (await fetch(`https://api.telegram.org/bot${token}/${m}?${new URLSearchParams(q)}`)).json();
      const me = await tg('getMe', {});
      const chat = await tg('getChat', { chat_id: chatId });
      const member = me.ok ? await tg('getChatMember', { chat_id: chatId, user_id: me.result.id }) : {};
      out.push({ bot: me.result && me.result.username, chat: chat.ok ? { title: chat.result.title, type: chat.result.type } : chat.description,
        member: member.ok ? { status: member.result.status, canPost: member.result.can_send_messages !== false } : member.description });
    }
    return { bots: out };
  }
  if (op === 'set') {
    const dept = String(body.dept || '').trim(), chatId = String(body.chatId || '').trim();
    if (!dept || !/^-?\d+$/.test(chatId)) return { error: 'dept, chatId 가 필요합니다.' };
    await run(db().from('report_rooms').upsert({ dept, chat_id: chatId, title: String(body.title || ''), active: true, created_at: kstDateTime() }));
  } else if (op === 'off') {
    await run(db().from('report_rooms').update({ active: false }).eq('dept', String(body.dept || '')));
  }
  return { rooms: await run(db().from('report_rooms').select('*').order('dept')) };
}
