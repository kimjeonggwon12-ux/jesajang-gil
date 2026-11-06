// 2026-11-06 입장 확인 — 고유번호 + 이름이 교사명단 또는 관리자 명단과 맞아야 입장 표(token)를 준다. (server/lib/auth.js)
import { db, run } from '../lib/db.js';
import { normId, str } from '../lib/util.js';
import { tokenFor } from '../lib/auth.js';

const bare = (s) => str(s).replace(/\s+/g, '');

async function verifyLogin(body) {
  const id = str(body.memberId), name = bare(body.name);
  const digits = id.replace(/\D/g, '');
  if (digits.length < 8 || !name) return { error: '고유번호와 이름을 확인해 주세요.', notListed: true };
  const nid = normId(id);
  const [ts, as] = await Promise.all([
    run(db().from('teachers').select('member_id, name').eq('nid', nid).limit(3)),
    run(db().from('admins').select('member_id, name').eq('nid', nid).limit(3)),
  ]);
  const rows = ts.concat(as);
  if (!rows.length) return { error: '교사명단에 등록된 고유번호가 아니에요. 고유번호를 확인해 주세요.\n(출석 QR로 오신 분은 출석만 할 수 있어요.)', notListed: true };
  const hit = rows.find((r) => bare(r.name) === name);
  if (!hit) return { error: '고유번호와 이름이 명단과 맞지 않아요. 이름을 확인해 주세요.', notListed: true };
  return { ok: true, token: tokenFor(hit.member_id), memberId: hit.member_id, name: str(hit.name) };
}

export default { verifyLogin };
