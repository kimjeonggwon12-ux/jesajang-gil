// 고정 로컬 DB의 가짜 cron 표/함수로 전환 SQL의 트랜잭션 경계를 검사한다.
// 실제 pg_cron 스케줄러·네트워크 요청·운영 DB를 실행하지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {buildCronCutoverSql} from '../tools/build-cron-cutover-plan.mjs';
const db='jesajang_schedule_rehearsal_20261114_v2';
function sql(input,database=db){
  assert.ok([db,'postgres'].includes(database));
  return execFileSync('/opt/homebrew/bin/psql',['-h','/tmp/jesajang-auth-pg-socket','-p','58431','-U','postgres','-d',database,'-qAt','-v','ON_ERROR_STOP=1'],{input:"set cron.timezone='GMT';\n"+input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
}
const snapshot={projectRef:'rbpqfpfuvlllaqidtdjg',currentDatabase:db,queryRole:'postgres',schedulerTimezone:'GMT',rowSecurityActive:false,jobs:Array.from({length:6},(_,i)=>({jobid:i+1,jobname:`fake-job-${i+1}`,schedule:'*/5 * * * *',command_fingerprint:createHash('md5').update(`select ${i+1}`).digest('hex'),active:i!==5,database:'postgres',username:'postgres',nodename:'localhost',nodeport:5432}))};
const contents=()=>sql('select jsonb_agg(to_jsonb(j) order by jobid) from cron.job j');
const txPlan=(mode)=>buildCronCutoverSql(snapshot,mode);

test('예약 중지·재개는 목록과 명령을 보존하고 실패 시 전체 취소한다', async t=>{
  assert.equal(sql(`select count(*) from pg_database where datname='${db}'`,'postgres'),'0','기존 연습 DB를 덮어쓰지 않습니다.');
  sql(`create database ${db}`,'postgres');
  sql(`create schema cron;
    create table cron.job(jobid bigint primary key,jobname text unique,schedule text,command text,active boolean,database text default 'postgres',username text default 'postgres',nodename text default 'localhost',nodeport integer default 5432);
    create function cron.alter_job(job_id bigint,active boolean) returns void language plpgsql as $$
    begin
      if current_setting('cutover_test.fail_job',true)=job_id::text then raise exception 'FAKE_FAILURE'; end if;
      update cron.job set active=$2 where jobid=$1;
    end $$;
    insert into cron.job(jobid,jobname,schedule,command,active) select i,'fake-job-'||i,'*/5 * * * *','select '||i,i<>6 from generate_series(1,6) i;`);
  const original=contents();
  await t.test('6개 중지 후 원래 활성 5개만 재개, 명령/주기 보존',()=>{
    sql(txPlan('pause')); assert.equal(sql('select count(*) from cron.job where active'),'0');
    sql(txPlan('resume')); assert.equal(contents(),original);
  });
  await t.test('스냅샷 이후 바뀐 명령은 전부 중단',()=>{
    sql("update cron.job set command='select 999' where jobid=2"); const before=contents();
    assert.throws(()=>sql(txPlan('pause')),e=>String(e.stderr).includes('CUTOVER_CRON_SNAPSHOT_MISMATCH'));
    assert.equal(contents(),before); sql("update cron.job set command='select 2' where jobid=2");
  });
  await t.test('목록에 없던 비활성 작업도 임의로 무시하지 않음',()=>{
    sql("insert into cron.job(jobid,jobname,schedule,command,active) values(7,'fake-extra','0 * * * *','select 7',false)");const before=contents();
    assert.throws(()=>sql(txPlan('pause')),e=>String(e.stderr).includes('CUTOVER_CRON_SNAPSHOT_MISMATCH'));
    assert.equal(contents(),before);sql('delete from cron.job where jobid=7');
  });
  await t.test('네 번째 중지 실패 시 앞의 세 작업까지 원상 유지',()=>{
    assert.throws(()=>sql("set cutover_test.fail_job='4';\n"+txPlan('pause')),e=>String(e.stderr).includes('FAKE_FAILURE'));
    assert.equal(contents(),original);
  });
  await t.test('재개 중 실패해도 모두 중지 상태 유지',()=>{
    sql(txPlan('pause'));const paused=contents();
    assert.throws(()=>sql("set cutover_test.fail_job='4';\n"+txPlan('resume')),e=>String(e.stderr).includes('FAKE_FAILURE'));
    assert.equal(contents(),paused);sql(txPlan('resume'));assert.equal(contents(),original);
  });
  await t.test('활성 상태가 달라졌으면 반복 중지/재개를 조용히 실행하지 않음',()=>{
    assert.throws(()=>sql(txPlan('resume')),e=>String(e.stderr).includes('CUTOVER_CRON_SNAPSHOT_MISMATCH'));
    assert.equal(contents(),original);
  });
  await t.test('시간대와 실행 DB가 바뀌면 변경 전에 중단',()=>{
    assert.throws(()=>sql("set cron.timezone='Asia/Seoul';\n"+txPlan('pause')),e=>String(e.stderr).includes('CUTOVER_CRON_CONTEXT_MISMATCH'));
    assert.equal(contents(),original);
    sql("update cron.job set database='another_database' where jobid=2");const changed=contents();
    assert.throws(()=>sql(txPlan('pause')),e=>String(e.stderr).includes('CUTOVER_CRON_SNAPSHOT_MISMATCH'));
    assert.equal(contents(),changed);sql("update cron.job set database='postgres' where jobid=2");assert.equal(contents(),original);
  });
});
