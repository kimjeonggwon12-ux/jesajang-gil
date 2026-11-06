// 단일 진입점: POST { action, ... } — 기존 Apps Script 웹앱과 같은 약속.
// 아직 옮기지 않은 action 은 LEGACY_URL(Apps Script)로 그대로 넘긴다.
import { actions } from '../server/registry.js';
import { fixMemberIds } from '../server/lib/id-alias.js';
import { tokenNid, PUBLIC_ACTIONS } from '../server/lib/auth.js';

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function forwardToLegacy(body) {
  const url = process.env.LEGACY_URL;
  if (!url) return { error: 'unknown action: ' + body.action };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
    redirect: 'follow',
  });
  const text = await r.text();
  try { return JSON.parse(text); } catch { return { error: '옛 서버 응답을 읽지 못했습니다.' }; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET') return res.status(200).json({ status: '제사장의 길 API 서버가 작동 중입니다.' });

  try {
    const body = fixMemberIds(await readBody(req));
    const action = body.action || 'generateContent';
    // 2026-11-06: 입장 표(_tk) 없는 요청 거절 — 명단에 있는 번호+이름으로 들어온 사람만(server/lib/auth.js). 예외: PUBLIC(출석 QR 등)·예약 작업(key)
    const tk = body._tk; delete body._tk;
    const cron = !!process.env.TEACHERSQUARE_CRON_KEY && body.key === process.env.TEACHERSQUARE_CRON_KEY;
    if (!PUBLIC_ACTIONS.has(action) && !cron && !tokenNid(tk)) return res.status(200).json({ error: '로그인이 필요해요. 앱을 다시 열어 고유번호와 이름으로 들어와 주세요.', auth: false });
    const fn = actions[action];
    const result = fn ? await fn(body) : await forwardToLegacy({ ...body, action });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(200).json({ error: String(err && err.message ? err.message : err) });
  }
}
