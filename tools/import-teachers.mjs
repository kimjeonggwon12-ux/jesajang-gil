// 시트 "교사명단" 탭 → Supabase teachers (내려받은 엑셀에서 읽는다. 표가 비어 있을 때만 넣는다)
//   node --env-file=.env tools/import-teachers.mjs          넣기
//   node --env-file=.env tools/import-teachers.mjs check    넣지 않고, 지금 DB 와 같은지만 본다
import { isDeepStrictEqual } from 'node:util';
import { db, selectAll } from '../server/lib/db.js';
import { readTab, text, wallDate } from './lib/sheets.mjs';
import { loadIfEmpty } from './lib/load.mjs';

const count = (v) => Number(v || 0) || 0;
const seen = new Set();
const records = [];
for (const r of readTab('교사명단')) {
  const memberId = text(r['고유번호']);
  if (!memberId || seen.has(memberId)) continue;
  seen.add(memberId);
  records.push({
    member_id: memberId, name: String(r['이름'] ?? ''), dept: String(r['부서'] ?? ''), region: String(r['지역'] ?? ''),
    affiliation: String(r['소속'] ?? ''), position: String(r['직책'] ?? ''), tier: String(r['교사구분'] ?? ''),
    note: String(r['소속비고'] ?? ''), tier_changed_at: wallDate(r['등급변경일']),
    reg_leads: count(r['센터등록']), unreg_leads: count(r['센터미등록']), counsel: count(r['상담']),
    gospel_room: count(r['복음방']), companion: count(r['동행교사']), active_state: String(r['활동상태'] ?? ''),
    sort_order: records.length + 1,
  });
}

if (process.argv[2] === 'check') {
  const now = await selectAll(() => db().from('teachers').select('*').order('sort_order'), 3);
  const strip = ({ nid, updated_at, ...t }) => t;
  const byId = new Map(now.map((t) => [t.member_id, strip(t)]));
  const different = records.filter((r) => !isDeepStrictEqual(byId.get(r.member_id), r));
  console.log(`엑셀 ${records.length}명 / DB ${now.length}명 / 다른 줄 ${different.length}`);
  for (const r of different.slice(0, 5)) console.log('  엑셀:', JSON.stringify(r).slice(0, 200), '\n  DB  :', JSON.stringify(byId.get(r.member_id) || null).slice(0, 200));
} else {
  await loadIfEmpty('teachers', records);
}
