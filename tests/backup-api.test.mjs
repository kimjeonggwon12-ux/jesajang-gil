// 실제 인증/백업/API/Web 어댑터. DB만 가짜, Storage는 SDK + 로컬 실제 파일.
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import * as fake from './helpers/fake-db.mjs';
import { fileStorage } from './helpers/backup-file-storage.mjs';
for (const key of Object.keys(process.env)) if (/SUPABASE|TEACHERSQUARE|GEMINI|TELEGRAM|R2_|ATTEND_|BOT_TOKEN|VERCEL/.test(key)) delete process.env[key];
Object.assign(process.env, { AUTH_SIGNING_KEY: 'local-only-auth-test-key-32-bytes-or-more', SUPABASE_SERVICE_ROLE_KEY: 'local-only-key', TEACHERSQUARE_CRON_KEY: 'local-only-cron', TEACHERSQUARE_SYSTEM_OWNER_ID: '9900000000001' });
let storage, failDb = false, actorValid = true, external = 0;
globalThis.fetch = async () => { external++; throw new Error('External network disabled'); };
mock.module('../server/lib/db.js', { exports: { db: () => ({ ...fake.db(), storage: storage.client.storage, rpc(name, args) {
  if (name === 'backup_tables') return Promise.resolve(failDb ? { error: { message: 'column app_visits.id does not exist' } } : { data: ['teachers', 'app_visits'] });
  if (name === 'sensitive_actor_valid') return Promise.resolve({ data: actorValid });
  return fake.db().rpc(name, args);
} }), run: fake.run, selectAll: fake.selectAll, isDuplicate: fake.isDuplicate } });
const { default: handler } = await import('../api/index.js');
const { webHandler } = await import('../server/lib/web-handler.js');
const { tokenFor, pinVersion } = await import('../server/lib/auth.js');
const { forgetRoster } = await import('../server/actions/roster.js');
const owner = '9900000000001', member = '9900000000002', admin = '9900000000003';
const people = [owner, member, admin, '7777'].map((nid, i) => ({ nid, member_id: nid, name: '가짜백업' + i, dept: i === 2 ? '교육부' : '청년회', position: '', region: '1지역', tier:'활동교사', note:'', affiliation:'' }));
const pin = { pin_hash: scryptSync('582946', 'local-test-salt', 32).toString('hex'), salt: 'local-test-salt', ver: 'seed' };
const token = nid => tokenFor(nid, 'm', { pinVersion: pinVersion({ ...pin, nid }) });
beforeEach(() => { fake.reset({ teachers: people, admins: [{ ...people[2], id: 1 }], member_pins: people.map(p => ({ ...pin, nid: p.nid })) }); forgetRoster(); storage = fileStorage(); failDb = false; actorValid = true; external = 0; });
afterEach(() => { assert.equal(external, 0); assert.equal(storage.state.blocked, 0); });
async function request(body) {
  const r = await webHandler(handler)(new Request('http://localhost/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json(), cache: r.headers.get('Cache-Control') };
}
test('예약 인증 실패는 401이며 상태 확인도 인증 없이는 조회하지 않는다', async () => {
  for (const key of [undefined, 'wrong']) assert.equal((await request({ action: 'backupNow', key, checkOnly: true })).status, 401);
  assert.equal(storage.state.calls.length, 0);
});
test('실제 API에서 과거 HTTP200 속 오류를 503으로 바꾸고 기록한 실패를 조회한다', async () => {
  failDb = true;
  const r = await request({ action: 'backupNow', key: 'local-only-cron' });
  assert.equal(r.status, 503); assert.equal(r.body.code, 'BACKUP_FAILED'); assert.equal(r.body.stage, 'read_database');
  assert.equal(r.body.failureRecorded, true); assert.equal(JSON.stringify(r).includes('app_visits'), false);
  const s = await request({ action: 'backupNow', key: 'local-only-cron', checkOnly: true });
  assert.equal(s.status, 503); assert.equal(s.body.health.state, 'failed'); assert.equal(s.body.health.lastSuccessAt, null);
});
test('예약 성공 후 상태 확인은 파일을 만들지 않고 마지막 확인된 성공을 반환한다', async () => {
  const made = await request({ action: 'backupNow', key: 'local-only-cron' });
  assert.equal(made.status, 200); assert.equal(made.body.verified, true); assert.equal(made.body.tables, 2);
  storage.state.calls = [];
  const s = await request({ action: 'backupNow', key: 'local-only-cron', checkOnly: true });
  assert.equal(s.status, 200); assert.equal(s.body.health.lastSuccessAt, made.body.completedAt); assert.equal(s.cache, 'no-store');
  assert.ok(storage.state.calls.every(c => c.method === 'GET' || c.path.includes('/object/list/')));
});
test('백업 목록은 책임자만 접근하고 일반 교사·교육 관리자·사칭은 차단한다', async () => {
  for (const id of [member, admin]) assert.equal((await request({ action: 'getBackups', _tk: token(id) })).status, 403);
  assert.equal((await request({ action: 'getBackups', _tk: token(member), memberId: owner })).status, 403);
  assert.equal((await request({ action: 'getBackups' })).status, 401);
  assert.equal(storage.state.calls.length, 0);
  storage.state.exists = false;
  const r = await request({ action: 'getBackups', _tk: token(owner) });
  assert.equal(r.status, 200); assert.equal(r.body.health.state, 'missing'); assert.equal(storage.state.exists, false);
});
test('백업 도중 권한 만료는 기존 401을 유지한다', async () => {
  actorValid = false;
  const r = await request({ action: 'createBackup', _tk: token(owner) });
  assert.equal(r.status, 401); assert.equal(r.body.auth, false); assert.equal(storage.state.calls.length, 0);
});
test('책임자의 수동 백업도 파일 검증 뒤에만 다운로드 주소를 받는다', async () => {
  const r = await request({ action: 'createBackup', _tk: token(owner) });
  assert.equal(r.status, 200); assert.equal(r.body.verified, true); assert.ok(r.body.url.includes(r.body.name));
  assert.equal(storage.state.calls.at(-1).path.includes('/object/sign/backups/'), true);
  const s = await request({ action: 'getBackups', _tk: token(owner) });
  assert.equal(s.body.health.lastSuccessAt, r.body.completedAt);
});
test('첫 화면 요약은 최종 책임자만 조회하며 옛 최고관리자·일반 관리자·사칭·손님도 차단한다', async () => {
  for (const id of [member, admin, '7777']) {
    const permissions = (await request({ action: 'checkAdmin', _tk: token(id) })).body.permissions;
    assert.equal(permissions.canViewBackupStatus, false);
    assert.equal((await request({ action: 'getBackupSummary', _tk: token(id) })).status, 403);
  }
  assert.equal((await request({ action: 'getBackupSummary', _tk: token(member), memberId: owner })).status, 403);
  assert.equal((await request({ action: 'getBackupSummary' })).status, 401);
  assert.equal((await request({ action: 'getBackupSummary', _tk: tokenFor('9900000000099', 'g', { roomId: 'local-room' }) })).status, 403);
  assert.equal(storage.state.calls.length, 0);
  assert.equal((await request({ action: 'checkAdmin', _tk: token(owner) })).body.permissions.canViewBackupStatus, true);
});
test('첫 화면 요약은 작은 비공개 응답이며 권한 만료·저장소 장애를 정상으로 처리하지 않는다', async () => {
  await request({ action: 'backupNow', key: 'local-only-cron' });
  storage.state.calls = [];
  const r = await request({ action: 'getBackupSummary', _tk: token(owner) });
  assert.equal(r.status, 200); assert.equal(r.body.state, 'healthy'); assert.equal(r.cache, 'no-store');
  assert.deepEqual(Object.keys(r.body).sort(), ['checkedAt','lastSuccessAt','latestAttemptAt','state','verification']);
  assert.ok(!storage.state.calls.some(c => c.method === 'GET' && c.path.endsWith('.json.gz')));
  assert.ok(storage.state.calls.every(c => c.method === 'GET' || c.path.includes('/object/list/')));
  actorValid = false; storage.state.calls = [];
  assert.equal((await request({ action: 'getBackupSummary', _tk: token(owner) })).status, 401); assert.equal(storage.state.calls.length, 0);
  actorValid = true; storage.state.fault = 'offline';
  const failed = await request({ action: 'getBackupSummary', _tk: token(owner) }); assert.equal(failed.status, 503); assert.equal(failed.body.state, undefined);
});
