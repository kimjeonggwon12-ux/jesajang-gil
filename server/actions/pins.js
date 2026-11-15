// PIN은 필수. 최초 등록은 기존 정보 대조, 분실·선등록 신고는 담당자 복구 코드.
import crypto from 'node:crypto';
import { db, run } from '../lib/db.js';
import { normId, str, kstDateTime } from '../lib/util.js';
import { isApprover, memberRoles } from './roster.js';
import { tokenFor, pinVersion } from '../lib/auth.js';
import { requireActor } from '../lib/request-context.js';

const MAX_FAILS = 5, LOCK_MIN = 10;
const hashPin = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString('hex');
const kstPlusMin = (min) => kstDateTime(new Date(Date.now() + min * 60e3));
const recoveryHash = code => crypto.createHash('sha256').update(code).digest('hex');
const codeText = code => str(code).toUpperCase().replace(/[-\s]/g, '');
export const normalizePhone = value => str(value).replace(/\D/g, '').replace(/^82/, '0');
function newPinError(pin) {
  if (!/^\d{6}$/.test(pin)) return '새 PIN은 숫자 6자리로 정해 주세요.';
  if (/^(\d)\1+$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) return '연속되거나 모두 같은 숫자는 피해주세요.';
  return '';
}
function newPin(nid, pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { nid, pin_hash: hashPin(pin, salt), salt, ver: crypto.randomUUID() };
}
async function savePin(op, nid, pin, extra = {}) {
  const error = newPinError(pin); if (error) return { error };
  const next = newPin(nid, pin);
  // 서명 설정이 없으면 DB 변경 전에 실패한다.
  const token = tokenFor(nid, 'm', { pinVersion: pinVersion(next) });
  const result = await run(db().rpc('pin_account_action', { p: { op, nid, pinHash: next.pin_hash, salt: next.salt, ver: next.ver, ...extra } }));
  return result?.ok ? { ...result, token, ver: next.ver, pinVer: next.ver } : result;
}

export async function pinRow(memberId) {
  const nid = normId(memberId);
  if (!nid) return null;
  const rows = await run(db().from('member_pins').select('*').eq('nid', nid).limit(1));
  return rows[0] || null;
}

/** 핀을 맞게 넣었는지 — 잠금·틀린 횟수까지 처리. { ok } 또는 { error } */
export async function checkPin(row, pin) {
  const now = kstDateTime();
  if (row.locked_until && row.locked_until > now) {
    return { error: `여러 번 틀려서 잠겼어요. ${row.locked_until.slice(11, 16)} 이후에 다시 해 주세요.`, locked: true };
  }
  // 시도를 먼저 확보한다. 동시에 같은 이전 횟수를 읽은 요청은 PIN을 비교하지 않는다.
  const fails = (row.locked_until && row.locked_until <= now ? 0 : (row.fails || 0)) + 1;
  const until = fails >= MAX_FAILS ? kstPlusMin(LOCK_MIN) : '';
  const retry = { error: '다른 확인 요청이 처리 중이에요. 잠시 후 다시 눌러 주세요.', retry: true };
  const reserved = await run(db().from('member_pins').update({ fails, locked_until: until })
    .eq('nid', row.nid).eq('ver', row.ver).eq('fails', row.fails || 0).eq('locked_until', row.locked_until || '').select('nid'));
  if (!reserved.length) return retry;
  const a = Buffer.from(hashPin(pin, row.salt), 'hex'), b = Buffer.from(row.pin_hash, 'hex');
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
    const cleared = await run(db().from('member_pins').update({ fails: 0, locked_until: '' })
      .eq('nid', row.nid).eq('ver', row.ver).eq('fails', fails).eq('locked_until', until).select('nid'));
    return cleared.length ? { ok: true } : retry;
  }
  if (fails >= MAX_FAILS) {
    return { error: `핀번호가 ${MAX_FAILS}번 틀려서 ${LOCK_MIN}분 동안 잠겼어요. ${until.slice(11, 16)} 이후에 다시 해 주세요.`, locked: true };
  }
  return { error: `핀번호가 맞지 않아요. (${MAX_FAILS - fails}번 더 틀리면 ${LOCK_MIN}분 잠김)` };
}

/** 핀을 정했는지 + 버전(앱이 이 기기에서 확인한 버전과 비교). */
async function pinStatus(body) {
  const row = await pinRow(body.memberId);
  return { hasPin: !!row?.pin_hash, ver: row?.pin_hash ? row.ver : '' };
}

/** 입장할 때 핀 확인. */
async function verifyPin(body) {
  const row = await pinRow(body.memberId);
  if (!row?.pin_hash) return { error: 'PIN 등록 또는 담당자 복구가 필요해요.' };
  const r = await checkPin(row, str(body.pin));
  return r.ok ? { ok: true, ver: row.ver } : r;
}

/** 로그인 상태의 PIN 변경은 현재 PIN 확인 후 버전 조건으로 저장한다. */
async function setPin(body) {
  const actor = requireActor(), row = await pinRow(actor.memberId);
  if (!row?.pin_hash) return { error: '먼저 최초 등록 또는 담당자 복구를 진행해 주세요.' };
  const error = newPinError(str(body.pin)); if (error) return { error };
  const checked = await checkPin(row, str(body.oldPin)); if (!checked.ok) return checked;
  return savePin('change', normId(actor.memberId), str(body.pin), { expectedVer: row.ver });
}
async function removePin() { return { error: '계정 보호를 위해 PIN을 해제할 수 없어요. PIN 변경이나 담당자 복구를 이용해 주세요.' }; }

