// 시트 → Supabase: 등급변경승인 · 등급변경이력
//   node --env-file=.env tools/import-tiers.mjs
import { readTab, text, wallTime, wallDate } from './lib/sheets.mjs';
import { loadIfEmpty } from './lib/load.mjs';

await loadIfEmpty('tier_approvals', readTab('등급변경승인').map((r) => ({
  member_id: text(r['성도고유번호']), name: text(r['이름']), current_tier: text(r['현재등급']),
  suggested_tier: text(r['제안등급']), reason: text(r['사유']), type: text(r['유형']) || 'auto',
  coach_approver: text(r['승인자1']), coach_approved_at: wallTime(r['승인자1일시']),
  leader_approver: text(r['승인자2']), leader_approved_at: wallTime(r['승인자2일시']),
  status: text(r['상태']), recorded_at: wallTime(r['기록일시']),
})));

await loadIfEmpty('tier_history', readTab('등급변경이력').map((r) => ({
  changed_on: wallDate(r['변경일']), member_id: text(r['고유번호']), name: text(r['이름']),
  prev_tier: text(r['이전등급']), new_tier: text(r['변경등급']), reason: text(r['사유']),
  approver1: text(r['승인자1']), approver2: text(r['승인자2']),
})));
