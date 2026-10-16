// 출석 알림 전용 텔레그램 봇(교사광장 봇과 다른 방). 실패해도 출석 자체에는 영향이 없다.

const configured = () => !!(process.env.ATT_BOT_TOKEN && process.env.ATT_ADMIN_CHAT);
const api = (method) => `https://api.telegram.org/bot${process.env.ATT_BOT_TOKEN}/${method}`;
const MAX = 3900;   // 텔레그램 한 통 길이 제한(4096)보다 조금 작게

/** 긴 글은 줄 단위로 나눠 여러 통으로 보낸다. chatId 를 주면 그 방(교육 과정 방)으로, 없으면 출석 기본 방으로. */
export async function sendAttendText(text, chatId) {
  if (!configured()) return;
  const chat = String(chatId || '').trim() || process.env.ATT_ADMIN_CHAT;
  const parts = [];
  let cur = '';
  for (let line of String(text).split('\n')) {
    if (line.length > MAX) line = line.slice(0, MAX) + '…';
    if (cur && cur.length + 1 + line.length > MAX) { parts.push(cur); cur = line; } else cur = cur ? cur + '\n' + line : line;
  }
  if (cur) parts.push(cur);
  for (const part of parts) {
    try {
      await fetch(api('sendMessage'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text: part }),
      });
    } catch (e) { console.log('출석 봇 오류: ' + e); }
  }
}

/** 사진 한 장(PNG) + 설명. */
export async function sendAttendPhoto(bytes, caption) {
  if (!configured()) return { ok: false, error: '봇 설정 없음' };
  const form = new FormData();
  form.set('chat_id', process.env.ATT_ADMIN_CHAT);
  form.set('caption', String(caption).slice(0, 1024));
  form.set('photo', new Blob([bytes], { type: 'image/png' }), 'chart.png');
  try {
    const r = await fetch(api('sendPhoto'), { method: 'POST', body: form });
    const j = await r.json().catch(() => ({}));
    return { ok: !!j.ok, error: j.ok ? '' : (j.description || 'HTTP ' + r.status) };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

/** 파일 한 개 + 설명. */
export async function sendAttendFile(bytes, fileName, caption) {
  if (!configured()) return { ok: false, error: '봇 설정 없음' };
  const form = new FormData();
  form.set('chat_id', process.env.ATT_ADMIN_CHAT);
  form.set('caption', String(caption).slice(0, 1000));
  form.set('document', new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileName);
  try {
    const r = await fetch(api('sendDocument'), { method: 'POST', body: form });
    const j = await r.json().catch(() => ({}));
    return { ok: !!j.ok, error: j.ok ? '' : (j.description || 'HTTP ' + r.status) };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

/** 봇이 최근에 받은 메시지에서 방 목록을 뽑는다(교육 과정 방 연결용). 봇을 방에 넣고 아무 글이나 쓰면 잡힌다. */
export async function recentAttendChats() {
  if (!process.env.ATT_BOT_TOKEN) return { error: '출석 봇 설정이 없어요.' };
  const r = await fetch(api('getUpdates') + '?limit=100');
  const j = await r.json().catch(() => ({}));
  if (!j.ok) return { error: j.description || '텔레그램에서 목록을 받지 못했어요.' };
  const chats = new Map();
  for (const u of j.result || []) {
    const c = (u.message || u.my_chat_member || u.channel_post || u.edited_message || {}).chat;
    if (c && c.type !== 'private') chats.set(String(c.id), { id: String(c.id), title: c.title || '', type: c.type });
  }
  return { chats: [...chats.values()] };
}
