// 11/19(사용자): '내일의양식' 텔레그램 방에 매일 오후 2시 한 번 — **다음 날** 것을 하루 전에 올린다(19일 14시 → 20일 글).
//   날짜와 잠언 장(그 다음 날의 일 = 장, 잠언 31장)만 바뀌고 나머지 글은 그대로.
//   봇 = 교사광장 도우미(ATT_BOT_TOKEN, 그 방에 들어가 있음). 하루 한 번은 cohort_summary_log '#daily-bread'로 지킨다.
//   늦게 돌아도 저녁 8시가 지나면 그날 것은 보내지 않는다(밤에 엉뚱하게 올라가지 않게).
import { db } from './db.js';
import { kstDate, kstDateTime } from './util.js';

export const BREAD_CHAT_ID = '-1004481209815';   // 내일의양식
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

/** 'YYYY-MM-DD' → 올릴 글. 신(新)년 = 서기 - 1983 (2026 = 신 43). */
export function breadText(date) {
  const [y, m, d] = date.split('-').map(Number);
  const wd = WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const link = 'https://wordsquare.org/bible-forest/bible/' + encodeURIComponent('잠' + d);
  return [
    `신 ${y - 1983}. ${m}. ${d}.(${wd})`,
    '🍒시온공부방-오늘의 양식 10문제 풀기',
    ' (https://kimjeonggwon12-ux.github.io/-0722-3-/)https://zion-study-room.vercel.app/',
    '📣암호: 144000-12000',
    `🌐잠언 ${d}장 읽기 (${link})`,
    '← 누르면 링크로 이동',
    '◽️ 도마지파 교육부',
  ].join('\n');
}

async function send(text) {
  const token = process.env.ATT_BOT_TOKEN;
  if (!token) throw new Error('ATT_BOT_TOKEN 없음');
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: BREAD_CHAT_ID, text }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(j.description || String(r.status));
  return j.result.message_id;
}

/** 5분마다(attAutoSummary): 14:00~20:00 사이 첫 틱에 하루 한 번, 내일 날짜 글. 중복 기록 date = 올린 날. */
export async function dailyBreadTick() {
  const hm = kstDateTime().slice(11, 16);
  if (hm < '14:00' || hm >= '20:00') return null;
  const date = kstDate();
  const { error } = await db().from('cohort_summary_log').insert({ cohort_id: '#daily-bread', kind: '내일의양식', ref_id: BREAD_CHAT_ID, date, sent_at: kstDateTime() });
  if (error) return null;   // 오늘 이미 보냄
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);   // 내일 날짜(글에 들어갈 날)
  try { return { date, for: next, messageId: await send(breadText(next)) }; }
  catch (e) {
    await db().from('cohort_summary_log').delete().eq('cohort_id', '#daily-bread').eq('date', date);   // 다음 5분에 다시
    return { date, error: e.message };
  }
}
