// 2026-11-06 입장 확인 — 부서 + 고유번호 + 이름이 교사명단 또는 관리자 명단과 맞아야 입장 표(token). (server/lib/auth.js)
// 손님(명단에 없는 분) — 살아 있는 대화방 초대 링크가 있을 때만 손님 표(초대받은 대화방만).
import { randomBytes } from 'node:crypto';
import { db, run } from '../lib/db.js';
import { normId, str, kstDateTime, fmtTs } from '../lib/util.js';
import { tokenFor, pinVersion } from '../lib/auth.js';
import { currentActor } from '../lib/request-context.js';
import { pinRow, checkPin } from './pins.js';
import { LOGIN_DEPTS } from '../../shared/login-options.js';
export { LOGIN_DEPTS } from '../../shared/login-options.js';

const bare = (s) => str(s).replace(/\s+/g, '');

async function rosterRows(nid) {
  const [ts, as] = await Promise.all([
    run(db().from('teachers').select('member_id, name, dept').eq('nid', nid)),
    run(db().from('admins').select('member_id, name, dept').eq('nid', nid)),
  ]);
  return ts.concat(as);
}

async function verifyLogin(body) {
  const id = str(body.memberId), name = bare(body.name), dept = str(body.dept);
  if (id.replace(/\D/g, '').length < 8 || !name) return { error: '고유번호와 이름을 확인해 주세요.', notListed: true };
  if (!dept) return { error: '부서를 골라 주세요.', needDept: true, depts: LOGIN_DEPTS };
  const rows = await rosterRows(normId(id));
  if (!rows.length) return { error: '교사명단에 등록된 고유번호가 아니에요. 고유번호를 확인해 주세요.\n(출석 QR이나 대화방 초대 링크로 오신 분은 손님으로 들어올 수 있어요.)', notListed: true };
  const named = rows.filter((r) => bare(r.name) === name);
  if (!named.length) return { error: '고유번호와 이름이 명단과 맞지 않아요. 이름을 확인해 주세요.', mismatch: 'name' };
  const hit = named.find((r) => bare(r.dept) === bare(dept));
  if (!hit) return { error: '부서가 명단과 맞지 않아요. 부서를 확인해 주세요.', mismatch: 'dept' };
  // 핀번호를 정한 사람(관리자 등)은 서버에서 핀까지 맞아야 입장 — 앱 소스에 적힌 번호를 알아도 못 들어옴
  const pr = await pinRow(hit.member_id);
  if (!pr?.pin_hash) return { error: pr ? '담당자에게 본인 확인 후 복구 코드를 받아 주세요.' : '처음 이용하실 때는 휴대전화 번호와 PIN을 등록해 주세요.', ...(pr ? { needsRecovery: true } : { needsRegistration: true }) };
  if (pr?.pin_hash) {
    if (!str(body.pin)) return { error: '핀번호를 정해 두셨어요. 핀번호를 넣어 주세요.', needPin: true };
    const c = await checkPin(pr, str(body.pin));
    if (!c.ok) return { ...c, needPin: true };
  }
  return { ok: true, token: tokenFor(hit.member_id, 'm', { pinVersion: pinVersion(pr) }), name: str(hit.name), pinVer: pr?.pin_hash ? pr.ver : '' };
}

/** 손님 입장 — 초대 코드가 살아 있어야 손님 표. 명단에 있는 분은 일반 입장으로. */
async function guestLogin(body) {
  const id = str(body.memberId), name = str(body.name).slice(0, 20), code = str(body.code).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (id.replace(/\D/g, '').length < 8 || !name) return { error: '고유번호와 이름을 확인해 주세요.' };
  if (!str(body.dept)) return { error: '부서를 골라 주세요.' };
  const nid = normId(id);
  if ((await rosterRows(nid)).length) return { error: '교사명단에 있는 분이에요. 부서·고유번호·이름으로 입장해 주세요.', listed: true };
  if (code.length === 8) {
    const [inv] = await run(db().from('target_room_invites').select('*').eq('code', code).limit(1));
    if (inv && !inv.revoked && fmtTs(inv.expires_at) > kstDateTime() && inv.uses < inv.max_uses) {
      const actor = currentActor();
      // 손님이 입력한 번호는 인증 근거가 아니다. 신규 입장마다 충돌하기 어려운 별도 식별자를 준다.
      // 기존 참여 이력은 같은 기기에 남은 유효한 로그인 표가 있을 때만 이어받는다.
      const guestId = actor?.guest && actor.roomId === inv.target_id
        ? actor.nid : '9' + BigInt('0x' + randomBytes(12).toString('hex')).toString().padStart(29, '0');
      const guestName = actor?.guest && actor.roomId === inv.target_id ? actor.name : name;
      return { ok: true, token: tokenFor(guestId, 'g', { roomId: inv.target_id, name: guestName }), memberId: guestId, name: guestName, guest: true };
    }
  }
  // 번호와 이름만으로 기존 손님의 계정을 다시 발급하지 않는다.
  return { error: '명단에 없는 분은 담당 교사가 보낸 대화방 초대 링크로만 들어올 수 있어요.' };
}

export default { verifyLogin, guestLogin };
