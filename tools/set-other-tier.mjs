// 11/5(사용자·서무님): 엑셀(신43 10월) 구분 '기타'인데 교사광장에 휴교사로 들어간 분 → 등급 '기타'.
//   이미 활동교사 등으로 바뀐 분(11/5 뒤 출석·기록으로 전환)은 그대로 둔다.  node --env-file=.env tools/set-other-tier.mjs [--apply]
import { db, run, selectAll } from '../server/lib/db.js';
import { kstDate } from '../server/lib/util.js';
const apply = process.argv.includes('--apply');
const all = await selectAll(() => db().from('teachers').select('member_id, name, dept, tier, tier_changed_at, month_stats').order('sort_order'));
const other = all.filter((t) => t.month_stats && t.month_stats.tierRaw === '기타');
const by = (list, k) => list.reduce((m, t) => ((m[t[k] || '(없음)'] = (m[t[k] || '(없음)'] || 0) + 1), m), {});
console.log('엑셀 구분 기타:', other.length, '명 · 지금 등급', JSON.stringify(by(other, 'tier')));
const pick = other.filter((t) => t.tier === '휴교사' && (!t.tier_changed_at || String(t.tier_changed_at).slice(0, 10) <= '2026-11-05'));
console.log('기타로 바꿀 분:', pick.length, '명 · 부서별', JSON.stringify(by(pick, 'dept')));
if (apply && pick.length) {
  const today = kstDate();
  const ids = pick.map((t) => t.member_id);
  for (let i = 0; i < ids.length; i += 200) await run(db().from('teachers').update({ tier: '기타' }).in('member_id', ids.slice(i, i + 200)));   // 적용일(tier_changed_at)은 11/5 그대로 — 기타의 출석 2번 셈이 그날부터
  const hist = pick.map((t) => ({ changed_on: today, member_id: t.member_id, name: t.name, prev_tier: '휴교사', new_tier: '기타', reason: '엑셀 구분 기타(교육 미참석, 활동 또는 인교 1명 이상) → 교사광장도 기타로 표시', approver1: '자동(관리자 요청)' }));
  for (let i = 0; i < hist.length; i += 200) await run(db().from('tier_history').insert(hist.slice(i, i + 200)));
  const after = await selectAll(() => db().from('teachers').select('member_id, dept, tier').order('sort_order'));
  const t = {}; for (const r of after) { const d = r.dept || '(없음)'; t[d] = t[d] || {}; t[d][r.tier] = (t[d][r.tier] || 0) + 1; }
  console.log('적용 완료. 부서별 등급:'); for (const [d, v] of Object.entries(t)) console.log(' ', d, JSON.stringify(v));
}
