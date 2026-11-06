// 11/6(사용자): 「전주-교사관리(43년10월)-신43(2026).11.6(1).xlsx」 구분(휴·기타·활·정·우)을 등급으로 다시 적용 — 등급만(이름·지역·명단 빠짐은 그대로)
import { createRequire } from 'node:module';
import { db, run, selectAll } from '../server/lib/db.js';
import { normId, kstDate, kstDateTime } from '../server/lib/util.js';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
await import('../roster-excel.js');
const book = XLSX.readFile(process.argv[2]);
const rowsOf = (n) => (book.Sheets[n] ? XLSX.utils.sheet_to_json(book.Sheets[n], { header: 1, defval: '', raw: true }) : null);
const p = globalThis.RosterExcel.parse(rowsOf, '11.6버전1');
const MAP = { 휴교사: '휴교사', 기타교사: '기타', 기타: '기타', 활동교사: '활동교사', 정교사: '정교사', 우수교사: '우수교사' };
const teachers = await selectAll(() => db().from('teachers').select('*').order('sort_order').order('member_id'), 3);
const cur = new Map(teachers.map((t) => [t.nid, t]));
const changes = [];
for (const r of p.rows) {
  const want = MAP[String(r.activeState).trim()], t = cur.get(normId(r.memberId));
  if (want && t && t.tier !== want) changes.push({ t, want });
}
console.log('바꿀 사람', changes.length);
if (process.argv[3] !== '--apply') process.exit(0);
const now = kstDateTime(), today = kstDate(), source = '전주-교사관리 신43 11.6 엑셀 등급 재적용';
const [snap] = await run(db().from('roster_snapshots').insert({ taken_at: now, actor_id: '0020113000010', actor_name: '김정권', reason: source + ' 직전', teachers }).select('id'));
for (const { t, want } of changes) await run(db().from('teachers').update({ tier: want, tier_changed_at: today }).eq('member_id', t.member_id));
await run(db().from('tier_history').insert(changes.map(({ t, want }) => ({ changed_on: today, member_id: t.member_id, name: t.name, prev_tier: t.tier, new_tier: want, reason: source, approver1: '김정권' }))));
await run(db().from('roster_changes').insert({ changed_at: now, actor_id: '0020113000010', actor_name: '김정권', kind: '등급 재적용', target_id: '', target_name: source, before: { 인원: teachers.length }, after: { '등급 변경': changes.length, 스냅샷: snap.id } }));
const after = await selectAll(() => db().from('teachers').select('tier').order('member_id'), 3);
const c = {}; after.forEach((x) => { c[x.tier] = (c[x.tier] || 0) + 1; });
console.log('적용 완료, 스냅샷', snap.id, '지금 등급:', c);
