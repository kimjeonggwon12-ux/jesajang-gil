// 개인 핀번호 (2026-10-27) — 사용자: "남이 내 고유번호·이름을 치고 들어올 수 있으니 핀번호 설정 기능". 원하는 사람만(관리자도 선택).
// 핀을 정한 사람은 새 기기·남의 기기에서 들어올 때 핀을 한 번 더 넣는다(앱이 pinStatus 의 ver 를 기기에 기억).
// 5번 틀리면 10분 잠금. 잊으면 교육·전도 담당 관리자가 지워 준다(resetPin).
// ⚠️ 한계: 서버는 아직 요청마다 신분을 확인하지 않는다(본문 memberId 를 믿음) — 이 핀은 '입장 화면'을 막는 장치.
import crypto from 'node:crypto';
import { db, run } from '../lib/db.js';
import { normId, str, kstDateTime } from '../lib/util.js';
import { isApprover } from './roster.js';

const MAX_FAILS = 5, LOCK_MIN = 10;
const hashPin = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString('hex');
const validPin = (pin) => /^\d{4,6}$/.test(String(pin || ''));
const kstPlusMin = (min) => kstDateTime(new Date(Date.now() + min * 60e3));

async function pinRow(memberId) {
  const nid = normId(memberId);
  if (!nid) return null;
  const rows = await run(db().from('member_pins').select('*').eq('nid', nid).limit(1));
  return rows[0] || null;
}

/** 핀을 맞게 넣었는지 — 잠금·틀린 횟수까지 처리. { ok } 또는 { error } */
async function checkPin(row, pin) {
  const now = kstDateTime();
  if (row.locked_until && row.locked_until > now) {
    return { error: `여러 번 틀려서 잠겼어요. ${row.locked_until.slice(11, 16)} 이후에 다시 해 주세요.`, locked: true };
  }
  const a = Buffer.from(hashPin(pin, row.salt), 'hex'), b = Buffer.from(row.pin_hash, 'hex');
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
    if (row.fails || row.locked_until) await run(db().from('member_pins').update({ fails: 0, locked_until: '' }).eq('nid', row.nid));
    return { ok: true };
  }
  const fails = (row.fails || 0) + 1;
  if (fails >= MAX_FAILS) {
    const until = kstPlusMin(LOCK_MIN);
    await run(db().from('member_pins').update({ fails: 0, locked_until: until }).eq('nid', row.nid));
    return { error: `핀번호가 ${MAX_FAILS}번 틀려서 ${LOCK_MIN}분 동안 잠겼어요. ${until.slice(11, 16)} 이후에 다시 해 주세요.`, locked: true };
  }
  await run(db().from('member_pins').update({ fails, locked_until: '' }).eq('nid', row.nid));
  return { error: `핀번호가 맞지 않아요. (${MAX_FAILS - fails}번 더 틀리면 ${LOCK_MIN}분 잠김)` };
}

/** 핀을 정했는지 + 버전(앱이 이 기기에서 확인한 버전과 비교). */
async function pinStatus(body) {
  // 표가 아직 없거나 DB 오류면 '핀 없음'으로 — 핀 때문에 아무도 못 들어오는 일이 없게
  const row = await pinRow(body.memberId).catch(() => null);
  return { hasPin: !!row, ver: row ? row.ver : '' };
}

/** 입장할 때 핀 확인. */
async function verifyPin(body) {
  const row = await pinRow(body.memberId);
  if (!row) return { ok: true, ver: '' };
  const r = await checkPin(row, str(body.pin));
  return r.ok ? { ok: true, ver: row.ver } : r;
}

/** 핀 정하기·바꾸기 — 이미 있으면 지금 핀(oldPin)이 맞아야 한다. */
async function setPin(body) {
  const nid = normId(body.memberId);
  if (!nid) return { error: '고유번호가 없어요.' };
  const pin = str(body.pin);
  if (!validPin(pin)) return { error: '핀번호는 숫자 4~6자리로 정해 주세요.' };
  if (/^(\d)\1+$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) return { error: '1111·1234처럼 쉬운 번호는 남이 맞히기 쉬워요. 다른 번호로 정해 주세요.' };
  const row = await pinRow(nid);
  if (row) { const r = await checkPin(row, str(body.oldPin)); if (!r.ok) return r; }
  const salt = crypto.randomBytes(16).toString('hex');
  const ver = kstDateTime();
  await run(db().from('member_pins').upsert({ nid, pin_hash: hashPin(pin, salt), salt, ver, fails: 0, locked_until: '', updated_at: ver }));
  return { ok: true, ver };
}

/** 내 핀 끄기 — 지금 핀이 맞아야. */
async function removePin(body) {
  const row = await pinRow(body.memberId);
  if (!row) return { ok: true };
  const r = await checkPin(row, str(body.pin));
  if (!r.ok) return r;
  await run(db().from('member_pins').delete().eq('nid', row.nid));
  return { ok: true };
}

/** 관리자: 핀을 잊은 교사의 핀 지우기(교육·전도 담당). */
async function resetPin(body) {
  if (!(await isApprover(body.memberId))) return { error: '핀번호 초기화는 교육·전도 담당 관리자만 할 수 있어요.' };
  const nid = normId(body.targetId);
  if (!nid) return { error: '초기화할 교사의 고유번호를 넣어 주세요.' };
  const row = await pinRow(nid);
  if (!row) return { ok: true, had: false };
  await run(db().from('member_pins').delete().eq('nid', nid));
  return { ok: true, had: true };
}

// 표(member_pins)가 아직 없으면 오류 글 대신 안내
const safe = (fn) => async (body) => {
  try { return await fn(body); }
  catch (e) { if (/member_pins/.test(String(e.message))) return { error: '핀번호 기능을 준비하고 있어요. 조금 뒤에 다시 해 주세요.' }; throw e; }
};
export default { pinStatus, verifyPin: safe(verifyPin), setPin: safe(setPin), removePin: safe(removePin), resetPin: safe(resetPin) };
