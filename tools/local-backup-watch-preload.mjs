// 컴파일된 Next 서버 검증용. 모든 외부 통신을 차단하고 가짜 Storage만 허용한다.
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileStorage } from '../tests/helpers/backup-file-storage.mjs';
import { saveVerifiedBackup } from '../server/lib/backup-storage.js';
const f = fileStorage(), key = 'tsbw_' + 'a'.repeat(64), hash = v => createHash('sha256').update(v).digest('hex');
const counts = { teachers: 1 }, takenAt = new Date().toISOString();
await saveVerifiedBackup(f.client, async () => ({ counts, takenAt, bytes: gzipSync(JSON.stringify({ counts, takenAt, data: { teachers: [{ id: 'synthetic' }] } })) }));
const snapshot = (dir = f.state.root) => Object.fromEntries(readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? Object.entries(snapshot(dir + '/' + e.name)) : [[dir + '/' + e.name, hash(readFileSync(dir + '/' + e.name))]]));
const before = JSON.stringify(snapshot()); f.state.calls = []; let external = 0;
Object.assign(process.env, { SUPABASE_URL: 'http://backup.fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-key', TEACHERSQUARE_CRON_KEY: 'fixture-cron-only', TEACHERSQUARE_BACKUP_WATCH_KEY_SHA256: hash(key) });
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.origin !== 'http://backup.fixture.invalid') { external++; throw Error('External network disabled'); }
  return f.fetch(input, init);
};
const evidence = () => writeFileSync(new URL('../artifacts/backup-watch-auth-20261115/next-storage.json', import.meta.url), JSON.stringify({ external, fileHashesUnchanged: before === JSON.stringify(snapshot()), storageCalls: f.state.calls.length,
  readOnlyCalls: f.state.calls.every(c => c.method === 'GET' || (c.method === 'POST' && c.path === '/storage/v1/object/list/backups')),
  archiveReads: f.state.calls.filter(c => c.method === 'GET' && c.path.endsWith('.json.gz')).length }, null, 2));
process.on('exit', evidence);
process.on('SIGTERM', () => { evidence(); process.exit(0); });
