// 단일 진입점: POST { action, ... } — 기존 Apps Script 웹앱과 같은 약속.
// 아직 옮기지 않은 action 은 LEGACY_URL(Apps Script)로 그대로 넘긴다.
import { actions } from '../server/registry.js';

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
    const body = await readBody(req);
    const action = body.action || 'generateContent';
    const fn = actions[action];
    const result = fn ? await fn(body) : await forwardToLegacy({ ...body, action });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(200).json({ error: String(err && err.message ? err.message : err) });
  }
}
