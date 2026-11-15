import { timingSafeEqual } from 'node:crypto';
import { tokenInfo, pinVersion, PUBLIC_ACTIONS, GUEST_ACTIONS, CRON_ACTIONS } from './auth.js';
import { pinRow } from '../actions/pins.js';
import { memberRoles } from '../actions/roster.js';
import { normId } from './util.js';
import { AccessError } from './request-context.js';

// 이 기능들의 memberId/name은 작업자가 아니라 조회·변경 대상이다.
const TARGET_MEMBER_ACTIONS = new Set([
  'previewRosterLeader', 'upsertRosterLeader', 'getRequiredEducation', 'updateRequiredEducation', 'getConnectCard',
]);
const FROM_ACTIONS = new Set(['sendMessage', 'shareContact', 'sendEncouragement', 'recordMatch']);
const COACH_ACTIONS = new Set(['getCoachFeedbacks', 'submitCoachReply']);

function cronMatches(value) {
  const key = process.env.TEACHERSQUARE_CRON_KEY;
  if (!key || typeof value !== 'string') return false;
  const a = Buffer.from(key), b = Buffer.from(value);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function actorFromToken(token) {
  const who = tokenInfo(token);
  if (!who) return null;
  if (who.guest) return { ...who, memberId: who.nid };
  const [roles, pin] = await Promise.all([memberRoles(who.nid), pinRow(who.nid)]);
  if (!pin?.pin_hash || (!roles.teacher && !roles.admins.length) || who.pinVersion !== pinVersion(pin)) return null;
  const row = roles.teacher || roles.admins[0];
  return { ...who, ...roles, memberId: row.member_id, name: row.name };
}

function bindId(body, field, actor) {
  if (body[field] != null && String(body[field]).trim() && normId(body[field]) !== actor.nid) {
    throw new AccessError('로그인한 본인의 정보로 요청해 주세요.');
  }
  body[field] = actor.memberId;
}

export async function authenticateRequest(action, input) {
  const body = { ...input };
  const token = body._tk;
  delete body._tk;
  delete body._actor;
  delete body.auth;
  if (CRON_ACTIONS.has(action)) {
    if (!cronMatches(body.key)) throw new AccessError('예약 작업 인증이 필요해요.', 401);
    return { actor: { cron: true }, body };
  }
  if (PUBLIC_ACTIONS.has(action)) {
    // QR 제출은 로그인 없이 유지한다. 기존 기록 열람은 별도로 본인 세션을 확인한다.
    const actor = token ? await actorFromToken(token) : null;
    return { actor, body };
  }
  const actor = await actorFromToken(token);
  if (!actor) throw new AccessError('로그인이 만료됐어요. 다시 들어와 주세요.', 401);
  if (actor.guest) {
    if (!GUEST_ACTIONS.has(action)) throw new AccessError('손님은 초대받은 대화방만 사용할 수 있어요.');
    if (!['listMyRooms', 'joinRoomByCode'].includes(action) && body.targetId !== actor.roomId) {
      throw new AccessError('초대받은 방만 열 수 있어요.');
    }
  }
  if (!TARGET_MEMBER_ACTIONS.has(action)) {
    bindId(body, 'memberId', actor);
    body.name = actor.name;
  }
  if (FROM_ACTIONS.has(action)) { bindId(body, 'fromId', actor); body.fromName = actor.name; }
  if (COACH_ACTIONS.has(action)) { bindId(body, 'coachId', actor); body.coachName = actor.name; }
  body.viewerId = actor.memberId;
  if (action === 'applyEventAttendee') { bindId(body, 'applicantId', actor); body.applicantName = actor.name; }
  if (action === 'saveCalendarEvent') body.by = actor.memberId;
  return { actor, body };
}
