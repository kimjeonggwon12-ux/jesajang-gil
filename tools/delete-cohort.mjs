// 교육 과정 하나를 기록까지 영구 삭제(2026-11-16 사용자 요청: 도마지파특전대 교육). 지우기 전에 전부 tools/export/ 에 JSON 백업.
//   node --env-file=.env tools/delete-cohort.mjs <cohortId>          → 지울 줄 수만 보기
//   node --env-file=.env tools/delete-cohort.mjs <cohortId> --apply  → 백업 후 삭제
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'node:fs';
const [id, flag] = process.argv.slice(2);
if (!/^CH\d+$/.test(id || '')) throw new Error('과정 번호(CH…)를 주세요.');
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const get = async (t, col, vals) => {
  const r = await db.from(t).select('*').in(col, vals).limit(100000);
  if (r.error) { if (/does not exist|schema cache/i.test(r.error.message)) return null; throw new Error(t + ': ' + r.error.message); }
  return r.data;
};
const [cohort] = (await get('cohorts', 'cohort_id', [id])) || [];
if (!cohort) throw new Error('과정을 찾지 못했어요: ' + id);
const meetings = await get('attend_meetings', 'cohort_id', [id]);
const mids = meetings.map((m) => m.meeting_id);
// 자식 → 부모 순서
const plan = [
  ['cohort_submissions', 'cohort_id', [id]], ['cohort_scores', 'cohort_id', [id]], ['cohort_assignments', 'cohort_id', [id]],
  ['cohort_exams', 'cohort_id', [id]], ['cohort_schedule', 'cohort_id', [id]], ['cohort_members', 'cohort_id', [id]],
  ['cohort_tg_links', 'cohort_id', [id]], ['cohort_summary_log', 'cohort_id', [id]],
  ...(mids.length ? [['attend_records', 'meeting_id', mids], ['attend_notify_queue', 'meeting_id', mids], ['edu_delivery_log', 'meeting_id', mids], ['cohort_summary_log', 'ref_id', mids]] : []),
  ['attend_meetings', 'cohort_id', [id]], ['cohorts', 'cohort_id', [id]],
];
const backup = { at: new Date().toISOString(), cohortId: id, title: cohort.title, tables: {} };
for (const [t, col, vals] of plan) { const rows = await get(t, col, vals); backup.tables[`${t}:${col}`] = rows; console.log(t.padEnd(22), col.padEnd(10), rows === null ? '(표 없음)' : rows.length); }
const dl = await db.from('education_delegations').select('*').eq('scope_type', 'cohort').eq('scope_id', id);
if (!dl.error) { backup.tables['education_delegations:scope_id'] = dl.data; console.log('education_delegations'.padEnd(22), 'scope_id'.padEnd(10), dl.data.length); }
if (flag !== '--apply') { console.log('\n(보기만 함 — 지우려면 --apply)'); process.exit(0); }
mkdirSync('tools/export', { recursive: true });
const file = `tools/export/cohort-delete-${id}-${Date.now()}.json`;
writeFileSync(file, JSON.stringify(backup));
console.log('\n백업:', file);
if (dl.data?.length) { const r = await db.from('education_delegations').delete().eq('scope_type', 'cohort').eq('scope_id', id); if (r.error) throw new Error('education_delegations: ' + r.error.message); }
for (const [t, col, vals] of plan) {
  if (backup.tables[`${t}:${col}`] === null) continue;
  const r = await db.from(t).delete().in(col, vals);
  if (r.error) throw new Error(`${t} 삭제 실패(여기서 멈춤, 백업으로 복구 가능): ${r.error.message}`);
}
for (const [t, col, vals] of plan) { if (backup.tables[`${t}:${col}`] === null) continue; const r = await db.from(t).select('*', { count: 'exact', head: true }).in(col, vals); console.log('남은 줄', t, r.count); }
