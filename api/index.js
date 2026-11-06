// 단일 진입점: POST { action, ... } — 기존 Apps Script 웹앱과 같은 약속.
// 아직 옮기지 않은 action 은 LEGACY_URL(Apps Script)로 그대로 넘긴다.
import { actions } from '../server/registry.js';
import { fixMemberIds } from '../server/lib/id-alias.js';
import { tokenInfo, PUBLIC_ACTIONS, GUEST_ACTIONS } from '../server/lib/auth.js';
import { maskOut, unmaskIn } from '../server/lib/idref.js';
import { normId } from '../server/lib/util.js';

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
    // 2026-11-06: 요청 속 가린 번호(r_…)를 원래 번호로(server/lib/idref.js)
    const body = fixMemberIds(unmaskIn(await readBody(req)));
    const action = body.action || 'generateContent';
    // 2026-11-06: 입장 표(_tk) 없는 요청 거절 — 명단(부서·번호·이름)으로 들어온 사람만(server/lib/auth.js). 예외: PUBLIC(출석 QR 등)·예약 작업(key)
    const tk = body._tk; delete body._tk;
    const cron = !!process.env.TEACHERSQUARE_CRON_KEY && body.key === process.env.TEACHERSQUARE_CRON_KEY;
    const who = tokenInfo(tk);
    if (!PUBLIC_ACTIONS.has(action) && !cron && !who) return res.status(200).json({ error: '로그인이 필요해요. 앱을 다시 열어 부서·고유번호·이름으로 들어와 주세요.', auth: false });
    // 손님(명단에 없는 분): 초대받은 대화방만, 그리고 자기 번호로만
    if (who && who.guest && !PUBLIC_ACTIONS.has(action)) {
      if (!GUEST_ACTIONS.has(action)) return res.status(200).json({ error: '손님은 초대받은 대화방과 출석만 쓸 수 있어요.', guestOnly: true });
      if (normId(body.memberId) !== who.nid) return res.status(200).json({ error: '로그인이 필요해요.', auth: false });
    }
    const fn = actions[action];
    const result = fn ? await fn(body) : await forwardToLegacy({ ...body, action });
    // 2026-11-06(사용자): 고유번호는 입장할 때만 — 응답의 남의 번호는 가린다(본인 번호·예약 작업 응답은 그대로)
    return res.status(200).json(cron ? result : maskOut(result, who ? who.nid : normId(body.memberId)));
  } catch (err) {
    return res.status(200).json({ error: String(err && err.message ? err.message : err) });
  }
}
