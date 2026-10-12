// 엑셀 반영·되돌리기·백업 점검: 실제 교사관리 엑셀로 미리보기 → 반영 → 스냅샷으로 되돌려 처음과 같은지 확인한다.
//   node --env-file=.env tools/smoke-roster-import.mjs "<엑셀 경로>"
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { db, run, selectAll } from '../server/lib/db.js';
import { actions as a } from '../server/registry.js';

const XLSX = createRequire(import.meta.url)('xlsx');
await import('../roster-excel.js');
const { monthTabs, parse } = globalThis.RosterExcel;

const STAFF = 'ZZTEST-9000071';
const COLUMNS = 'member_id, name, dept, region, affiliation, position, tier, note, tier_changed_at, reg_leads, unreg_leads, counsel, gospel_room, companion, active_state, sort_order';
const fingerprint = async () => {
  const rows = await selectAll(() => db().from('teachers').select(COLUMNS).order('member_id'), 3);
  return { n: rows.length, hash: createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
};

const book = XLSX.readFile(process.argv[2]);
const tab = monthTabs(book.SheetNames)[0];
const parsed = parse((name) => (book.Sheets[name] ? XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, defval: '', raw: true }) : null), tab);
assert.equal(parsed.problems.length, 0, parsed.problems.join(' / '));

let snapshotId = null;
const before = await fingerprint();
try {
  await run(db().from('admins').insert({ member_id: STAFF, name: '시험담당', dept: '전도부', region: '', position: '서기' }));
  const me = { memberId: STAFF, rows: parsed.rows, source: `시험 ${tab}` };

  assert.match((await a.previewRosterImport({ memberId: '00230901-00011', rows: parsed.rows })).error, /교육부·전도부/);
  assert.match((await a.previewRosterImport({ ...me, rows: parsed.rows.slice(0, 50) })).error, /50명뿐/);
  assert.match((await a.previewRosterImport({ ...me, rows: parsed.rows.slice(0, 900) })).error, /너무 적어요/);

  // 미리보기: 아무것도 바뀌지 않는다
  const preview = await a.previewRosterImport({ ...me, applyTiers: true });
  console.log(`미리보기 — 지금 ${preview.before}명 → 반영 뒤 ${preview.after}명 · 추가 ${preview.added.count} · 빠짐 ${preview.removed.count} · 이동 ${preview.moved.count} · 이름 다름 ${preview.renamed.count} · 등급 변경 ${preview.tierChanges.count}`);
  console.log('  빠지는 사람:', preview.removed.rows.map((r) => `${r.name}(${r.position || r.adminPosition || '-'})`).join(', ') || '없음');
  console.log('  이름 다른 사람:', preview.renamed.rows.map((r) => `${r.name}←엑셀 ${r.excelName}`).join(', ') || '없음');
  assert.deepEqual(await fingerprint(), before, '미리보기는 명단을 바꾸면 안 된다');

  // 반영: 빠지는 사람은 남기기로 고르고, 이름은 앱 것을 지킨다
  const keepIds = preview.removed.rows.map((r) => r.memberId);
  const withKeep = await a.previewRosterImport({ ...me, applyTiers: true, keepIds });
  assert.equal(withKeep.removed.count, 0); assert.equal(withKeep.kept.count, keepIds.length); assert.equal(withKeep.after, parsed.rows.length + keepIds.length);
  assert.match((await a.applyRosterImport({ ...me, applyTiers: true, keepIds, expectAfter: 1 })).error, /다시 미리보기/);
  const applied = await a.applyRosterImport({ ...me, applyTiers: true, keepIds, expectAfter: withKeep.after });
  assert.equal(applied.ok, true); snapshotId = applied.snapshotId;
  const after = await fingerprint();
  assert.equal(after.n, withKeep.after);
  for (const r of preview.renamed.rows) {
    const [t] = await run(db().from('teachers').select('name').eq('member_id', r.memberId));
    assert.equal(t.name, r.name, '앱에서 쓰던 이름이 지켜져야 한다');
  }
  assert.equal((await a.getRosterLog({ memberId: STAFF })).rows[0].kind, '엑셀 반영');
  console.log(`반영 — ${applied.saved}명 저장, ${applied.removedCount}명 뺌, 스냅샷 ${applied.snapshotId}`);

  // 되돌리기: 스냅샷으로 처음과 똑같아진다
  execFileSync(process.execPath, ['--env-file=.env', 'tools/restore-roster-snapshot.mjs', String(snapshotId)], { stdio: 'inherit' });
  assert.deepEqual(await fingerprint(), before, '되돌린 뒤에는 처음과 같아야 한다');
  console.log('되돌리기 — 처음 명단과 완전히 같음');

  // 백업
  assert.match((await a.createBackup({ memberId: '00230901-00011' })).error, /교육부·전도부/);
  const backup = await a.createBackup({ memberId: STAFF });
  assert.equal(backup.ok, true); assert.match(backup.url, /^https:\/\//);
  const file = Buffer.from(await (await fetch(backup.url)).arrayBuffer());
  const { gunzipSync } = await import('node:zlib');
  const content = JSON.parse(gunzipSync(file).toString('utf8'));
  assert.equal(content.data.teachers.length, before.n);
  assert.equal((await a.getBackups({ memberId: STAFF })).rows.some((f) => f.name === backup.name), true);
  console.log(`백업 — ${backup.name} ${backup.sizeKB}KB, 표 ${backup.tables}개 ${backup.rows}줄, 내려받아 풀어 봄`);
  console.log('점검 통과');
} finally {
  await run(db().from('admins').delete().eq('member_id', STAFF));
  await run(db().from('roster_changes').delete().in('actor_id', [STAFF, '']).in('kind', ['엑셀 반영', '명단 되돌리기']));
  await run(db().from('tier_history').delete().like('reason', '시험 %'));
  if (snapshotId) await run(db().from('roster_snapshots').delete().eq('id', snapshotId));
}
