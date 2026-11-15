// 고정된 Unix 소켓의 새 가짜 DB에만 쓰는 검증. 기존 DB/운영 접속 옵션은 받지 않는다.
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {indexDecision,inspectIndexSql,sha256} from './prepare-online-index-plan.mjs';
const repo=fileURLToPath(new URL('../',import.meta.url));
const out=path.resolve(repo,'../artifacts/index-hosting-fix-20261115');
const base='jesajang_compat_before_20261114',db='jesajang_index_plan_20261115';
const args=['-X','-h','/tmp/jesajang-auth-pg-socket','-p','58431','-U','postgres'];
const plan=JSON.parse(readFileSync(path.join(out,'online-index-plan/plan.json'),'utf8'));
const allIndexes=plan.steps.flatMap(s=>s.indexes);
function sql(code,name=db){
 assert.ok([base,db,'postgres'].includes(name));
 return execFileSync('/opt/homebrew/bin/psql',[...args,'-d',name,'-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'],{input:code,encoding:'utf8',maxBuffer:32*1024*1024,stdio:['pipe','pipe','pipe']}).trim();
}
const json=(code,name)=>JSON.parse(sql(code,name));
const schema=name=>json(readFileSync(path.join(repo,'tools/schema-review-readonly.sql'),'utf8'),name);
const comparable=rows=>rows.filter(x=>!['environment','default_acl'].includes(x.kind)).map(x=>{const p={...x.payload};delete p.estimated_rows;return JSON.stringify({kind:x.kind,payload:p});}).sort();
function originalColumns(){return json("select json_object_agg(table_name,cols) from (select table_name,json_agg(column_name order by ordinal_position) cols from information_schema.columns where table_schema='public' and table_name in (select tablename from pg_tables where schemaname='public') group by table_name)t",base);}
function contents(name,columns){return Object.fromEntries(Object.entries(columns).map(([table,cols])=>[table,json(`select json_build_object('rows',count(*),'hash',md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]')::text)) from (select ${cols.map(c=>'"'+c+'"').join(',')} from public."${table}") t`,name)]));}
function session(code){
 const p=spawn('/opt/homebrew/bin/psql',[...args,'-d',db,'-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'],{stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='';p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);
 const done=new Promise((resolve,reject)=>{p.once('error',reject);p.once('close',exit=>resolve({exit,stdout,stderr}));});
 p.stdin.write(code+'\n');return {p,done,output:()=>stdout};
}
async function until(check,message,timeout=2000){const until=Date.now()+timeout;while(Date.now()<until){if(check())return;await new Promise(r=>setTimeout(r,15));}throw Error(message);}
async function holdWriter(table){
 const s=session(`begin; lock table public.${table} in row exclusive mode; select 'LOCKED';`);
 await until(()=>s.output().includes('LOCKED'),'writer lock unavailable');return s;
}
async function release(s){s.p.stdin.end('rollback;\n');assert.equal((await s.done).exit,0);}
async function writerDuringBuild(index){
 const holder=await holdWriter(index.table);let build;
 try{
  build=session(index.sql);build.p.stdin.end();
  await until(()=>Number(sql("select count(*) from pg_stat_progress_create_index where datname=current_database() and relid='public.activities'::regclass"))===1,'index build not observed');
  const start=Date.now();sql("begin; set local lock_timeout='150ms'; set local statement_timeout='300ms'; update activities set today_work=today_work; rollback;");
  const writeMs=Date.now()-start;await release(holder);const result=await build.done;assert.equal(result.exit,0,result.stderr);
  return {writeSucceededWhileIndexPending:true,writeMs,originalRowsChanged:false};
 }finally{if(holder.p.exitCode===null)holder.p.stdin.end('rollback;\n');if(build?.p.exitCode===null)await build.done;}
}
const state=index=>json(inspectIndexSql(index));
assert.equal(process.argv.length,2);assert.ok(!existsSync(path.join(out,'index-db-check.json')),'기존 결과 보존');
assert.equal(sql(`select count(*) from pg_database where datname='${db}'`,'postgres'),'0','기존 검증 DB 재사용/초기화 금지');
assert.equal(sql('select reference from compat_local.marker',base),'0ea5ac7ea16a67b8ceb5b1848e45e13c0c064872');
const columns=originalColumns(),before=contents(base,columns);assert.equal(Object.keys(columns).length,65);
const baseline=execFileSync('/opt/homebrew/bin/pg_dump',args.filter(x=>x!=='-X').concat(['-d',base,'--format=custom']),{maxBuffer:32*1024*1024});
writeFileSync(path.join(out,'local-index-baseline.dump'),baseline,{mode:0o600});
sql('create database '+db,'postgres');execFileSync('/opt/homebrew/bin/pg_restore',args.filter(x=>x!=='-X').concat(['-d',db,'--exit-on-error']),{input:baseline,stdio:['pipe','pipe','pipe']});
assert.deepEqual(contents(db,columns),before);
sql('alter default privileges for role postgres in schema public grant all on tables to anon,authenticated,service_role; alter default privileges for role postgres in schema public grant all on sequences to anon,authenticated,service_role; alter default privileges for role postgres in schema public grant execute on functions to anon,authenticated,service_role;');
const expression=allIndexes.find(i=>i.name==='activities_nid_target_trim_id_idx');
assert.throws(()=>indexDecision(expression,state(expression)),/dependency_missing/);
const applied=[];let concurrentWrite;
for(const step of plan.steps){
 assert.equal(sha256(readFileSync(path.join(repo,step.source))),step.sourceSha256);
 assert.equal(sha256(step.transactionSql),step.transactionSha256);
 sql(step.transactionSql);
 for(const index of step.indexes){
  assert.equal(indexDecision(index,state(index)),'create');
  if(index.name==='activities_owner_page_idx')concurrentWrite=await writerDuringBuild(index);else sql(index.sql);
  assert.equal(indexDecision(index,state(index)),'skip_verified');
 }
 applied.push({source:step.source,indexes:step.indexes.map(i=>i.name)});
 console.log('검증 적용 '+applied.length+'/'+plan.steps.length);
}
assert.deepEqual(contents(db,columns),before);
// 동일 이름의 다른 정의는 IF NOT EXISTS처럼 조용히 넘어가지 않는다.
const chat=allIndexes.find(i=>i.name==='chat_messages_chat_id_idx');
sql(`drop index concurrently public.${chat.name};`);
sql(`create index ${chat.name} on public.chat_messages(id);`);
assert.throws(()=>indexDecision(chat,state(chat)),/definition_mismatch/);
sql(`drop index concurrently public.${chat.name};`);sql(chat.sql);
// 실행 도중 짧은 제한에 걸린 미완성 색인: 자동 DROP 없이 중단, 검토 후 로컬에서만 정리·재개.
const index=allIndexes.find(i=>i.name==='activities_owner_id_idx');sql(`drop index concurrently public.${index.name};`);
const holder=await holdWriter(index.table);let failed;
try{
 const build=session(index.sql);build.p.stdin.end();failed=await build.done;
 assert.notEqual(failed.exit,0);assert.match(failed.stderr,/55P03|57014/);
 assert.throws(()=>indexDecision(index,state(index)),/invalid_index/);
}finally{await release(holder);}
const invalidState=state(index);assert.equal(invalidState.valid,false);assert.equal(invalidState.building,false);assert.equal(invalidState.constraintBacked,false);
sql(`drop index concurrently public.${index.name};`);assert.equal(indexDecision(index,state(index)),'create');sql(index.sql);
const finalStates=allIndexes.map(i=>({name:i.name,decision:indexDecision(i,state(i)),state:state(i)}));
assert.ok(finalStates.every(s=>s.decision==='skip_verified'));
assert.deepEqual(contents(db,columns),before);assert.deepEqual(contents(base,columns),before,'원본 로컬 DB 불변');
const actual=schema(db),expected=JSON.parse(readFileSync(path.resolve(repo,'../artifacts/release-prep-20261115/db-final-schema.json'),'utf8'));
const a=comparable(actual),b=comparable(expected);
const differences={onlyNew:a.filter(x=>!b.includes(x)),onlyReference:b.filter(x=>!a.includes(x))};
writeFileSync(path.join(out,'index-schema-diff.json'),JSON.stringify(differences,null,2)+'\n');
assert.deepEqual(a,b,'기존 검증 최종 구조와 동등해야 함');
writeFileSync(path.join(out,'index-db-check.json'),JSON.stringify({completedAt:new Date().toISOString(),base,db,baselineTables:65,applied,concurrentWrite,missingDependencyBlocked:true,wrongDefinitionBlocked:true,interruptedBuildBlocked:true,interruptionSqlState:failed.stderr.match(/55P03|57014/)[0],invalidState,manualLocalCleanupAndResume:true,finalStates,fullSchemaEquivalent:true,original65TablesPreserved:true,sourceDatabasePreserved:true,productionChanged:false},null,2)+'\n');
console.log('색인 7개/실패 재개/동시 저장/최종 구조 일치 검증 완료');
