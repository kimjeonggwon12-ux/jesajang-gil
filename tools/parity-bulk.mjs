// 옛 서버 응답과 새 코드(이 PC에서 직접 실행, DB 는 Supabase)를 여러 건 한꺼번에 비교한다.
// 읽기 전용 요청만 다룬다.
//   node --env-file=.env tools/parity-bulk.mjs <묶음이름>
import { isDeepStrictEqual } from 'node:util';
import { db, selectAll } from '../server/lib/db.js';
import { actions } from '../server/registry.js';

const LEGACY = process.env.LEGACY_URL;

async function legacy(payload) {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(LEGACY, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload), redirect: 'follow',
      });
      return JSON.parse(await r.text());
    } catch (e) {
      if (attempt >= 3) throw e;   // Apps Script 가 가끔 HTML 오류를 돌려준다 — 몇 번 다시 시도
    }
  }
}

function firstDiff(a, b, path = '') {
  if (isDeepStrictEqual(a, b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = firstDiff(a[k], b[k], `${path}/${k}`);
      if (d) return d;
    }
  }
  return `${path || '/'}: 옛=${JSON.stringify(a)?.slice(0, 90)} 새=${JSON.stringify(b)?.slice(0, 90)}`;
}

const distinct = async (table, column) =>
  [...new Set((await selectAll(() => db().from(table).select(column).order('id'))).map((r) => r[column]).filter(Boolean))];

/** 묶음별 비교 대상 요청 목록. */
const suites = {
  async activities() {
    const members = await distinct('activities', 'member_id');
    const targets = await selectAll(() => db().from('targets').select('target_id, creator_id').order('id'));
    const owners = [...new Set(targets.map((t) => t.creator_id))];
    return [
      { action: 'getAllActivities' },
      ...members.map((memberId) => ({ action: 'getMyActivities', memberId })),
      ...[...new Set([...members, ...owners])].flatMap((memberId) => [
        { action: 'getTargets', memberId },
        { action: 'getMyEncouragements', memberId },
        { action: 'getMyGospelLeads', memberId },
      ]),
      ...targets.map((t) => ({ action: 'getTargetJournal', memberId: t.creator_id, targetId: t.target_id })),
    ];
  },
};

const suite = suites[process.argv[2]];
if (!suite) { console.error('묶음 이름:', Object.keys(suites).join(', ')); process.exit(1); }

const cases = await suite();
const failed = {};
let done = 0;
const queue = [...cases];
await Promise.all(Array.from({ length: 6 }, async () => {
  for (let c; (c = queue.shift());) {
    const [oldR, newR] = await Promise.all([legacy(c), actions[c.action](c)]);
    const diff = firstDiff(oldR, JSON.parse(JSON.stringify(newR)));
    if (diff) (failed[c.action] ||= []).push(diff);
    if (++done % 40 === 0) console.log(`${done}/${cases.length}`);
  }
}));

const byAction = {};
for (const c of cases) byAction[c.action] = (byAction[c.action] || 0) + 1;
for (const [action, n] of Object.entries(byAction)) {
  const bad = failed[action] || [];
  console.log(`${bad.length ? '✗' : '✓'} ${action}: ${n - bad.length}/${n} 일치`);
  bad.slice(0, 4).forEach((d) => console.log('    ' + d));
}
process.exit(Object.keys(failed).length ? 1 : 0);
