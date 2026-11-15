// 로그인 때 확인한 권한과 PIN 버전을 저장 직전 DB에서 다시 대조하기 위한 서버 전용 자료.
import {memberRoles} from '../actions/roster.js';
import {pinRow} from '../actions/pins.js';
import {pinVersion} from './auth.js';
import {requireActor,AccessError} from './request-context.js';
export async function sensitiveActor() {
  const actor=requireActor(),pin=await pinRow(actor.memberId);
  if(!pin?.pin_hash||pinVersion(pin)!==actor.pinVersion)throw new AccessError('로그인이 바뀌었어요. 다시 들어와 주세요.',401);
  const {teacher,admins}=await memberRoles(actor.memberId);
  return {actorId:actor.memberId,actorNid:actor.nid,actorName:actor.name,actorVer:pin.ver,
    actorState:{teacher:teacher?[teacher.member_id,teacher.name,teacher.dept,teacher.position]:null,
      admins:admins.map(a=>[a.id,a.member_id,a.name,a.dept,a.position])}};
}
