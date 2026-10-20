// 앱 접속 횟수 (2026-10-20) — 앱을 새로 열어 들어올 때 한 번씩 센다. 관리자 교사 명단 '접속' 열에 보인다.
import { db, run } from '../lib/db.js';
import { normId, kstDateTime } from '../lib/util.js';
import { clip } from '../lib/input.js';
import { findTeacher, findAdmin } from './roster.js';

async function logVisit(body) {
  const mid = clip(body.memberId, 40);
  const nid = normId(mid);
  if (!nid) return { ok: false };
  const name = (await findTeacher(mid))?.name || (await findAdmin(mid))?.name || clip(body.name, 20);
  const visits = await run(db().rpc('bump_app_visit', { p_nid: nid, p_member_id: mid, p_name: name || '', p_now: kstDateTime() }));
  return { ok: true, visits };
}

export default { logVisit };
