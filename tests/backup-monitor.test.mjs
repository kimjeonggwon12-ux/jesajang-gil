import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { fileStorage } from './helpers/backup-file-storage.mjs';
import { saveVerifiedBackup, inspectBackups, backupHttpStatus } from '../server/lib/backup-storage.js';
const date = '2026-11-15T03:00:00.000Z', now = () => new Date(date);
const build = async () => {
  const data = { teachers: [{ member_id: '9999999900001', name: '가짜백업' }], app_visits: [{ nid: '9999999900001', visits: 2 }] };
  const counts = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])), takenAt = '2026-11-15 12:00:00';
  return { counts, takenAt, bytes: gzipSync(Buffer.from(JSON.stringify({ takenAt, counts, data }))) };
};
const noWrite = calls => calls.every(c => c.method === 'GET' || c.path.includes('/object/list/'));
test('실제 gzip 파일을 저장하고 SDK로 다시 읽은 뒤에만 완료·최신 성공을 기록한다', async () => {
  const f = fileStorage(), before = new Date('2026-11-15T02:58:00Z'); let clock = before;
  const result = await saveVerifiedBackup(f.client, async () => { const b = await build(); clock = now(); return b; }, undefined, () => clock);
  assert.equal(result.ok, true); assert.equal(result.completedAt, date); assert.equal(result.startedAt, before.toISOString());
  assert.equal(result.verified, true); assert.equal(result.tables, 2); assert.equal(result.rows, 2);
  assert.deepEqual(JSON.parse(gunzipSync(readFileSync(f.file(result.name)))).counts, { teachers: 1, app_visits: 1 });
  assert.equal(f.state.calls.findIndex(c => c.method === 'GET' && c.path.endsWith(result.name)) < f.state.calls.findIndex(c => c.method === 'POST' && c.path.endsWith('.result.json')), true);
  f.state.calls = [];
  const status = await inspectBackups(f.client, now);
  assert.equal(status.health.state, 'healthy'); assert.equal(status.health.lastSuccessAt, date);
  assert.equal(status.rows.length, 1); assert.equal(noWrite(f.state.calls), true);
  assert.equal(f.state.blocked, 0);
  console.log(JSON.stringify({ evidence: 'actual_local_file', root: f.state.root, name: result.name, bytes: result.bytes, sha256: result.sha256, completedAt: result.completedAt }));
});
test('파일 없음·이전 미검증 파일·보관함 없음은 성공으로 표시하지 않고 조회에서 생성하지 않는다', async () => {
  const f = fileStorage(); f.state.exists = false;
  assert.equal((await inspectBackups(f.client, now)).health.state, 'missing');
  assert.equal(noWrite(f.state.calls), true); f.state.exists = true;
  writeFileSync(f.file('backup-20261012-125354.json.gz'), (await build()).bytes);
  const status = await inspectBackups(f.client, now);
  assert.equal(status.health.state, 'unverified'); assert.equal(status.health.lastSuccessAt, null);
  assert.equal(status.rows.length, 1); assert.equal(noWrite(f.state.calls), true);
});
for (const fault of ['upload', 'false_upload', 'corrupt', 'result_write', 'result_read', 'start_write']) test(`${fault}: HTTP 성공/미생성·손상·기록 오류를 실패로 감지하고 과거 파일 보존`, async () => {
  const f = fileStorage(), old = 'backup-20261012-125354.json.gz', oldBytes = (await build()).bytes;
  writeFileSync(f.file(old), oldBytes); f.state.fault = fault;
  await assert.rejects(saveVerifiedBackup(f.client, build, undefined, now), e => e.backupFailure?.failureRecorded === true);
  assert.deepEqual(readFileSync(f.file(old)), oldBytes); assert.equal(f.state.calls.some(c => c.method === 'DELETE'), false);
  f.state.fault = '';
  const status = await inspectBackups(f.client, now);
  assert.equal(status.health.state, 'failed'); assert.equal(status.health.lastSuccessAt, null);
});
test('DB 읽기 실패와 저장소 자체 장애는 실패하며 비밀값을 기록하지 않는다', async () => {
  const f = fileStorage();
  await assert.rejects(saveVerifiedBackup(f.client, () => { throw new Error('private-key-or-row'); }, undefined, now), e => e.backupFailure.stage === 'read_database');
  const status = await inspectBackups(f.client, now);
  assert.equal(status.health.state, 'failed'); assert.equal(JSON.stringify(status).includes('private-key-or-row'), false);
  assert.equal(f.state.calls.some(c => c.method === 'POST' && c.path.endsWith('.json.gz')), false);
  f.state.fault = 'offline';
  await assert.rejects(saveVerifiedBackup(f.client, build, undefined, now), e => e.backupFailure.failureRecorded === false);
  await assert.rejects(inspectBackups(f.client, now));
});
test('주간 성공 후 8일 초과·실행 종료 누락·최신 파일 삭제/동일 크기 변조를 발견한다', async () => {
  const f = fileStorage(), result = await saveVerifiedBackup(f.client, build, undefined, now);
  assert.equal((await inspectBackups(f.client, () => new Date(Date.parse(date) + 8 * 86400000 + 1))).health.state, 'stale');
  const original = readFileSync(f.file(result.name)), corrupt = Buffer.from(original); corrupt[0] ^= 1; writeFileSync(f.file(result.name), corrupt);
  assert.equal((await inspectBackups(f.client, now)).health.state, 'file_invalid');
  writeFileSync(f.file(result.name), original); unlinkSync(f.file(result.name));
  const missing = await inspectBackups(f.client, now); assert.equal(missing.health.state, 'file_missing'); assert.equal(missing.health.lastSuccessAt, date);
  unlinkSync(f.file(`_monitor/${result.name}.result.json`));
  assert.equal((await inspectBackups(f.client, now)).health.state, 'running');
  assert.equal((await inspectBackups(f.client, () => new Date(Date.parse(date) + 16 * 60000))).health.state, 'interrupted');
});
test('동시 백업은 같은 초에도 서로 덮어쓰지 않고 마지막 완료 시각으로 판단한다', async () => {
  const f = fileStorage(); let release; const held = new Promise(r => { release = r; }); let began;
  const beganPromise = new Promise(r => { began = r; });
  let late = now();
  const first = saveVerifiedBackup(f.client, async () => { began(); await held; return build(); }, undefined, () => late);
  await beganPromise;
  const second = await saveVerifiedBackup(f.client, build, undefined, now);
  late = new Date(Date.parse(date) + 60000); release(); const one = await first;
  assert.notEqual(one.name, second.name); assert.ok(existsSync(f.file(one.name)) && existsSync(f.file(second.name)));
  assert.equal((await inspectBackups(f.client, () => late)).health.lastSuccessAt, late.toISOString());
});
test('검증된 최근 8개만 유지하고 예전 미확인 파일은 보존한다', async () => {
  const f = fileStorage(), old = 'backup-20261012-125354.json.gz'; writeFileSync(f.file(old), (await build()).bytes);
  const made = [];
  for (let i = 0; i < 9; i++) made.push(await saveVerifiedBackup(f.client, build, undefined, () => new Date(Date.parse(date) + i * 1000)));
  assert.equal(existsSync(f.file(made[0].name)), false); assert.equal(existsSync(f.file(old)), true);
  assert.equal((await inspectBackups(f.client, () => new Date(Date.parse(date) + 10000))).rows.length, 9);
  f.state.fault = 'false_remove';
  const result = await saveVerifiedBackup(f.client, build, undefined, () => new Date(Date.parse(date) + 11000));
  assert.equal(result.ok, true); assert.equal(result.retentionWarning, true); assert.ok(existsSync(f.file(result.name)));
});
test('손상된 백업 내용·공개 보관함·목록 장애는 통과시키지 않는다', async () => {
  const f = fileStorage(); f.state.public = true;
  await assert.rejects(saveVerifiedBackup(f.client, build, undefined, now));
  assert.equal(f.state.calls.some(c => c.method === 'POST' && c.path.endsWith('.json.gz')), false);
  await assert.rejects(inspectBackups(f.client, now));
  f.state.public = false;
  await assert.rejects(saveVerifiedBackup(f.client, async () => ({ ...(await build()), counts: { teachers: 99 } }), undefined, now), e => e.backupFailure.stage === 'validate_archive');
  f.state.fault = 'list'; await assert.rejects(inspectBackups(f.client, now));
});
test('백업 상태 HTTP 계약만 변경하며 다른 업무 응답은 유지한다', () => {
  assert.equal(backupHttpStatus('backupNow', { checkOnly: true, health: { state: 'failed' } }), 503);
  assert.equal(backupHttpStatus('backupNow', { checkOnly: true, health: { state: 'healthy' } }), 200);
  assert.equal(backupHttpStatus('backupNow', { error: 'key' }), 401);
  assert.equal(backupHttpStatus('getBackups', { error: 'unavailable' }), 503);
  assert.equal(backupHttpStatus('someLegacyAction', { error: 'existing error' }), 200);
});