/** 최초 등록: 명단·기존 번호를 대조하고, 연락처는 출처를 구분해 비공개로 함께 저장한다. */
async function registerPin(body) {
  const nid = normId(body.memberId), phone = normalizePhone(body.phone);
  if (!/^[0-9]{8,40}$/.test(nid) || !str(body.name) || !str(body.dept) || !/^01[016789][0-9]{7,8}$/.test(phone)) {
    return { error: '부서·이름·고유번호·휴대전화 번호를 확인해 주세요.' };
  }
  return savePin('register', nid, str(body.pin), { name: str(body.name).slice(0,80), dept: str(body.dept).slice(0,40), phone });
}

/** 복구 담당자에게만 대상자의 등록 연락처를 보여준다. 소유 인증 여부와 관계없이 연락 확인에 쓸 수 있다. */
async function getPinRecoveryContact(body) {
  const actor = requireActor();
  if (!(await isApprover(actor.memberId))) return { error: 'PIN 복구 담당자만 연락처를 확인할 수 있어요.' };
  const nid = normId(body.targetId);
  if (!/^[0-9]{8,40}$/.test(nid)) return { error: '대상자의 고유번호를 확인해 주세요.' };
  const roles = await memberRoles(nid), person = roles.teacher || roles.admins[0];
  if (!person) return { error: '명단에서 대상자를 찾지 못했어요.' };
  const [registered, profiles] = await Promise.all([
    run(db().from('member_registration_contacts').select('phone,source,invalidated_at').eq('nid', nid).limit(1)),
    run(db().from('teacher_profiles').select('phone').eq('nid', nid)),
  ]);
  const invalidPhones = new Set(registered.filter(r => r.invalidated_at).map(r => normalizePhone(r.phone)));
  const contacts = new Map();
  for (const item of [...registered, ...roles.admins.map(r => ({phone:r.phone,source:'admin_roster'})), ...profiles.map(r => ({phone:r.phone,source:'teacher_profile'}))]) {
    const phone = normalizePhone(item.phone);
    if (!/^01[016789][0-9]{7,8}$/.test(phone) || contacts.has(phone)) continue;
    contacts.set(phone, {phone,source:item.source,disputed:invalidPhones.has(phone)});
  }
  return { ok:true, name:person.name, memberId:person.member_id,
    depts:[...new Set([roles.teacher, ...roles.admins].filter(Boolean).map(r => r.dept))], contacts:[...contacts.values()] };
}

/** 담당자가 등록 번호로 연락하거나 직접 만나 본인을 확인한 뒤 한 번 쓰는 복구 코드를 발급한다. */
async function resetPin(body) {
  const actor = requireActor();
  if (!(await isApprover(actor.memberId))) return { error: 'PIN 복구는 교육·전도 담당 관리자만 할 수 있어요.' };
  if (body.identityConfirmed !== true || !['PIN 분실','선등록 신고','명단 연락처 확인'].includes(body.reason)) return { error: '본인 확인과 복구 사유를 입력해 주세요.' };
  const nid = normId(body.targetId);
  if (!/^[0-9]{8,40}$/.test(nid)) return { error: '대상자의 고유번호를 확인해 주세요.' };
  const row = await pinRow(actor.memberId);
  if (!row?.pin_hash) return { error: '담당자 PIN을 먼저 등록해 주세요.' };
  const checked = await checkPin(row, str(body.adminPin)); if (!checked.ok) return checked;
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const code = Array.from({length:16}, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  const result = await run(db().rpc('pin_account_action', { p: { op:'issue', nid, codeHash:recoveryHash(code), ver:crypto.randomUUID(), actorId:actor.nid, actorVer:row.ver, actorName:actor.name, reason:body.reason } }));
  return result?.ok ? { ...result, recoveryCode:code.match(/.{4}/g).join('-') } : result;
}
async function recoverPin(body) {
  const nid = normId(body.memberId), code = codeText(body.code);
  if (!/^[0-9]{8,40}$/.test(nid) || !/^[2-9A-HJ-NP-Z]{16}$/.test(code)) return { error: '고유번호와 담당자가 발급한 복구 코드를 확인해 주세요.' };
  return savePin('recover', nid, str(body.pin), { name:str(body.name).slice(0,80), dept:str(body.dept).slice(0,40), codeHash:recoveryHash(code) });
}

// 표(member_pins)가 아직 없으면 오류 글 대신 안내
const safe = (fn) => async (body) => {
  try { return await fn(body); }
  catch (e) { if (/member_pins/.test(String(e.message))) return { error: '핀번호 기능을 준비하고 있어요. 조금 뒤에 다시 해 주세요.' }; throw e; }
};
export default { registerPin: safe(registerPin), recoverPin: safe(recoverPin), getPinRecoveryContact, pinStatus, verifyPin: safe(verifyPin), setPin: safe(setPin), removePin: safe(removePin), resetPin: safe(resetPin) };
