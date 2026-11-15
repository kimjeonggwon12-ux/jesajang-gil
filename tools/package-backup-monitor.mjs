// 로컬 검토 묶음만 생성한다. 기존 후보/DB/빌드/증거를 덮어쓰지 않는다.
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const repo = fileURLToPath(new URL('../', import.meta.url)), workspace = path.dirname(repo.slice(0, -1));
const out = path.join(workspace, 'artifacts/backup-monitor-20261115'), local = path.join(workspace, '.local-backup-monitor-20261115');
assert.equal(process.argv.length, 2);
assert.ok(!existsSync(out) && !existsSync(local), '이 검토 묶음은 이미 존재합니다. 기존 증거를 보존하세요.');
const prior = JSON.parse(readFileSync(path.join(workspace, 'artifacts/security-backup-20261115/packages.json')));
const modified = ['api/index.js', 'app.html', 'server/actions/backup.js', 'next-app/components/roster/RosterDataTools.tsx'];
const added = ['server/lib/backup-storage.js'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const migrations = JSON.parse(readFileSync(path.join(workspace, 'artifacts/release-prep-20261115/migrations-review.json'))).files;
assert.equal(migrations.length, 67);
for (const file of migrations) assert.equal(sha(readFileSync(path.join(repo, file.path))), file.sha256, file.path);
for (const [name, hash] of Object.entries(prior.sourceHashes)) if (!modified.includes(name)) assert.equal(sha(readFileSync(path.join(repo, name))), hash, name);
mkdirSync(out, { recursive: true }); mkdirSync(local, { mode: 0o700 });
const candidate = path.join(out, 'candidate-source'), hashes = {};
for (const name of [...Object.keys(prior.sourceHashes), ...added].sort()) {
  const target = path.join(candidate, name); mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(path.join(repo, name), target); hashes[name] = sha(readFileSync(target));
}
const legacyRef = '0ea5ac7ea16a67b8ceb5b1848e45e13c0c064872';
const legacy = path.join(local, 'legacy'); mkdirSync(legacy);
execFileSync('/usr/bin/tar', ['-xf', '-', '-C', legacy], { input: execFileSync('git', ['archive', legacyRef, 'server', 'api', 'package.json'], { cwd: repo, maxBuffer: 32 * 1024 * 1024 }) });
symlinkSync(path.join(repo, 'node_modules'), path.join(legacy, 'node_modules'));
let oldBackup = readFileSync(path.join(legacy, 'server/actions/backup.js'), 'utf8');
oldBackup = oldBackup.replace("import { db, run, selectAll } from '../lib/db.js';", "import { db, run, selectAll } from '../lib/db.js';\nimport { backupTableQuery } from '../lib/backup-order.js';\nimport { BACKUP_BUCKET, saveVerifiedBackup, inspectBackups } from '../lib/backup-storage.js';");
oldBackup = oldBackup.slice(0, oldBackup.indexOf("const BUCKET = 'backups';")) + oldBackup.slice(oldBackup.indexOf('/** 모든 표'));
oldBackup = oldBackup.replace("selectAll(() => db().from(table).select('*').order(ORDER_BY[table] || 'id'))", 'selectAll(() => backupTableQuery(db(), table))');
oldBackup = oldBackup.slice(0, oldBackup.indexOf('async function listFiles()')) + 'const makeBackup = () => saveVerifiedBackup(db(), buildBackup);\n\n' + oldBackup.slice(oldBackup.indexOf('/** 주기 실행'));
oldBackup = oldBackup.replace('  return makeBackup();', "  if (body.checkOnly === true) {\n    const status = await inspectBackups(db());\n    return { ok: status.health.state === 'healthy', checkOnly: true, ...status };\n  }\n  return makeBackup();");
oldBackup = oldBackup.replaceAll('.from(BUCKET)', '.from(BACKUP_BUCKET)');
oldBackup = oldBackup.replace(/  await ensureBucket\(\);\n  return \{ rows: .*?\n/, '  return inspectBackups(db());\n');
oldBackup = oldBackup.replace('최근 8개만 남긴다.', '확인된 최근 8개를 남긴다. 과거 미확인 파일은 자동 삭제하지 않는다.');
assert.ok(!/ORDER_BY|ensureBucket|listFiles/.test(oldBackup));
writeFileSync(path.join(legacy, 'server/actions/backup.js'), oldBackup);
let api = readFileSync(path.join(legacy, 'api/index.js'), 'utf8');
api = api.replace("import { normId } from '../server/lib/util.js';", "import { normId } from '../server/lib/util.js';\nimport { backupHttpStatus, backupErrorBody } from '../server/lib/backup-storage.js';\nconst isBackup = action => ['backupNow', 'createBackup', 'getBackups'].includes(action);");
api = api.replace('  try {\n    // 2026-11-06:', '  let action;\n  try {\n    // 2026-11-06:').replace("const action = body.action || 'generateContent';", "action = body.action || 'generateContent';\n    if (isBackup(action)) res.setHeader('Cache-Control', 'no-store');");
api = api.replace("res.status(200).json({ error: '로그인이", "res.status(isBackup(action) ? 401 : 200).json({ error: '로그인이");
api = api.replace("res.status(200).json({ error: '손님은", "res.status(isBackup(action) ? 403 : 200).json({ error: '손님은");
api = api.replace('return res.status(200).json(cron ? result', 'return res.status(backupHttpStatus(action, result)).json(cron ? result');
api = api.replace('  } catch (err) {\n    return res.status(200)', "  } catch (err) {\n    if (isBackup(action)) return res.status(503).json(backupErrorBody(err));\n    return res.status(200)");
writeFileSync(path.join(legacy, 'api/index.js'), api);
const backportFiles = ['api/index.js', 'server/actions/backup.js', 'server/lib/backup-order.js', 'server/lib/backup-storage.js'];
for (const file of backportFiles.slice(2)) copyFileSync(path.join(repo, file), path.join(legacy, file));
const patchRoot = path.join(out, 'legacy-backport'), oldRoot = path.join(local, 'patch-before'), checkRoot = path.join(local, 'patch-check');
mkdirSync(oldRoot); mkdirSync(checkRoot);
let patch = '';
for (const file of backportFiles) {
  const target = path.join(patchRoot, file); mkdirSync(path.dirname(target), { recursive: true }); copyFileSync(path.join(legacy, file), target);
  let old = null;
  try { old = execFileSync('git', ['show', legacyRef + ':' + file], { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'] }); } catch {}
  if (old) {
    for (const base of [oldRoot, checkRoot]) { mkdirSync(path.dirname(path.join(base, file)), { recursive: true }); writeFileSync(path.join(base, file), old); }
  }
  let diff;
  try { diff = execFileSync('git', ['diff', '--no-index', '--', old ? path.join(oldRoot, file) : '/dev/null', target], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { assert.equal(e.status, 1); diff = String(e.stdout); }
  const lines = diff.split('\n');
  lines[0] = `diff --git a/${file} b/${file}`;
  patch += lines.map(line => line.startsWith('--- ') ? (old ? `--- a/${file}` : '--- /dev/null') : line.startsWith('+++ ') ? `+++ b/${file}` : line).join('\n');
}
const patchFile = path.join(out, 'legacy-backup-monitor.patch'); writeFileSync(patchFile, patch);
execFileSync('git', ['apply', '--check', patchFile], { cwd: checkRoot });
execFileSync('git', ['apply', patchFile], { cwd: checkRoot });
for (const file of backportFiles) assert.deepEqual(readFileSync(path.join(checkRoot, file)), readFileSync(path.join(legacy, file)));
const archive = path.join(out, 'candidate-source-backup-monitor.tar.gz');
execFileSync('/usr/bin/tar', ['-czf', archive, '-C', candidate, '.']);
execFileSync('/usr/bin/tar', ['-czf', path.join(out, 'legacy-backup-monitor.tar.gz'), '-C', patchRoot, '.']);
writeFileSync(path.join(out, 'packages.json'), JSON.stringify({ checkedAt: new Date().toISOString(), priorArchiveSha256: prior.archiveSha256,
  candidateFiles: Object.keys(hashes).length, changedFiles: modified, addedFiles: added, unchangedFiles: Object.keys(prior.sourceHashes).length - modified.length,
  sourceHashes: hashes, archive, archiveSha256: sha(readFileSync(archive)), legacyRef, backportFiles, patchAppliedToCleanCopy: true,
  sqlFilesUnchanged: migrations.length,
  deployed: false, productionChanged: false }, null, 2) + '\n');
console.log(JSON.stringify({ candidateFiles: Object.keys(hashes).length, backportFiles: backportFiles.length, patchAppliedToCleanCopy: true, out, local }));
