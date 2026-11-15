// 전용 인증을 기존/새 API와 교차 검증한다. 실제 키·DB·외부망 사용 금지.
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { fileStorage } from './helpers/backup-file-storage.mjs';
import { webHandler } from '../server/lib/web-handler.js';
import { probeBackup } from '../tools/backup-watch.mjs';
const variant = process.env.BACKUP_WATCH_TEST_VARIANT === 'legacy' ? 'legacy' : 'candidate';
const base = new URL(`../../.local-backup-watch-auth-20261115/${variant}/`, import.meta.url);
for (const key of Object.keys(process.env)) if (/SUPABASE|AUTH_SIGNING|TEACHER|TELEGRAM|BOT_TOKEN|R2_|ATTEND_|GEMINI|VERCEL|BACKUP_WATCH_KEY/.test(key)) delete process.env[key];
const key = 'tsbw_' + 'a'.repeat(64), rotated = 'tsbw_' + 'b'.repeat(64), cron = 'fixture-cron-only';
const hash = value => createHash('sha256').update(value).digest('hex');
let storage, dbCalls, external;
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { external++; throw Error('External network disabled'); };
const run = async query => { const { data, error } = await query; if (error) throw error; return data; };
mock.module(new URL('server/lib/db.js', base).href, { exports: {
  db: () => { dbCalls++; return { storage: storage.client.storage, rpc: name => {
    assert.equal(name, 'backup_tables'); return Promise.resolve({ data: ['teachers'] });
  }, from: name => { assert.equal(name, 'teachers'); return { select: () => ({ order: () => ({ order: () => ({}) }) }) }; } }; },
  run, selectAll: async () => [{ id: 'fixture-person', private: 'synthetic-private-content' }], isDuplicate: () => false,
} });
const { default: healthHandler } = await import(new URL('api/backup-health.js', base));
const { default: mainHandler } = await import(new URL('api/index.js', base));
const { saveVerifiedBackup } = await import(new URL('server/lib/backup-storage.js', base));
const health = webHandler(healthHandler), main = webHandler(mainHandler);
beforeEach(() => {
  process.env.TEACHERSQUARE_CRON_KEY = cron;
  process.env.TEACHERSQUARE_BACKUP_WATCH_KEY_SHA256 = hash(key);
  storage = fileStorage(); dbCalls = 0; external = 0;
});
afterEach(() => { assert.equal(external, 0); assert.equal(storage.state.blocked, 0); });
async function seed() {
  const counts = { teachers: 1 }, takenAt = new Date().toISOString();
  const made = await saveVerifiedBackup(storage.client, async () => ({ counts, takenAt, bytes: gzipSync(JSON.stringify({ takenAt, counts, data: { teachers: [{ name: 'synthetic-private-content' }] } })) }));
  storage.state.calls = []; dbCalls = 0; return made;
}
const watchRequest = (token = key, extra = {}) => health(new Request('http://localhost/api/backup-health', { headers: { authorization: `Bearer ${token}` }, ...extra }));
const requestMain = body => main(new Request('http://localhost/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
function snapshot(dir = storage.state.root) {
  return Object.fromEntries(readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? Object.entries(snapshot(dir + '/' + e.name)) : [[dir + '/' + e.name, hash(readFileSync(dir + '/' + e.name))]]));
}
function readOnlyCalls() { assert.ok(storage.state.calls.every(c => c.method === 'GET' || (c.method === 'POST' && c.path === '/storage/v1/object/list/backups'))); }

test(`${variant}: 전용 키로 정상 조회, 응답 최소화, 파일·DB 쓰기 없음`, async () => {
  const made = await seed(), before = snapshot(); const r = await watchRequest(); const body = await r.json();
  assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store'); assert.equal(r.headers.get('vary'), 'Authorization');
  assert.equal(r.headers.get('access-control-allow-origin'), null); assert.equal(body.verification, 'sha256'); assert.equal(body.health.lastSuccessAt, made.completedAt);
  assert.deepEqual(Object.keys(body.health).sort(), ['checkedAt','lastSuccess','lastSuccessAt','latestAttempt','state']);
  assert.deepEqual(Object.keys(body.health.lastSuccess).sort(), ['completedAt','startedAt','status']);
  for (const privateValue of [key, hash(key), cron, made.name, made.sha256, 'synthetic-private-content', 'rows', 'url', 'sizeKB']) assert.ok(!JSON.stringify(body).includes(privateValue));
  assert.ok(storage.state.calls.some(c => c.method === 'GET' && c.path.endsWith('.json.gz'))); readOnlyCalls(); assert.deepEqual(snapshot(), before);
});
test(`${variant}: 누락·오류 키, 기존 예약 키, 해시 원문, 쿠키·URL·body 인증은 저장소 접근 전 거절`, async () => {
  const cases = [watchRequest(rotated), watchRequest(cron), watchRequest(hash(key)), watchRequest(''), watchRequest(key + 'x'),
    health(new Request('http://localhost/api/backup-health?key=' + key)),
    health(new Request('http://localhost/api/backup-health', { headers: { cookie: 'key=' + key } }))];
  for (const r of await Promise.all(cases)) { assert.equal(r.status, 401); assert.deepEqual(await r.json(), { code: 'UNAUTHORIZED' }); }
  let status; await healthHandler({ method: 'GET', headers: { authorization: [`Bearer ${key}`, `Bearer ${key}`] }, body: { key, action: 'backupNow' } }, { setHeader() {}, status(v) { status = v; return this; }, json() {} });
  assert.equal(status, 401); assert.equal(dbCalls, 0); assert.equal(storage.state.calls.length, 0);
});
test(`${variant}: GET 외 메서드는 유효한 키가 있어도 405이며 실행 명령을 받지 않는다`, async () => {
  for (const method of ['POST','PUT','PATCH','DELETE','HEAD','OPTIONS']) {
    const r = await watchRequest(key, { method, ...(!['HEAD','OPTIONS'].includes(method) ? { body: JSON.stringify({ action: 'backupNow', checkOnly: false }) } : {}) });
    assert.equal(r.status, 405); assert.equal(r.headers.get('allow'), 'GET');
  }
  assert.equal(dbCalls, 0); assert.equal(storage.state.calls.length, 0);
});
test(`${variant}: 미설정·잘못된 해시·기존 키 재사용은 감시만 닫고 기존 예약은 유지`, async () => {
  for (const value of ['', 'bad-hash', hash(cron)]) {
    process.env.TEACHERSQUARE_BACKUP_WATCH_KEY_SHA256 = value;
    const r = await watchRequest(); assert.equal(r.status, 503); assert.deepEqual(await r.json(), { code: 'BACKUP_WATCH_UNAVAILABLE' });
    assert.equal(dbCalls, 0);
  }
  const r = await requestMain({ action: 'backupNow', key: cron }); assert.equal(r.status, 200); assert.equal((await r.json()).verified, true);
});
test(`${variant}: 감시 키로 기존 백업 생성·목록·보고·영상 실행 권한을 얻지 못한다`, async () => {
  for (const action of ['backupNow','getBackups','createBackup','tsDailySummary','vtAuto']) {
    const r = await requestMain({ action, key, checkOnly: false }); const b = await r.json();
    assert.ok(b.error, action); assert.equal(b.auth, false, action);
  }
  assert.equal(dbCalls, 0); assert.equal(storage.state.calls.length, 0);
});
test(`${variant}: 키 회전·폐기는 즉시 감시에만 적용, 기존 예약 키 조회 유지`, async () => {
  const made = await seed(); process.env.TEACHERSQUARE_BACKUP_WATCH_KEY_SHA256 = hash(rotated);
  assert.equal((await watchRequest()).status, 401); assert.equal((await watchRequest(rotated)).status, 200);
  delete process.env.TEACHERSQUARE_BACKUP_WATCH_KEY_SHA256; assert.equal((await watchRequest(rotated)).status, 503);
  const r = await requestMain({ action: 'backupNow', key: cron, checkOnly: true }); assert.equal(r.status, 200); assert.equal((await r.json()).health.lastSuccessAt, made.completedAt); readOnlyCalls();
});
test(`${variant}: 파일 변조는 503, 파일명·오류 원문·서명 URL을 공개하지 않는다`, async () => {
  const made = await seed(); const bytes = readFileSync(storage.file(made.name)); bytes[0] ^= 1; writeFileSync(storage.file(made.name), bytes);
  const before = snapshot(), r = await watchRequest(); const body = await r.json();
  assert.equal(r.status, 503); assert.equal(body.health.state, 'file_invalid'); assert.ok(!JSON.stringify(body).includes(made.name)); assert.deepEqual(snapshot(), before); readOnlyCalls();
  storage.state.fault = 'offline'; const failed = await watchRequest(); assert.equal(failed.status, 503); assert.deepEqual(await failed.json(), { code: 'BACKUP_WATCH_UNAVAILABLE' });
});
test(`${variant}: 보관함이 없으면 생성하지 않고 missing을 반환한다`, async () => {
  storage.state.exists = false; const r = await watchRequest(); assert.equal(r.status, 503); assert.equal((await r.json()).health.state, 'missing'); assert.equal(storage.state.exists, false); readOnlyCalls();
});
test(`${variant}: 실제 로컬 HTTP에서 감시 도구→전용 인증→저장소→판정 연결 및 이전 주소 복귀`, async () => {
  await seed(); let available = true; let requests = 0;
  const server = createServer((req, res) => {
    const reply = { setHeader: (k,v) => res.setHeader(k,v), status(n) { res.statusCode=n; return reply; }, json(body) { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(body)); }, end: () => res.end() };
    if (!available || req.url !== '/api/backup-health') { res.statusCode=404; res.end(); return; }
    healthHandler(req, reply).catch(() => { res.statusCode=500; res.end(); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const fetchImpl = (url, options) => { requests++; assert.equal(url, 'https://jesajang-gil.vercel.app/api/backup-health'); assert.equal(options.method,'GET'); assert.equal(options.body,undefined); return realFetch(`http://127.0.0.1:${server.address().port}/api/backup-health`,options); };
    assert.equal((await probeBackup({ key, fetchImpl })).code, 'healthy');
    assert.equal((await probeBackup({ key: rotated, fetchImpl })).code, 'unauthorized');
    available = false; assert.equal((await probeBackup({ key, fetchImpl })).code, 'invalid_response');
    assert.equal(requests, 3); readOnlyCalls();
    // 전용 주소 제거를 가정해도 기존 예약 백업 경로는 그대로다.
    assert.equal((await requestMain({ action: 'backupNow', key: cron })).status, 200);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
