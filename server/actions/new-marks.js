// 2026-11-06(사용자): 아래 탭 'N' 뱃지 — 교재·영상, 연결에 새 것이 올라왔는지 가볍게 알려 준다.
// 앱은 이 값을 기기에 '본 것'으로 저장해 두고, 커지거나(번호) 새 영상이 생기면 N을 띄운다.
// 번호·키만 주고받는다(사진·본문 없음 — 데이터 사용량 거의 없음).
import { db, run, selectAll } from '../lib/db.js';
import { normId, str } from '../lib/util.js';

const maxId = async (table, nid) => {
  let q = db().from(table).select('id');
  if (nid) q = q.neq('nid', nid);
  const rows = await run(q.order('id', { ascending: false }).limit(1));
  return rows[0] ? Number(rows[0].id) : 0;
};

async function getNewMarks(body) {
  const nid = normId(str(body.memberId));
  const [course, card, helpRows, videos] = await Promise.all([
    maxId('courses'),
    maxId('connect_cards', nid),
    run(db().from('help_posts').select('id, member_id').order('id', { ascending: false }).limit(20)),
    selectAll(() => db().from('videos').select('video_key, status, created_by_id').order('id')),
  ]);
  const help = helpRows.filter((h) => !nid || normId(h.member_id) !== nid).reduce((m, h) => Math.max(m, Number(h.id)), 0);
  const video = videos
    .filter((v) => !['신청', '반려', '삭제'].includes(v.status) && (!nid || normId(v.created_by_id) !== nid))
    .map((v) => v.video_key);
  return { course, card, help, video };
}

export default { getNewMarks };
