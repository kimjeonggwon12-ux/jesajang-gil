// 출석 봇 텔레그램 웹훅: 교육 과정 방의 "제출"·"점수"·"집계" 글을 받는다(server/actions/cohort-bot.js).
// 비밀값 확인 → 수신 기록 선점 → 업무 처리. 처리 전 실패만 재전달하고 부분 처리의 자동 반복은 막는다.
import { handleAttendUpdate, webhookSecret } from '../server/actions/cohort-bot.js';
import { receiveTelegramUpdate } from '../server/lib/telegram-receipt.js';

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).json({ ok: true });
  if (!process.env.TEACHERSQUARE_CRON_KEY || req.headers['x-telegram-bot-api-secret-token'] !== webhookSecret()) {
    return res.status(401).json({ ok: false });
  }
  let update;
  try { update = await readBody(req); } catch { return res.status(400).json({ok:false,error:'invalid_update'}); }
  try {
    const result = await receiveTelegramUpdate(update, handleAttendUpdate);
    return res.status(result.status).json(result.body);
  } catch {
    return res.status(503).json({ok:false,error:'receipt_unavailable'});
  }
}
