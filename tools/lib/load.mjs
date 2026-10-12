// 이관 공통: 표가 비어 있을 때만 넣는다(이미 있으면 건너뜀).
import { db, run } from '../../server/lib/db.js';

export async function loadIfEmpty(table, records) {
  const { count, error } = await db().from(table).select('*', { count: 'exact', head: true });
  if (error) throw new Error(table + ': ' + error.message);
  if (count) { console.log(`${table}: 이미 ${count}행 — 건너뜀`); return; }
  for (let i = 0; i < records.length; i += 500) {
    await run(db().from(table).insert(records.slice(i, i + 500)));
  }
  console.log(`${table}: ${records.length}행`);
}
