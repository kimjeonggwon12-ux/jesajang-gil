import { randomBytes, createHash } from 'node:crypto';
import { db, run } from '../lib/db.js';
import { normId } from '../lib/util.js';
import { requireActor, AccessError } from '../lib/request-context.js';
import { isAdmin, isOwner } from './roster.js';
import { pinRow } from './pins.js';
import { pinVersion } from '../lib/auth.js';
import { EDUCATION_TASKS, educationTasksForScope, educationGrants, requireEducationOwner } from '../lib/education-access.js';

export async function educationAccess() {
  const actor = requireActor(), grants = await educationGrants(actor);
  const [link] = await run(db().from('education_telegram_links').select('pin_version').eq('nid', actor.nid).limit(1));
  return { owner: isOwner(actor.nid), eligible: await isAdmin(actor.nid), grants: grants || [], tasks: EDUCATION_TASKS, telegramLinked: !!link && link.pin_version === actor.pinVersion };
}
async function scopeExists(type, id) {
  const def = {cohort:['cohorts','cohort_id'], meeting:['attend_meetings','meeting_id'], series:['attend_series','series_id']}[type];
  if (!def) throw new AccessError('교육 종류를 확인해 주세요.',400);
  const [row] = await run(db().from(def[0]).select('*').eq(def[1],id).neq('status','삭제').limit(1));
  if (!row || (type === 'meeting' && (row.cohort_id || row.series_id))) throw new AccessError('교육 과정이나 정기 교육에 연결된 모임은 해당 교육에서 지정해 주세요.',400);
}
async function educationDelegations(body) {
  requireEducationOwner();
  await scopeExists(body.scopeType,body.scopeId);
  return { items: await run(db().from('education_delegations').select('nid, permissions, revoked, updated_at').eq('scope_type',body.scopeType).eq('scope_id',body.scopeId).order('id')), tasks: educationTasksForScope(body.scopeType) };
}
async function educationSetDelegation(body) {
  const actor = requireEducationOwner();
  const nid = normId(body.targetId), permissions = [...new Set(Array.isArray(body.permissions) ? body.permissions : [])];
  await scopeExists(body.scopeType,body.scopeId);
  if (nid === '0' || isOwner(nid)) throw new AccessError('위임할 관리자 고유번호를 확인해 주세요.',400);
  if (permissions.length && !(await isAdmin(nid))) throw new AccessError('현재 관리자로 지정된 사람에게만 위임할 수 있어요.');
  const allowed = Object.keys(educationTasksForScope(body.scopeType));
  if (permissions.some(p => !allowed.includes(p))) throw new AccessError('위임할 업무를 확인해 주세요.',400);
  await run(db().from('education_delegations').upsert({scope_type:body.scopeType,scope_id:body.scopeId,nid,permissions,revoked:!permissions.length,actor_nid:actor.nid,updated_at:new Date().toISOString()}, {onConflict:'scope_type,scope_id,nid'}));
  return {ok:true};
}
async function educationTelegramCode() {
  const actor = requireActor();
  if (!(await isAdmin(actor.nid))) throw new AccessError('교육 담당 관리자만 연결할 수 있어요.');
  const code = randomBytes(24).toString('base64url');
  await run(db().rpc('education_telegram_prepare',{p_nid:actor.nid,p_hash:createHash('sha256').update(code).digest('hex'),p_version:actor.pinVersion}));
  return {ok:true,code,expiresIn:600};
}
async function educationTelegramUnlink() {
  const actor=requireActor();
  await run(db().rpc('education_telegram_prepare',{p_nid:actor.nid,p_hash:'',p_version:''}));
  return {ok:true};
}
export async function connectEducationTelegram(code,userId) {
  if (!/^[A-Za-z0-9_-]{32}$/.test(code) || !/^[1-9]\d{0,19}$/.test(String(userId))) return false;
  return run(db().rpc('education_telegram_consume',{p_hash:createHash('sha256').update(code).digest('hex'),p_user_id:String(userId)}));
}
export async function telegramEducationActor(msg) {
  if (!msg.from || msg.from.is_bot || msg.sender_chat || !/^[1-9]\d{0,19}$/.test(String(msg.from.id))) return null;
  const [link] = await run(db().from('education_telegram_links').select('nid,pin_version').eq('tg_user_id',String(msg.from.id)).limit(1));
  if (!link || !(await isAdmin(link.nid))) return null;
  const pin = await pinRow(link.nid);
  if (!pin?.pin_hash || pinVersion(pin) !== link.pin_version) return null;
  return {nid:link.nid,memberId:link.nid,pinVersion:link.pin_version};
}
export default {educationAccess, educationDelegations, educationSetDelegation, educationTelegramCode, educationTelegramUnlink};
