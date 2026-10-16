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

/** HTML 글 한 통(표 <pre> 등). 길면 4000자에서 자른다. */
export async function sendAttendHtml(html, chatId) {
  if (!configured()) return;
  const chat = String(chatId || '').trim() || process.env.ATT_ADMIN_CHAT;
  try {
    const r = await fetch(api('sendMessage'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: String(html).slice(0, 4000), parse_mode: 'HTML' }),
    });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) console.log('출석 봇 HTML 오류: ' + (j.description || r.status));
  } catch (e) { console.log('출석 봇 오류: ' + e); }
}

/** 사진 한 장(PNG) + 설명. */
export async function sendAttendPhoto(bytes, caption, chatId) {
  if (!configured()) return { ok: false, error: '봇 설정 없음' };
  const form = new FormData();
  form.set('chat_id', String(chatId || '').trim() || process.env.ATT_ADMIN_CHAT);
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

/** 텔레그램 API 를 부르고 JSON 결과를 돌려준다(실패하면 { ok:false, description }). */
export async function attendBotCall(method, payload = {}) {
  if (!process.env.ATT_BOT_TOKEN) return { ok: false, description: '출석 봇 설정이 없어요.' };
  try {
    const r = await fetch(api(method), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    return await r.json().catch(() => ({ ok: false, description: 'HTTP ' + r.status }));
  } catch (e) {
    return { ok: false, description: String(e.message || e) };
  }
}
