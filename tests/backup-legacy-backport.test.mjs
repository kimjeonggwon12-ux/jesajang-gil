// package-backup-monitor.mjs가 만든 로컬 4파일 백포트를 실제 옛 API에 연결한다.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileStorage } from './helpers/backup-file-storage.mjs';
import { saveVerifiedBackup } from '../server/lib/backup-storage.js';
const workspace = fileURLToPath(new URL('../../', import.meta.url));
const legacy = path.join(workspace, '.local-backup-monitor-20261115/legacy');
const out = path.join(workspace, 'artifacts/backup-monitor-20261115');
const url = name => pathToFileURL(path.join(legacy, name)).href;
for (const key of Object.keys(process.env)) if (/SUPABASE|TEACHERSQUARE|GEMINI|TELEGRAM|R2_|ATTEND_|BOT_TOKEN|VERCEL/.test(key)) delete process.env[key];
process.env.TEACHERSQUARE_CRON_KEY = 'local-only-cron';
globalThis.fetch = async () => { throw new Error('External requests disabled'); };
let storage, snapshot, fail = false; const orders = {};
mock.module(url('server/lib/db.js'), { exports: {
  db: () => ({ storage: storage.client.storage, rpc: async name => { assert.equal(name, 'backup_tables'); if (fail) return { error: { message: 'column app_visits.id does not exist' } }; return { data: Object.keys(snapshot.data) }; },
    from: table => ({ table, select() { return this; }, order(key) { (orders[table] ||= []).push(key); return this; } }) }),
  run: async query => { const { data, error } = await query; if (error) throw new Error(error.message); return data; },
  selectAll: async builder => snapshot.data[builder().table],
} });
mock.module(url('server/actions/roster.js'), { exports: { isApprover: async id => id === '9900000000001' } });
const backup = (await import(url('server/actions/backup.js'))).default;
mock.module(url('server/registry.js'), { exports: { actions: { ...backup, legacyFailure: async () => { throw new Error('old-response'); } } } });
const { default: handler } = await import(url('api/index.js'));
async function request(body) {
  let status, value;
  const res = { setHeader() {}, status(code) { status = code; return this; }, json(data) { value = data; return this; }, end() { return this; } };
  await handler({ method: 'POST', body }, res); return { status, body: value };
}
for (const label of ['legacy-old', 'candidate-new']) test(`기존 서버 백포트: 보존된 ${label} 합성 자료의 실제 파일 내용·정렬·최신 성공 확인`, async () => {
  storage = fileStorage(); fail = false;
  snapshot = JSON.parse(gunzipSync(readFileSync(path.join(workspace, '.local-backup-compat-20261115', label + '.json.gz'))));
  const r = await request({ action: 'backupNow', key: 'local-only-cron' });
  assert.equal(r.status, 200); assert.equal(r.body.verified, true);
  const restored = JSON.parse(gunzipSync(readFileSync(storage.file(r.body.name))));
  assert.deepEqual(restored.data, snapshot.data); assert.deepEqual(restored.counts, snapshot.counts);
  assert.ok(orders.app_visits.every(key => key === 'nid'));
  if (label === 'candidate-new') { assert.ok(orders.site_pilot_members.every(key => key === 'nid')); assert.deepEqual(orders.telegram_update_receipts, ['update_id', 'bot_key']); }
  const s = await request({ action: 'backupNow', key: 'local-only-cron', checkOnly: true });
  assert.equal(s.status, 200); assert.equal(s.body.health.lastSuccessAt, r.body.completedAt);
  copyFileSync(storage.file(r.body.name), path.join(out, label + '-verified.json.gz'));
  writeFileSync(path.join(out, label + '-verified.json'), JSON.stringify({ tables: r.body.tables, rows: r.body.rows, bytes: r.body.bytes, sha256: r.body.sha256, exactDataAndCounts: true, localFile: true, realDbQueried: false, externalRequests: 0, completedAt: r.body.completedAt }, null, 2) + '\n');
});
test('기존 서버도 백업 오류는 503, 틀린 예약 키는 401, 다른 업무 오류는 기존 200 유지', async () => {
  storage = fileStorage(); fail = true;
  const r = await request({ action: 'backupNow', key: 'local-only-cron' });
  assert.equal(r.status, 503); assert.equal(r.body.code, 'BACKUP_FAILED');
  assert.equal((await request({ action: 'backupNow', key: 'wrong', checkOnly: true })).status, 401);
  assert.equal((await request({ action: 'backupNow', key: 'local-only-cron', checkOnly: true })).status, 503);
  const other = await request({ action: 'legacyFailure', key: 'local-only-cron' });
  assert.equal(other.status, 200); assert.equal(other.body.error, 'old-response');
});
test('새 후보도 보존된 81표 전체 파일의 바이트를 변경하지 않고 검증·보관한다', async () => {
  const bytes = readFileSync(path.join(workspace, '.local-backup-compat-20261115/candidate-new.json.gz'));
  const input = JSON.parse(gunzipSync(bytes)), f = fileStorage();
  const r = await saveVerifiedBackup(f.client, async () => ({ bytes, counts: input.counts, takenAt: input.takenAt }));
  assert.deepEqual(readFileSync(f.file(r.name)), bytes); assert.equal(r.tables, 81); assert.equal(r.rows, 43264);
  copyFileSync(f.file(r.name), path.join(out, 'candidate-preserved-verified.json.gz'));
  writeFileSync(path.join(out, 'candidate-preserved-verified.json'), JSON.stringify({ tables: r.tables, rows: r.rows, bytes: r.bytes, sha256: r.sha256, exactBytes: true, localFile: true, realDbQueried: false, externalRequests: 0 }, null, 2) + '\n');
});
