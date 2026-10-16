// 출석 봇 텔레그램 웹훅: 교육 과정 방의 "제출"·"점수"·"집계" 글을 받는다(server/actions/cohort-bot.js).
// 텔레그램이 머리글에 실어 보내는 비밀값이 맞을 때만 처리하고, 실패해도 200 으로 답해 같은 글을 다시 보내지 않게 한다.
import { handleAttendUpdate, webhookSecret } from '../server/actions/cohort-bot.js';

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
  try {
    await handleAttendUpdate(await readBody(req));
  } catch (e) {
    console.log('교육 방 처리 오류: ' + (e && e.message ? e.message : e));
  }
  return res.status(200).json({ ok: true });
}
