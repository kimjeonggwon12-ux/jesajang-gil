// 격리 후보 빌드의 공개 화면/인증 거절만 확인한다. 운영 주소/키를 받지 않는다.
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import path from 'node:path';
const workspace = fileURLToPath(new URL('../../', import.meta.url));
const source = path.join(workspace, '.local-backup-monitor-20261115/source/next-app'), out = path.join(workspace, 'artifacts/backup-monitor-20261115');
assert.equal(process.argv.length, 2); assert.ok(!existsSync(path.join(out, 'local-http.json')));
const env = { ...process.env };
for (const key of Object.keys(env)) if (/SUPABASE|AUTH_SIGNING|TEACHER|TELEGRAM|BOT_TOKEN|R2_|ATTEND_|GEMINI|LEGACY_URL|VERCEL|NEXT_PUBLIC/.test(key)) delete env[key];
Object.assign(env, { NODE_ENV: 'production', PILOT_ROUTING_ENABLED: '1', NEXT_TELEMETRY_DISABLED: '1' });
let log = '';
const child = spawn(process.execPath, [path.join(source, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', '58585'], { cwd: source, env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', c => log += c); child.stderr.on('data', c => log += c);
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw Error('로컬 서버 시작 실패: ' + log);
    try { const r = await fetch('http://127.0.0.1:58585/api'); if (r.ok) { ready = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  assert.ok(ready);
  const cases = [['/api', 'GET', null, 200], ['/', 'GET', null, 200],
    ['/api', 'POST', { action: 'backupNow', key: 'wrong', checkOnly: true }, 401],
    ['/api', 'POST', { action: 'getBackups' }, 401], ['/api', 'POST', { action: 'createBackup' }, 401]];
  const results = [];
  for (const [route, method, body, status] of cases) {
    const r = await fetch('http://127.0.0.1:58585' + route, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal(r.status, status, route); results.push({ route, method, action: body?.action || null, status: r.status }); await r.text();
  }
  const buildId = readFileSync(path.join(source, '.next/BUILD_ID'), 'utf8').trim();
  writeFileSync(path.join(out, 'local-http.json'), JSON.stringify({ buildId, results, productionConfigured: false }, null, 2) + '\n');
  console.log(JSON.stringify({ buildId, passed: results.length }));
} finally {
  writeFileSync(path.join(out, 'local-server-final.log'), log);
  if (child.exitCode === null) { child.kill('SIGTERM'); await new Promise(r => child.once('exit', r)); }
}
