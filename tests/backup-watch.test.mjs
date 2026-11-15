import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { fileStorage } from './helpers/backup-file-storage.mjs';
import { inspectBackups, saveVerifiedBackup, backupHttpStatus } from '../server/lib/backup-storage.js';
import { evaluateBackup, latestDueStart, probeBackup, backupSummary } from '../tools/backup-watch.mjs';

const at = '2026-11-14T19:47:00.000Z', now = () => Date.parse(at);
const success = { version: 1, status: 'succeeded', startedAt: '2026-11-14T18:00:00.000Z', completedAt: '2026-11-14T18:00:12.000Z', sha256: 'a'.repeat(64), bytes: 100, tables: 63, rows: 27263 };
const healthy = () => ({ ok: true, checkOnly: true, verification: 'sha256', health: { state: 'healthy', checkedAt: at, lastSuccessAt: success.completedAt, lastSuccess: { ...success } } });
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
const bad = code => { const body = healthy(); body.ok = false; body.health.state = code; return body; };
const config = { key: 'synthetic-key', now };

test('실제 백업 저장/검사 계약을 외부 감시에서 처리하며 검사 중 Storage 쓰기는 없다', async () => {
  const f = fileStorage(); const counts = { teachers: 1 };
  await saveVerifiedBackup(f.client, async () => ({ counts, takenAt: '2026-11-15 04:47:00', bytes: gzipSync(JSON.stringify({ takenAt: '2026-11-15 04:47:00', counts, data: { teachers: [{ id: 'synthetic' }] } })) }), undefined, () => new Date(at));
  f.state.calls = [];
  const status = await inspectBackups(f.client, () => new Date(at));
  const outcome = await probeBackup({ ...config, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://jesajang-gil.vercel.app/api/backup-health');
    assert.equal(options.method, 'GET'); assert.equal(options.body, undefined);
    assert.deepEqual(options.headers, { authorization: `Bearer ${config.key}` });
    assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
    const body = { ok: true, checkOnly: true, verification: 'sha256', ...status };
    return response(body, backupHttpStatus('backupNow', body));
  } });
  assert.equal(outcome.code, 'healthy');
  assert.ok(f.state.calls.every(c => c.method === 'GET' || c.path.includes('/object/list/')));
});
for (const code of ['missing', 'unverified', 'failed', 'interrupted', 'stale', 'file_missing', 'file_invalid']) test(`${code}를 장애로 판정한다`, () => {
  const out = evaluateBackup(503, bad(code), now()); assert.equal(out.code, code); assert.equal(out.level, 'incident');
});
test('주간 누락은 8일이 지나기 전 일요일 03:45부터 발견한다', () => {
  const b = healthy(); b.health.lastSuccess.startedAt = '2026-11-07T18:00:00.000Z'; b.health.lastSuccess.completedAt = b.health.lastSuccessAt = '2026-11-07T18:00:12.000Z';
  const before = Date.parse('2026-11-14T18:44:59.000Z'); b.health.checkedAt = new Date(before).toISOString();
  assert.equal(evaluateBackup(200, b, before).code, 'healthy');
  b.health.checkedAt = new Date(before + 1000).toISOString();
  assert.equal(evaluateBackup(200, b, before + 1000).code, 'overdue');
  assert.equal(latestDueStart(now()), Date.parse(success.startedAt));
});
test('실행 중 유예와 15분 중단을 구분하고 미완료 상태로 복구 알림을 보내지 않는다', () => {
  const b = bad('running'); b.health.latestAttempt = { startedAt: new Date(now() - 60000).toISOString() };
  const h = evaluateBackup(503, b, now()); assert.equal(h.level, 'pending'); assert.match(backupSummary(h), /아직 완료되지/);
  b.health.latestAttempt.startedAt = new Date(now() - 16 * 60000).toISOString(); assert.equal(evaluateBackup(503, b, now()).code, 'interrupted');
  b.health.latestAttempt.startedAt = new Date(now() - 60000).toISOString(); b.health.lastSuccess = null;
  assert.equal(evaluateBackup(503, b, now()).code, 'invalid_response');
});
test('잘못된 성공 응답·오래된 응답·8일 경과·미래 시각·오류 HTTP는 정상으로 인정하지 않는다', () => {
  for (const change of [b => b.ok = false, b => b.checkOnly = false, b => b.health.lastSuccess = null, b => b.verification = 'completion-record-and-size', b => b.health.checkedAt = '2026-11-01T00:00:00Z', b => b.health.lastSuccessAt = '2027-01-01T00:00:00Z']) {
    const b = healthy(); change(b); assert.equal(evaluateBackup(200, b, now()).code, 'invalid_response');
  }
  const b = healthy(); b.health.lastSuccess.startedAt = b.health.lastSuccess.completedAt = b.health.lastSuccessAt = '2026-11-01T00:00:00Z';
  assert.equal(evaluateBackup(200, b, now()).code, 'stale');
  assert.equal(evaluateBackup(401, {}, now()).code, 'unauthorized');
  assert.equal(evaluateBackup(500, healthy(), now()).code, 'api_error');
});
test('연결 실패·비JSON·큰 응답·인증 실패는 고정 오류만 반환하고 백업을 재시도하지 않는다', async () => {
  for (const [fake, code] of [[async () => { throw Error('secret-url-token'); }, 'unreachable'], [async () => new Response('<html>secret</html>'), 'invalid_response'], [async () => new Response('x'.repeat(300000)), 'invalid_response'], [async () => new Response('private', { status: 401 }), 'unauthorized']]) {
    let calls = 0; const out = await probeBackup({ ...config, fetchImpl: (...args) => { calls++; return fake(...args); } });
    assert.equal(calls, 1); assert.equal(out.code, code); assert.ok(!JSON.stringify(out).includes('secret'));
  }
});
test('시간 제한 시 종료하고 토큰을 외부 오류에 노출하지 않는다', async () => {
  // 실제 외부망 없이 AbortSignal이 끊는지 확인한다.
  const keep = setTimeout(() => {}, 1000);
  try {
    const out = await probeBackup({ ...config, timeoutMs: 10, fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Error('secret')), { once: true })) });
    assert.equal(out.code, 'unreachable');
  } finally { clearTimeout(keep); }
});
test('작업 요약은 상태·시각만 표시하고 비밀값/업무 자료를 포함하지 않는다', () => {
  const healthySummary = backupSummary(evaluateBackup(200, healthy(), now()));
  assert.match(healthySummary, /백업 정상/); assert.match(healthySummary, /한국 시간/);
  for (const code of ['failed', 'overdue', 'unreachable', 'unauthorized']) {
    const summary = backupSummary({ code, level: 'incident', checkedAt: at, lastSuccessAt: null });
    assert.match(summary, /확인 필요/); assert.match(summary, /확인 안 됨/);
    assert.ok(!summary.includes('synthetic-key'));
  }
});
test('감시는 기존 보고방/업무 DB에 연결하지 않고 워크플로는 명시 활성화 전까지 정지한다', () => {
  const source = readFileSync(new URL('../tools/backup-watch.mjs', import.meta.url), 'utf8');
  assert.ok(!source.includes('TEACHERSQUARE_CHAT_ID')); assert.ok(!source.includes('supabase')); assert.ok(!source.includes('alert_log')); assert.ok(!source.includes('api.telegram.org'));
  const workflow = readFileSync(new URL('../.github/workflows/backup-watch.yml', import.meta.url), 'utf8');
  assert.match(workflow, /BACKUP_WATCH_ENABLED == 'true'/); assert.match(workflow, /default_branch/); assert.match(workflow, /47 18 \* \* \*/);
});
test('설정 없는 실제 실행은 외부 호출 전 실패하고 비밀값 없는 요약만 남긴다', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'backup-watch-cli-'));
  try {
    assert.throws(() => execFileSync(process.execPath, [fileURLToPath(new URL('../tools/backup-watch.mjs', import.meta.url))], { cwd, env: {}, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), e => {
      assert.equal(e.status, 1); assert.equal(e.stdout, '');
      assert.equal(JSON.parse(e.stderr).code, 'BACKUP_WATCH_EXECUTION_FAILED'); return true;
    });
  } finally { rmSync(cwd, { recursive: true }); }
});
