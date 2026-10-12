// 엑셀 반영 직전에 남겨 둔 명단(roster_snapshots)으로 되돌린다. 그 뒤에 추가된 교사는 빠지고, 빠졌던 교사는 돌아온다.
// (등급 변경 이력·변경 기록에 남은 줄은 지우지 않는다 — 되돌렸다는 사실도 기록으로 남긴다.)
//   node --env-file=.env tools/restore-roster-snapshot.mjs            보관된 스냅샷 목록
//   node --env-file=.env tools/restore-roster-snapshot.mjs <번호>     그 스냅샷으로 되돌리기
import { db, run, selectAll } from '../server/lib/db.js';
import { kstDateTime } from '../server/lib/util.js';

const id = Number(process.argv[2]);
if (!id) {
  const list = await run(db().from('roster_snapshots').select('id, taken_at, actor_name, reason').order('id', { ascending: false }).limit(20));
  for (const s of list) console.log(`${s.id}  ${String(s.taken_at).replace('T', ' ')}  ${s.actor_name}  ${s.reason}`);
  if (!list.length) console.log('보관된 스냅샷이 없습니다.');
  process.exit(0);
}

const [snapshot] = await run(db().from('roster_snapshots').select('*').eq('id', id).limit(1));
if (!snapshot) { console.error('그 번호의 스냅샷이 없습니다.'); process.exit(1); }
const COLUMNS = ['member_id', 'name', 'dept', 'region', 'affiliation', 'position', 'tier', 'note', 'tier_changed_at',
  'reg_leads', 'unreg_leads', 'counsel', 'gospel_room', 'companion', 'active_state', 'sort_order'];
const rows = snapshot.teachers.map((t) => Object.fromEntries(COLUMNS.map((c) => [c, t[c]])));
const keep = new Set(rows.map((r) => r.member_id));
const now = await selectAll(() => db().from('teachers').select('member_id').order('member_id'), 3);
const remove = now.map((t) => t.member_id).filter((m) => !keep.has(m));

const result = await run(db().rpc('roster_apply', { p_rows: rows, p_remove: remove }));
await run(db().from('roster_changes').insert({
  changed_at: kstDateTime(), actor_id: '', actor_name: '복구 도구', kind: '명단 되돌리기', target_id: '',
  target_name: `스냅샷 ${id} (${snapshot.reason})`, before: { 인원: now.length }, after: { 인원: rows.length },
}));
console.log(`스냅샷 ${id} 로 되돌림: ${result.saved}명 저장, ${result.removed}명 뺌`);
