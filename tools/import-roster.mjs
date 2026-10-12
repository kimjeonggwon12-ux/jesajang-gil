// 옛 서버(Apps Script)의 교사명단을 그대로 읽어 Supabase teachers 표에 넣는다(다시 돌려도 안전).
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 환경변수 필요
//   node tools/import-roster.mjs
import { db, run } from '../server/lib/db.js';

const LEGACY = 'https://script.google.com/macros/s/AKfycbyXJtQEWGdF6PKv2qstTp3ZgjhMSWfmUShh4uw8Km9LDJjj78WLmGO89HHE0Eb3M5lW/exec';

const res = await fetch(LEGACY, {
  method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify({ action: 'getRoster' }), redirect: 'follow',
});
const { rows } = await res.json();
console.log('옛 서버 명단:', rows.length, '명');

const seen = new Set();
const records = [];
rows.forEach((r, i) => {
  if (seen.has(r.memberId)) { console.warn('고유번호 중복, 뒤쪽 건너뜀:', r.memberId, r.name); return; }
  seen.add(r.memberId);
  records.push({
    member_id: r.memberId, name: r.name, dept: r.dept, region: r.region, affiliation: r.affiliation,
    position: r.position, tier: r.tier, note: r.note,
    tier_changed_at: /^\d{4}-\d{2}-\d{2}$/.test(r.tierChangedAt) ? r.tierChangedAt : null,
    reg_leads: r.regLeads, unreg_leads: r.unregLeads, counsel: r.counsel,
    gospel_room: r.gospelRoom, companion: r.companion, active_state: r.activeState,
    sort_order: i + 1,
  });
});

for (let i = 0; i < records.length; i += 500) {
  await run(db().from('teachers').upsert(records.slice(i, i + 500), { onConflict: 'member_id' }));
}
const [{ count }] = [await db().from('teachers').select('*', { count: 'exact', head: true })];
console.log('Supabase teachers:', count, '명');
