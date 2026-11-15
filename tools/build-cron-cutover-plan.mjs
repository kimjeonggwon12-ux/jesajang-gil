// 검토용 SQL 생성만 한다. DB 접속·예약 실행·비밀값 읽기 기능은 없다.
// 운영 실행은 별도 승인 후 연결 대상과 전체 작업 가시성을 확인한 담당자가 수행한다.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export function buildCronCutoverSql(snapshot, mode) {
  assert.equal(snapshot.projectRef, 'rbpqfpfuvlllaqidtdjg');
  assert.match(snapshot.currentDatabase, /^[a-z][a-z0-9_]{0,62}$/);
  assert.match(snapshot.queryRole, /^[a-z][a-z0-9_]{0,62}$/);
  assert.equal(snapshot.schedulerTimezone, 'GMT');
  assert.equal(snapshot.rowSecurityActive, false);
  assert.ok(['pause', 'resume'].includes(mode));
  assert.ok(Array.isArray(snapshot.jobs) && snapshot.jobs.length > 0);
  const jobs = snapshot.jobs.map(j => {
    assert.ok(Number.isSafeInteger(j.jobid) && j.jobid > 0);
    assert.match(j.jobname, /^[a-z][a-z0-9-]{0,99}$/);
    assert.match(j.schedule, /^[0-9*,/ -]{1,100}$/);
    assert.match(j.command_fingerprint, /^[a-f0-9]{32}$/);
    assert.match(j.database, /^[a-z][a-z0-9_]{0,62}$/);
    assert.match(j.username, /^[a-z][a-z0-9_]{0,62}$/);
    assert.match(j.nodename, /^[a-zA-Z0-9.-]{1,253}$/);
    assert.ok(Number.isInteger(j.nodeport) && j.nodeport > 0 && j.nodeport <= 65535);
    assert.equal(typeof j.active, 'boolean');
    return {jobid:j.jobid, jobname:j.jobname, schedule:j.schedule,
      command_fingerprint:j.command_fingerprint,database:j.database,username:j.username,nodename:j.nodename,nodeport:j.nodeport,
      before_active:mode === 'pause' ? j.active : false,
      after_active:mode === 'pause' ? false : j.active};
  });
  assert.equal(new Set(jobs.map(j=>j.jobid)).size, jobs.length);
  assert.equal(new Set(jobs.map(j=>j.jobname)).size, jobs.length);
  // whitelist 자료만 SQL에 넣는다. 명령 원문·토큰·URL은 복사하지 않는다.
  return `-- 검토용: ${mode}. 운영 실행 승인 아님. 먼저 실제 프로젝트/전체 예약 가시성 확인.
-- 중지는 이미 시작한 HTTP/외부 발송을 취소하지 않는다. 별도 drain 확인 필수.
begin;
set local lock_timeout = '500ms';
set local statement_timeout = '5s';
do $preflight$
begin
  if current_database() <> '${snapshot.currentDatabase}' or current_user <> '${snapshot.queryRole}'
    or current_setting('cron.timezone',true) is distinct from '${snapshot.schedulerTimezone}'
    or row_security_active('cron.job') then
    raise exception 'CUTOVER_CRON_CONTEXT_MISMATCH';
  end if;
end $preflight$;
lock table cron.job in share row exclusive mode;
create temp table cutover_expected_jobs on commit drop as
select * from jsonb_to_recordset('${JSON.stringify(jobs)}'::jsonb)
as x(jobid bigint, jobname text, schedule text, command_fingerprint text, database text, username text, nodename text, nodeport integer, before_active boolean, after_active boolean);
do $cutover$
declare r record;
begin
  if exists (
    select 1 from cron.job j full join cutover_expected_jobs e using (jobid)
    where j.jobid is null or e.jobid is null
      or j.jobname is distinct from e.jobname
      or j.schedule is distinct from e.schedule
      or md5(j.command) is distinct from e.command_fingerprint
      or (j.database,j.username,j.nodename,j.nodeport) is distinct from (e.database,e.username,e.nodename,e.nodeport)
      or j.active is distinct from e.before_active
  ) then
    raise exception 'CUTOVER_CRON_SNAPSHOT_MISMATCH';
  end if;
  for r in select * from cutover_expected_jobs order by jobid loop
    perform cron.alter_job(job_id := r.jobid, active := r.after_active);
  end loop;
  if exists (
    select 1 from cron.job j full join cutover_expected_jobs e using (jobid)
    where j.jobid is null or e.jobid is null
      or j.jobname is distinct from e.jobname
      or j.schedule is distinct from e.schedule
      or md5(j.command) is distinct from e.command_fingerprint
      or (j.database,j.username,j.nodename,j.nodeport) is distinct from (e.database,e.username,e.nodename,e.nodeport)
      or j.active is distinct from e.after_active
  ) then
    raise exception 'CUTOVER_CRON_POSTCONDITION_FAILED';
  end if;
end $cutover$;
select jobid, jobname, schedule, active, md5(command) as command_fingerprint
from cron.job order by jobid;
commit;
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 4, '사용: node tools/build-cron-cutover-plan.mjs snapshot.json output-directory');
  const snapshot=JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const plans=Object.fromEntries(['pause','resume'].map(mode=>[mode,buildCronCutoverSql(snapshot,mode)]));
  mkdirSync(process.argv[3],{recursive:true});
  for (const [mode,sql] of Object.entries(plans)) writeFileSync(path.join(process.argv[3],`cron-${mode}.review-only.sql`),sql,{mode:0o600});
  console.log(JSON.stringify({generated:Object.keys(plans),jobs:snapshot.jobs.length,executed:false}));
}
