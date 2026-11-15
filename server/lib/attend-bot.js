// 출석 알림 전용 텔레그램 봇(교사광장 봇과 다른 방). 실패해도 출석 자체에는 영향이 없다.
import { AccessError } from './request-context.js';

const configured = () => !!(process.env.ATT_BOT_TOKEN && process.env.ATT_ADMIN_CHAT);
const api = (method) => `https://api.telegram.org/bot${process.env.ATT_BOT_TOKEN}/${method}`;
const MAX = 3900;   // 텔레그램 한 통 길이 제한(4096)보다 조금 작게

/** 긴 글은 줄 단위로 나눠 여러 통으로 보낸다. chatId 를 주면 그 방(교육 과정 방)으로, 없으면 출석 기본 방으로. */
export async function sendAttendText(text, chatId, { strict = false } = {}) {
  // 보고/수동 전달은 strict로 확인하고 개별 출석 알림의 비차단 동작은 유지한다.
  if (strict && (!configured() || !String(chatId || '').trim())) throw new AccessError('교육 방 또는 봇 연결을 확인해 주세요.', 503);
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
      const r = await fetch(api('sendMessage'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text: part }),
      });
      if (strict && (!r.ok || !(await r.json()).ok)) throw new Error('전달 확인 실패');
    } catch (e) {
      if (strict) throw new AccessError('텔레그램 전달을 확인하지 못했어요. 일부 글이 전달됐을 수 있으니 방을 확인한 뒤 다시 시도해 주세요.', 503);
      console.log('출석 봇 오류: ' + e);
    }
  }
}

/** HTML 글 한 통(표 <pre> 등). 길면 4000자에서 자른다. */
export async function sendAttendHtml(html, chatId, { strict = false } = {}) {
  if (strict && (!configured() || !String(chatId || '').trim())) throw new AccessError('교육 방 또는 봇 연결을 확인해 주세요.', 503);
  if (!configured()) return;
  const chat = String(chatId || '').trim() || process.env.ATT_ADMIN_CHAT;
  try {
    const r = await fetch(api('sendMessage'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: String(html).slice(0, 4000), parse_mode: 'HTML' }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) {
      if (strict) throw new Error('전달 확인 실패');
      console.log('출석 봇 HTML 오류: ' + (j.description || r.status));
    }
  } catch (e) {
    if (strict) throw new AccessError('텔레그램 표 전달을 확인하지 못했어요. 방을 확인한 뒤 다시 시도해 주세요.', 503);
    console.log('출석 봇 오류: ' + e);
  }
}

/** 사진 한 장(PNG) + 설명. */
export async function sendAttendPhoto(bytes, caption, chatId, { strict = false } = {}) {
  if (!configured()) return { ok: false, error: '봇 설정 없음' };
  const form = new FormData();
  form.set('chat_id', String(chatId || '').trim() || process.env.ATT_ADMIN_CHAT);
  form.set('caption', String(caption).slice(0, 1024));
  form.set('photo', new Blob([bytes], { type: 'image/png' }), 'chart.png');
  try {
    const r = await fetch(api('sendPhoto'), { method: 'POST', body: form });
    const j = await r.json();
    if (strict && (typeof j.ok !== 'boolean' || (!r.ok && j.ok))) throw Error('전달 응답 불명');
    return { ok: r.ok && j.ok === true, error: r.ok && j.ok ? '' : '텔레그램이 전달을 거절했어요.' };
  } catch {
    if (strict) throw new AccessError('사진 수신을 확인하지 못했어요. 방을 확인한 뒤 다시 시도해 주세요.', 503);
    return { ok: false, error: '사진 수신 확인 필요' };
  }
}

/** 파일 한 개 + 설명. */
export async function sendAttendFile(bytes, fileName, caption, { strict = false } = {}) {
  if (!configured()) return { ok: false, error: '봇 설정 없음' };
  const form = new FormData();
  form.set('chat_id', process.env.ATT_ADMIN_CHAT);
  form.set('caption', String(caption).slice(0, 1000));
  form.set('document', new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileName);
  try {
    const r = await fetch(api('sendDocument'), { method: 'POST', body: form });
    const j = await r.json();
    if (strict && (typeof j.ok !== 'boolean' || (!r.ok && j.ok))) throw Error('전달 응답 불명');
    return { ok: r.ok && j.ok === true, error: r.ok && j.ok ? '' : '텔레그램이 전달을 거절했어요.' };
  } catch {
    if (strict) throw new AccessError('파일 수신을 확인하지 못했어요. 방을 확인한 뒤 다시 시도해 주세요.', 503);
    return { ok: false, error: '파일 수신 확인 필요' };
  }
}

/** 텔레그램 API 를 부르고 JSON 결과를 돌려준다(실패하면 { ok:false, description }). */
export async function attendBotCall(method, payload = {}) {
  if (!process.env.ATT_BOT_TOKEN) return { ok: false, description: '출석 봇 설정이 없어요.' };
  try {
    const r = await fetch(api(method), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const j = await r.json();
    return r.ok && j.ok === true ? j : {ok:false,description:'텔레그램 응답 확인 실패'};
  } catch (e) {
    return { ok: false, description: String(e.message || e) };
  }
}
