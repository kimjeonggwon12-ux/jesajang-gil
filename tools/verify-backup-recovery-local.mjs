// 앞서 복원한 실자료 로컬 DB를 읽어 전체 덤프→새 로컬 DB 복원을 검증한다.
// 운영 연결/임의 주소/원래 DB 삭제·초기화/역할 변경을 지원하지 않는다. 재실행하지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const workspace = path.resolve(import.meta.dirname, '../..');
const source = 'jesajang_backup_live_restore_20261115';
const target = 'jesajang_backup_recovery_drill_20261115';
const pg = ['-h', '/tmp/jesajang-auth-pg-socket', '-p', '58431', '-U', 'postgres'];
const privateDir = path.join(workspace, '.local-backup-recovery-drill-20261115');
const out = path.join(workspace, 'artifacts/backup-alert-recovery-20261115');
const digest = data => createHash('sha256').update(data).digest('hex');
const id = value => { assert.match(value, /^[a-z_][a-z0-9_]*$/); return '"' + value + '"'; };
const lit = value => "'" + value.replaceAll("'", "''") + "'";
function run(binary, args, options = {}) {
  try { return execFileSync('/opt/homebrew/bin/' + binary, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'], ...options }); }
  catch { throw Error('LOCAL_RECOVERY_' + binary.toUpperCase() + '_FAILED'); } // 자료/SQL/접속 오류 원문을 숨긴다.
}
function sql(database, input) {
  assert.ok([source, target, 'postgres'].includes(database));
  return run('psql', [...pg, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-d', database], { input: "set timezone='UTC';set log_statement='none';set log_min_error_statement='panic';\n" + input }).trim();
}
const read = (database, query) => JSON.parse(sql(database, 'begin read only; set local statement_timeout=\'10s\'; set local lock_timeout=\'500ms\'; ' + query + '; rollback;'));
const schemaSql = fs.readFileSync(path.join(workspace, 'jesajang-gil/tools/schema-review-readonly.sql'), 'utf8');
function schema(database) {
  return JSON.parse(sql(database, schemaSql)).filter(x => x.kind !== 'environment').map(x => {
    delete x.payload.estimated_rows; return JSON.stringify(x);
  }).sort();
}
function contents(database) {
  const tables = read(database, "select json_agg(tablename order by tablename) from pg_tables where schemaname='public'");
  return tables.map(table => ({ table, ...read(database, `select json_build_object('rows',count(*),'hash',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),''))) from public.${id(table)} t`) }));
}
function sequences(database) {
  const names = read(database, "select json_agg(c.relname order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='S'");
  return names.map(name => ({ name, ...read(database, `select json_build_object('value',last_value::text,'called',is_called) from public.${id(name)}`) }));
}
function roleSnapshot() {
  return read('postgres', "select json_agg(json_build_object('name',rolname,'super',rolsuper,'inherit',rolinherit,'createRole',rolcreaterole,'createDb',rolcreatedb,'login',rolcanlogin,'bypass',rolbypassrls,'config',rolconfig) order by rolname) from pg_roles");
}
try {
  assert.equal(process.argv.length, 2, '외부 대상 인자 금지');
  assert.equal(fs.existsSync(path.join(out, 'recovery-drill.json')), false, '이전 검증 결과 보존');
  assert.equal(sql('postgres', `select count(*) from pg_database where datname=${lit(target)}`), '0', '기존 DB 보존');
  assert.equal(fs.existsSync(privateDir), false, '이전 비공개 덤프 보존');
  const safety = read(source, "select json_build_object('subscriptions',(select count(*) from pg_subscription),'foreignServers',(select count(*) from pg_foreign_server),'cron',to_regclass('cron.job'),'net',to_regnamespace('net'))");
  assert.deepEqual(safety, { subscriptions: 0, foreignServers: 0, cron: null, net: null }, '외부 연동이 있는 DB는 이 도구로 복원하지 않는다');
  const before = { schema: schema(source), contents: contents(source), sequences: sequences(source), roles: roleSnapshot() };
  assert.equal(before.contents.length, 65); assert.equal(before.contents.reduce((s, r) => s + r.rows, 0), 27263);
  fs.mkdirSync(privateDir, { mode: 0o700 }); fs.mkdirSync(out, { recursive: true });
  const dump = path.join(privateDir, 'local-consistent.dump');
  const startedAt = new Date().toISOString();
  run('pg_dump', [...pg, '-d', source, '--format=custom', '--lock-wait-timeout=500ms', '--file', dump]);
  fs.chmodSync(dump, 0o600);
  const dumpBytes = fs.readFileSync(dump), dumpHash = digest(dumpBytes);
  assert.ok(dumpBytes.subarray(0, 5).equals(Buffer.from('PGDMP')));
  const toc = run('pg_restore', ['--list', dump]);
  fs.writeFileSync(path.join(privateDir, 'archive-list.txt'), toc, { mode: 0o600 });
  assert.ok(toc.includes('TABLE DATA public teachers') && toc.includes('SEQUENCE SET public'));
  const roles = run('pg_dumpall', [...pg, '--roles-only', '--no-role-passwords']);
  fs.writeFileSync(path.join(privateDir, 'roles-without-passwords.sql'), roles, { mode: 0o600 });
  // 역할은 같은 클러스터에 이미 존재한다. 기존 역할 재적용은 하지 않는다.
  sql('postgres', `create database ${id(target)}`);
  sql('postgres', `revoke connect on database ${id(target)} from public,anon,authenticated,service_role,authenticator`);
  const restoreStartedAt = new Date().toISOString();
  run('pg_restore', [...pg, '--dbname', target, '--single-transaction', '--exit-on-error', dump]);
  const restoredAt = new Date().toISOString();
  const after = { schema: schema(target), contents: contents(target), sequences: sequences(target), roles: roleSnapshot() };
  assert.deepEqual(after, before, '복원한 구조·권한·자료·시퀀스가 다르다');
  // 적용 도중 실패했을 때 해당 트랜잭션이 실제로 취소되는지 새 DB에서만 점검한다.
  let failed = false;
  try { sql(target, 'begin; create table public._backup_recovery_probe(id integer); insert into public._backup_recovery_probe values(1); select 1/0; commit;'); }
  catch { failed = true; }
  assert.ok(failed); assert.equal(sql(target, "select to_regclass('public._backup_recovery_probe') is null"), 't');
  assert.deepEqual(schema(target), before.schema); assert.deepEqual(contents(target), before.contents); assert.deepEqual(sequences(target), before.sequences);
  assert.deepEqual({ schema: schema(source), contents: contents(source), sequences: sequences(source), roles: roleSnapshot() }, before, '원래 로컬 DB/역할 변경 감지');
  const access = read('postgres', `select json_object_agg(r,has_database_privilege(r,${lit(target)},'CONNECT')) from unnest(array['anon','authenticated','service_role','authenticator']) r`);
  assert.ok(Object.values(access).every(value => value === false));
  assert.equal(digest(fs.readFileSync(dump)), dumpHash);
  const report = {
    startedAt, completedAt: new Date().toISOString(), source, target, localOnly: true,
    provenance: 'Previously restored production app archive; legacy schema; locally reconstructed sequences. Not a current production checkpoint.',
    dump: { bytes: dumpBytes.length, sha256: dumpHash, format: 'custom', version: run('pg_dump', ['--version']).trim() },
    tables: before.contents.length, rows: before.contents.reduce((s, r) => s + r.rows, 0), sequenceCount: before.sequences.length,
    schemaObjects: before.schema.length, schemaHash: digest(JSON.stringify(before.schema)), contentHash: digest(JSON.stringify(before.contents)), sequenceHash: digest(JSON.stringify(before.sequences)),
    exactLocalRowsAndSchemaAndAclAndSequenceValues: true, foreignKeysRestoredByPgRestore: true,
    restoreDurationMs: Date.parse(restoredAt) - Date.parse(restoreStartedAt), failedTransactionRolledBack: true,
    sourceAndRolesUnchanged: true, applicationRoleConnect: access, productionConnected: false,
    globalRolesRestored: false, providerPhysicalBackupRestored: false, externalObjectsRestored: false,
  };
  fs.writeFileSync(path.join(out, 'recovery-drill.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ok: true, tables: report.tables, rows: report.rows, sequences: report.sequenceCount, exactLocalRestore: true, failedTransactionRolledBack: true, productionConnected: false }));
} catch (error) {
  // assert 오류의 actual/expected나 psql 오류 원문에는 실자료가 포함될 수 있어 출력하지 않는다.
  console.error('로컬 복구 점검 중단. 기존 DB/원본은 삭제하지 않았으며 새 결과는 담당자가 확인해야 합니다.'); process.exitCode = 1;
}
