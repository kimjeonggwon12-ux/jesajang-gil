// 2026-11-06(사용자): "고유번호는 입장할 때만 사용하게 하고, 교사광장에 내보내지 않도록".
// api/index.js 출입구에서 일괄 처리한다 —
//   나가는 응답: 남의 고유번호(memberId 등 정해진 칸)는 서버만 풀 수 있는 암호 값 r_… 로 바꾼다(요청한 본인 번호는 그대로).
//   들어오는 요청: r_… 은 원래 번호로 되돌린다 → 앱 화면 코드는 그대로 두고 번호만 밖으로 안 나간다.
// 같은 번호는 늘 같은 r_… (앱이 같은 사람인지 비교할 수 있게) — AES-256-GCM, IV = HMAC(번호).
import { createCipheriv, createDecipheriv, createHash, createHmac } from 'node:crypto';
import { normId } from './util.js';

const KEY = () => createHash('sha256').update(String(process.env.SUPABASE_SERVICE_ROLE_KEY || '') + '|idref-v1').digest();
const b64 = (b) => b.toString('base64url');

export function encId(v) {
  const s = String(v);
  const iv = createHmac('sha256', KEY()).update('iv|' + s).digest().subarray(0, 12);
  const c = createCipheriv('aes-256-gcm', KEY(), iv);
  const ct = Buffer.concat([c.update(s, 'utf8'), c.final()]);
  return 'r_' + b64(Buffer.concat([iv, ct, c.getAuthTag()]));
}
export function decId(r) {
  try {
    const buf = Buffer.from(String(r).slice(2), 'base64url');
    if (buf.length < 29) return null;
    const d = createDecipheriv('aes-256-gcm', KEY(), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(buf.length - 16));
    return Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()]).toString('utf8');
  } catch { return null; }
}

// 고유번호가 담기는 칸(응답). chatId 는 두 사람 번호를 이은 것('a__b')일 때만.
const ID_KEYS = new Set([
  'memberId', 'creatorId', 'leaderId', 'helperId', 'fromId', 'toId', 'teacherId', 'coachId', 'writerId', 'authorId',
  'assigneeId', 'applicantId', 'viewerId', 'createdById', 'approverId', 'handlerId', 'ownerId', 'requesterId', 'targetMemberId',
  'member_id', 'from_id', 'to_id', 'creator_id', 'leader_id', 'helper_id', 'teacher_id', 'author_id', 'assignee_id',
  'applicant_id', 'created_by_id', 'approver_id', 'handler_id', 'owner_id', 'requester_id', 'created_by',
]);
const looksId = (v) => typeof v === 'string' && /\d{6,}/.test(v) && /^[\d\s-]+$/.test(v.trim());

/** 응답에서 남의 번호를 가린다(meNid = 요청한 사람). */
export function maskOut(x, meNid, key = '') {
  if (Array.isArray(x)) return x.map((v) => maskOut(v, meNid, key));
  if (x && typeof x === 'object') {
    const o = {};
    for (const k of Object.keys(x)) o[k] = maskOut(x[k], meNid, k);
    return o;
  }
  if (typeof x === 'string') {
    if (key === 'chatId' && x.includes('__')) return encId(x);
    if (ID_KEYS.has(key) && looksId(x) && normId(x) !== meNid) return encId(x);
  }
  if (typeof x === 'number' && ID_KEYS.has(key) && String(x).length >= 8 && normId(x) !== meNid) return encId(String(x));
  return x;
}

const REF = /r_[A-Za-z0-9_-]{36,}/g;
/** 요청 안의 r_… 를 원래 값으로(문자열 속에 섞인 것도 — 예: 'a__r_…'). */
export function unmaskIn(x) {
  if (Array.isArray(x)) return x.map(unmaskIn);
  if (x && typeof x === 'object') {
    for (const k of Object.keys(x)) x[k] = unmaskIn(x[k]);
    return x;
  }
  if (typeof x === 'string' && x.includes('r_')) return x.replace(REF, (m) => decId(m) ?? m);
  return x;
}
