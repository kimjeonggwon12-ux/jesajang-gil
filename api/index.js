// 단일 진입점: POST { action, ... } — 기존 Apps Script 웹앱과 같은 약속.
// 등록된 action만 실행하고, 모든 작업에 서버에서 확인한 신원을 연결한다.
import { actions } from '../server/registry.js';
import { fixMemberIds } from '../server/lib/id-alias.js';
import { authenticateRequest } from '../server/lib/request-auth.js';
import { tokenInfo } from '../server/lib/auth.js';
import { withActor, AccessError } from '../server/lib/request-context.js';
import { maskOut, unmaskIn } from '../server/lib/idref.js';
import { normId } from '../server/lib/util.js';
import { backupHttpStatus, backupErrorBody } from '../server/lib/backup-storage.js';

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET') return res.status(200).json({ status: '제사장의 길 API 서버가 작동 중입니다.' });
  if (req.method !== 'POST') return res.status(405).json({ error: '지원하지 않는 요청이에요.' });

  try {
    // 2026-11-06: 요청 속 가린 번호(r_…)를 원래 번호로(server/lib/idref.js)
    const input = await readBody(req);
    if (!input || typeof input !== 'object' || Array.isArray(input)) return res.status(400).json({ error: '요청 내용을 확인해 주세요.' });
    const action = input.action;
    if (typeof action !== 'string' || !Object.hasOwn(actions, action)) return res.status(400).json({ error: '지원하지 않는 기능이에요.' });
    const { actor, body } = await authenticateRequest(action, { ...fixMemberIds(unmaskIn({ ...input, _tk: undefined })), _tk: input._tk });
    const result = await withActor(actor, () => actions[action](body));
    // 2026-11-06(사용자): 고유번호는 입장할 때만 — 응답의 남의 번호는 가린다(본인 번호·예약 작업 응답은 그대로)
    const loginNid = ['verifyLogin', 'guestLogin', 'registerPin', 'recoverPin'].includes(action) && result?.ok ? tokenInfo(result.token)?.nid : null;
    return res.status(backupHttpStatus(action, result)).json(actor?.cron ? result : maskOut(result, loginNid || actor?.nid || normId(body.memberId)));
  } catch (err) {
    if (err instanceof AccessError) return res.status(err.status).json({ error: err.message, ...(err.status === 401 ? { auth: false } : {}) });
    if (err.backupFailure) return res.status(503).json(backupErrorBody(err));
    if (err instanceof SyntaxError) return res.status(400).json({ error: '요청 내용을 읽지 못했어요.' });
    return res.status(503).json({ error: '처리 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.', retry: true });
  }
}
