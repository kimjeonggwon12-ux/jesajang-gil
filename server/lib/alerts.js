// 교사광장 텔레그램 봇: 발송 + 알림로그. 알림 실패가 본 기능을 막지 않도록 오류는 삼킨다.
import { db, run } from './db.js';
import { normId, kstDateTime } from './util.js';

/** 텔레그램 HTML 모드에서 깨지지 않게. */
export const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** "아이콘 <b>이름:</b> 값" 한 줄(값이 없으면 -). */
export const row = (icon, label, value) => `${icon} <b>${label}:</b> ${esc(value == null || value === '' ? '-' : value)}`;

const now = () => kstDateTime().slice(0, 16);

async function alreadySent(dedupKey) {
  if (!dedupKey) return false;
  const hit = await run(db().from('alert_log').select('id').eq('dedup_key', dedupKey).eq('ok', true).limit(1));
  return hit.length > 0;
}

async function log(kind, message, ok, dedupKey) {
  try {
    const summary = String(message || '').replace(/<[^>]+>/g, '').replace(/\s*\n\s*/g, ' / ').slice(0, 200);
    await run(db().from('alert_log').insert({ sent_at: now(), kind, summary, ok, dedup_key: dedupKey || '' }));
  } catch { /* 로그 실패는 무시 */ }
}

const botConfigured = () => !!(process.env.TEACHERSQUARE_BOT_TOKEN && process.env.TEACHERSQUARE_CHAT_ID);

async function telegram(method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${process.env.TEACHERSQUARE_BOT_TOKEN}/${method}`, payload);
  if (!r.ok) console.log(`[교사광장 봇] ${method} 실패 ${r.status} ${(await r.text()).slice(0, 300)}`);
  return r.ok;
}

/**
 * 교사광장 방에 글을 보낸다. dedupKey 가 있고 그 키로 성공한 기록이 있으면 다시 보내지 않는다.
 * @returns 보냈으면 true
 */
export async function sendAlert(message, kind = '기타', dedupKey = '') {
  try {
    if (await alreadySent(dedupKey)) return false;
    const ok = botConfigured() && await telegram('sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: process.env.TEACHERSQUARE_CHAT_ID, text: message, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    await log(kind, message, ok, dedupKey);
    return ok;
  } catch (err) {
    console.log('[교사광장 봇] 오류 ' + err);
    await log(kind, message, false, dedupKey);
    return false;
  }
}

/** 사진 한 장(주소) + 설명. */
export async function sendPhoto(photoUrl, caption) {
  if (!botConfigured()) return false;
  return telegram('sendPhoto', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: process.env.TEACHERSQUARE_CHAT_ID, photo: photoUrl, caption, parse_mode: 'HTML' }),
  });
}

/** 파일 한 개(엑셀 등) + 설명. chatId 를 안 주면 교사광장 방. */
export async function sendDocument(bytes, filename, caption, chatId = process.env.TEACHERSQUARE_CHAT_ID) {
  if (!process.env.TEACHERSQUARE_BOT_TOKEN || !chatId) return false;
  const form = new FormData();
  form.set('chat_id', chatId);
  if (caption) { form.set('caption', caption); form.set('parse_mode', 'HTML'); }
  form.set('document', new Blob([bytes]), filename);
  return telegram('sendDocument', { method: 'POST', body: form });
}

export { alreadySent, log as logAlert };

/** 알림 머리에 넣는 교사 정보: 이름·부서·지역·담당 교관. */
export async function teacherInfo(memberId, fallbackName) {
  let p = null;
  let coaches = [];
  try {
    const nid = normId(memberId);
    [p] = await run(db().from('teachers').select('*').eq('nid', nid).order('sort_order').limit(1));
    if (p?.region) {
      const [inRoster, inAdmins] = await Promise.all([
        run(db().from('teachers').select('name, nid').eq('position', '교관').eq('dept', p.dept).eq('region', p.region).order('sort_order')),
        run(db().from('admins').select('name, nid').like('position', '%교관%').eq('dept', p.dept).eq('region', p.region).order('id')),
      ]);
      coaches = [...new Set([...inRoster, ...inAdmins].filter((c) => c.nid !== nid && c.name).map((c) => c.name))];
    }
  } catch { /* 명단을 못 읽어도 알림은 보낸다 */ }
  return {
    name: p?.name || String(fallbackName || '').trim() || '이름미상',
    dept: p?.dept === '교역자' ? '교역자회' : (p?.dept || ''),
    region: p?.region || '',
    coaches,
  };
}

/** "👤 교사: 부서 지역 이름 / 👨‍🏫 담당 교관: …" 두 줄. */
export function teacherHead(t) {
  const where = [t.dept, t.region].filter(Boolean).map(esc).join(' ');
  return `👤 <b>교사:</b> ${where ? where + ' ' : ''}<b><u>${esc(t.name)}</u></b>\n` +
    row('👨‍🏫', '담당 교관', t.coaches.length ? t.coaches.join(', ') : '미지정');
}
