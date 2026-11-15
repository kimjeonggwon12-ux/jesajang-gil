// 새 로컬 사본에서만 준비·복원한다. 기존 DB/증거가 있으면 재실행을 거절한다.
// 주소/DB/자격 옵션을 받지 않으며 운영 복원 명령으로 사용할 수 없다.
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync,symlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {backupTableQuery} from '../server/lib/backup-order.js';
const repo=fileURLToPath(new URL('../',import.meta.url)),workspace=path.dirname(repo.replace(/\/$/,''));
const root=path.join(workspace,'.local-backup-compat-20261115'),out=path.join(workspace,'artifacts/backup-compat-20261115');
const ref='0ea5ac7ea16a67b8ceb5b1848e45e13c0c064872';
const bases=['jesajang_compat_before_20261114','jesajang_release_apply_20261115'];
const sources=['jesajang_backup_old_20261115','jesajang_backup_new_20261115'];
const targets=['jesajang_backup_restore_old_20261115','jesajang_backup_restore_legacy_20261115','jesajang_backup_restore_candidate_20261115'];
const allowed=new Set(['postgres',...bases,...sources,...targets]),created=new Set();
const pg=['-h','/tmp/jesajang-auth-pg-socket','-p','58431','-U','postgres'];
const q=x=>"'"+String(x).replaceAll("'","''")+"'",ident=x=>{assert.match(x,/^[a-z_][a-z0-9_]*$/);return '"'+x+'"';};
const sha=x=>createHash('sha256').update(x).digest('hex');
function sql(text,db){
 assert.ok(allowed.has(db));
 try{return execFileSync('/opt/homebrew/bin/psql',[...pg,'-X','-d',db,'-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'],{input:text,encoding:'utf8',maxBuffer:64*1024*1024,stdio:['pipe','pipe','pipe']}).trim();}
 catch(e){const code=String(e.stderr).match(/ERROR:\s+([A-Z0-9]{5})/)?.[1]||'unknown';throw Object.assign(Error('고정 로컬 백업 검사 SQL 실패: '+code),{sqlState:code});}
}
const json=(text,db)=>JSON.parse(sql(text,db));
const tables=db=>json("select json_agg(tablename order by tablename) from pg_tables where schemaname='public'",db);
function contents(db,names=tables(db)){
 return Object.fromEntries(names.map(t=>[t,json(`select json_build_object('rows',count(*),'hash',md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]')::text)) from public.${ident(t)} t`,db)]));
}
const schemaText=readFileSync(path.join(repo,'tools/schema-review-readonly.sql'),'utf8');
const comparable=rows=>rows.filter(x=>!['environment','default_acl'].includes(x.kind)).map(x=>{const p={...x.payload};delete p.estimated_rows;return JSON.stringify({kind:x.kind,payload:p});}).sort();
const schema=db=>comparable(json(schemaText,db));
function sequences(db){
 const names=json("select coalesce(json_agg(relname order by relname),'[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='S'",db);
 return Object.fromEntries(names.map(n=>[n,json(`select json_build_object('last',last_value,'called',is_called) from public.${ident(n)}`,db)]));
}
function dump(db,onlySchema=false){return execFileSync('/opt/homebrew/bin/pg_dump',[...pg,'-d',db,'--format=custom',...(onlySchema?['--schema-only']:[])],{maxBuffer:80*1024*1024,stdio:['ignore','pipe','pipe']});}
function create(db){assert.ok([...sources,...targets].includes(db));sql('create database '+ident(db),'postgres');created.add(db);}
function load(db,bytes){assert.ok(created.has(db));execFileSync('/opt/homebrew/bin/pg_restore',[...pg,'-d',db,'--exit-on-error'],{input:bytes,stdio:['pipe','pipe','pipe']});}
const save=(name,value)=>writeFileSync(path.join(out,name),JSON.stringify(value,null,2)+'\n');
assert.equal(process.argv.length,2);assert.ok(!existsSync(root)&&!existsSync(out),'기존 DB/자료는 덮어쓰지 않습니다.');
assert.ok(existsSync('/tmp/jesajang-auth-tools/postgrest'));
for(const name of [...sources,...targets])assert.equal(sql('select count(*) from pg_database where datname='+q(name),'postgres'),'0');
assert.equal(sql('select reference from compat_local.marker',bases[0]),ref);
assert.equal(sql('select reference from final_local.marker',bases[1]),'final-workflows-5B');
assert.equal(tables(bases[0]).length,65);assert.equal(tables(bases[1]).length,83);
const before=bases.map(db=>({db,contents:contents(db),schema:schema(db),sequences:sequences(db)}));
mkdirSync(root,{recursive:true,mode:0o700});mkdirSync(out,{recursive:true});save('source-before.json',before);

// 기존 코드에 백업 정렬만 보완한다. 인증·보관 개수·형식·다른 업무는 그대로 둔다.
const legacy=path.join(root,'legacy');mkdirSync(legacy);
execFileSync('/usr/bin/tar',['-xf','-','-C',legacy],{input:execFileSync('git',['archive',ref,'server','package.json'],{cwd:repo,maxBuffer:32*1024*1024})});
symlinkSync(path.join(repo,'node_modules'),path.join(legacy,'node_modules'));
const oldFile=path.join(legacy,'server/actions/backup.js'),oldCode=readFileSync(oldFile,'utf8');
writeFileSync(path.join(legacy,'server/actions/backup-before-fix.js'),oldCode);
assert.ok(oldCode.includes("const ORDER_BY = { teachers: 'member_id' };"));
const oldQuery="selectAll(() => db().from(table).select('*').order(ORDER_BY[table] || 'id'))";assert.ok(oldCode.includes(oldQuery));
writeFileSync(oldFile,oldCode.replace("import { db, run, selectAll } from '../lib/db.js';","import { db, run, selectAll } from '../lib/db.js';\nimport { backupTableQuery } from '../lib/backup-order.js';").replace("// 줄 순서를 정할 열(없으면 id).\nconst ORDER_BY = { teachers: 'member_id' };\n",'').replace(oldQuery,'selectAll(() => backupTableQuery(db(), table))'));
writeFileSync(path.join(legacy,'server/lib/backup-order.js'),readFileSync(path.join(repo,'server/lib/backup-order.js')));
const previous=path.join(workspace,'artifacts/index-hosting-fix-20261115/candidate-source-runtimefix/server/actions/backup.js');
writeFileSync(path.join(root,'candidate-before.mjs'),readFileSync(previous,'utf8').replace(/(from\s+)(['"])(\.\.?\/[^'"]+)\2/g,(_m,prefix,quote,spec)=>prefix+quote+pathToFileURL(path.resolve(repo,'server/actions',spec)).href+quote));

for(const [i,db]of sources.entries()){
 const bytes=dump(bases[i]);writeFileSync(path.join(root,i+'-baseline.dump'),bytes,{mode:0o600});create(db);load(db,bytes);
 sql("create schema backup_compat_local;create table backup_compat_local.marker(reference text);insert into backup_compat_local.marker values('backup-compat-20261115');",db);
 sql("insert into teachers(member_id,name,dept) select '99770'||lpad(g::text,8,'0'),'가짜백업방문'||g,'청년회' from generate_series(1,1105) g; insert into app_visits(nid,member_id,name,visits) select '99770'||lpad(g::text,8,'0'),'99770'||lpad(g::text,8,'0'),'가짜백업방문'||g,g from generate_series(1,1105) g;",db);
 if(i===1)sql(`insert into site_pilot_members(nid) select '99770'||lpad(g::text,8,'0') from generate_series(1,1105) g;
 insert into site_pilot_changes(actor_id,actor_name,operation,targets,reason,version) values('9977000000001','가짜백업담당','assign','["9977000000001"]','백업 복원 확인',1);
 insert into telegram_update_receipts(bot_key,update_id,payload_hash,status) select 'backup-fixture-'||b,g,repeat('a',64),case when g%3=0 then 'unknown' when g%3=1 then 'done' else 'processing' end from generate_series(1,1105) g cross join generate_series(1,2) b;
 insert into member_pins(nid,pin_hash,salt,ver) values('9977000000001',repeat('b',64),repeat('c',32),'backup-fixture-v1');
 insert into member_registration_contacts(nid,phone,source) values('9977000000001','01000000001','self_reported');
 insert into pin_recovery_challenges(nid,code_hash,pin_ver,expires_at,issued_by,reason) values('9977000000001',repeat('d',64),'backup-fixture-v1',now()+interval '1 day','9977000000001','가짜 백업 복원 확인');`,db);
}
const checkpoints=sources.map(db=>({db,contents:contents(db),schema:schema(db),sequences:sequences(db)}));
save('source-clones.json',checkpoints);
const procs=[];
try{
 const originalConf=readFileSync(path.join(workspace,'.local-auth-20261111/postgrest.conf'),'utf8');
 assert.ok(originalConf.includes('jesajang_auth_local'));assert.match(originalConf,/server-port\s*=\s*58432/);
 assert.ok(originalConf.includes('127.0.0.1:58431/')&&originalConf.includes('server-host = "127.0.0.1"'));
 for(const [i,db]of sources.entries()){
  const port=58451+i,conf=path.join(root,'rest-'+i+'.conf');
  writeFileSync(conf,originalConf.replaceAll('jesajang_auth_local',db).replace(/server-port\s*=\s*58432/,'server-port = '+port),{mode:0o600});
  const child=spawn('/tmp/jesajang-auth-tools/postgrest',[conf],{stdio:['ignore','ignore','pipe']});procs.push(child);
  child.stderr.on('data',()=>{});
  let ready=false;for(let n=0;n<60;n++){assert.ok(child.exitCode===null,'로컬 REST 시작 실패');try{const r=await fetch('http://127.0.0.1:'+port+'/');if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}assert.ok(ready);
 }
 for(const label of ['old-original','new-original','legacy-old','legacy-new','candidate-new']){
  const result=execFileSync(process.execPath,[path.join(repo,'tools/local-backup-compat-worker.mjs'),label],{encoding:'utf8',maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe']});console.log(result.trim());
 }
}finally{for(const proc of procs)proc.kill('SIGTERM');await Promise.all(procs.map(proc=>proc.exitCode!==null?null:new Promise(resolve=>proc.once('exit',resolve))));}

const snapshots=Object.fromEntries(['legacy-old','legacy-new','candidate-new'].map(label=>[label,JSON.parse(gunzipSync(readFileSync(path.join(root,label+'.json.gz'))))]));
assert.deepEqual(snapshots['legacy-new'].data,snapshots['candidate-new'].data,'구/신 백업 내용 완전 일치');
const restoreResults=[];
for(const [i,label]of ['legacy-old','legacy-new','candidate-new'].entries()){
 const source=sources[i===0?0:1],target=targets[i],snapshot=snapshots[label],names=Object.keys(snapshot.data);
 assert.equal(names.length,i===0?63:81);assert.ok(!names.includes('work_locks')&&!names.includes('attend_notify_queue'));
 const uniqueKeys=json("select coalesce(json_agg(json_build_object('table',c.relname,'columns',(select json_agg(a.attname order by k.ord) from unnest(co.conkey) with ordinality k(num,ord) join pg_attribute a on a.attrelid=c.oid and a.attnum=k.num))),'[]') from pg_constraint co join pg_class c on c.oid=co.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and co.contype in('p','u')",source);
 for(const table of names){
  const keys=[];const fake={select(){return this;},order(k){keys.push(k);return this;}};backupTableQuery({from:()=>fake},table);
  assert.ok(uniqueKeys.some(x=>x.table===table&&x.columns.every(c=>keys.includes(c))),'백업 정렬의 유일성: '+table);
 }
 if(i>0){assert.equal(snapshot.counts.site_pilot_members,1105);assert.equal(snapshot.data.telegram_update_receipts.filter(r=>r.bot_key.startsWith('backup-fixture-')).length,2210);}
 create(target);const schemaDump=dump(source,true);writeFileSync(path.join(root,label+'-schema.dump'),schemaDump,{mode:0o600});load(target,schemaDump);
 assert.ok(Object.values(contents(target)).every(x=>x.rows===0));
 const columns=json("select json_agg(json_build_object('table',table_name,'column',column_name,'generated',is_generated,'identity',is_identity) order by table_name,ordinal_position) from information_schema.columns where table_schema='public'",target);
 const edges=json("select coalesce(json_agg(json_build_object('child',conrelid::regclass::text,'parent',confrelid::regclass::text)),'[]') from pg_constraint where contype='f' and connamespace='public'::regnamespace",target);
 const ordered=[],visiting=new Set();function visit(t){if(ordered.includes(t))return;assert.ok(!visiting.has(t));visiting.add(t);for(const e of edges.filter(e=>e.child===t)){assert.ok(names.includes(e.parent));visit(e.parent);}visiting.delete(t);ordered.push(t);}names.forEach(visit);
 const triggers=json("select coalesce(json_agg(json_build_object('table',c.relname,'name',t.tgname,'enabled',t.tgenabled) order by c.relname,t.tgname),'[]') from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal",source);
 const inserts=[];for(const t of ordered){if(!snapshot.data[t].length)continue;const cs=columns.filter(c=>c.table===t&&c.generated==='NEVER'),fields=cs.map(c=>ident(c.column)).join(',');inserts.push(`insert into public.${ident(t)} (${fields}) ${cs.some(c=>c.identity==='YES')?'overriding system value ':''}select ${fields} from jsonb_populate_recordset(null::public.${ident(t)},${q(JSON.stringify(snapshot.data[t]))}::jsonb);`);}
 const disable=triggers.filter(t=>names.includes(t.table)).map(t=>`alter table public.${ident(t.table)} disable trigger ${ident(t.name)};`);
 const enable=triggers.filter(t=>names.includes(t.table)).map(t=>`alter table public.${ident(t.table)} ${{O:'enable',A:'enable always',R:'enable replica',D:'disable'}[t.enabled]} trigger ${ident(t.name)};`);
 if(i===0){assert.throws(()=>sql(['begin;',...disable,inserts[0],'select 1/0;','commit;'].join('\n'),target),e=>e.sqlState==='22012');assert.ok(Object.values(contents(target)).every(x=>x.rows===0));}
 // 앱 JSON에 없는 구조/번호 생성기 상태는 별도 로컬 점검 자료로 복원한다.
 const seqs=checkpoints[i===0?0:1].sequences;
 const setSeq=Object.entries(seqs).map(([name,s])=>`select setval(${q('public.'+name)},${s.last},${s.called});`);
 sql(['begin;',...disable,...inserts,...enable,'commit;',...setSeq].join('\n'),target);
 const expected=contents(source,names);assert.deepEqual(contents(target,names),expected);assert.deepEqual(schema(target),schema(source),'구조·RLS·권한·트리거 일치');assert.deepEqual(sequences(target),seqs);
 assert.ok(['work_locks','attend_notify_queue'].every(t=>contents(target,[t])[t].rows===0));
 // 실제 새 번호 발급 후 행은 취소하고 이 새 복원 사본의 시퀀스만 체크포인트로 되돌린다.
 sql("begin;insert into centers(name) values('가짜백업복원번호확인');rollback;",target);sql(setSeq.join('\n'),target);assert.deepEqual(contents(target,names),expected);assert.deepEqual(sequences(target),seqs);
 restoreResults.push({label,source,target,tables:names.length,rows:Object.values(expected).reduce((n,x)=>n+x.rows,0),contentsMatch:true,schemaAndPrivilegesMatch:true,sequenceCheckpointMatch:true,newIdInsertPassed:true,jsonSha256:sha(readFileSync(path.join(root,label+'.json.gz')))});
 console.log(JSON.stringify({restored:label,tables:names.length,rows:restoreResults.at(-1).rows,ok:true}));
}
for(const checkpoint of [...before,...checkpoints]){assert.deepEqual(contents(checkpoint.db),checkpoint.contents,'원본 자료 보존');assert.deepEqual(schema(checkpoint.db),checkpoint.schema);assert.deepEqual(sequences(checkpoint.db),checkpoint.sequences);}
const results={completedAt:new Date().toISOString(),productionChanged:false,originalDatabasesPreserved:true,sourceClonesPreserved:true,legacyReference:ref,missingOrderFailuresReproduced:2,backupsVerified:3,restores:restoreResults,legacyAndCandidateContentsEqual:true,readFailureDoesNotUploadOrPrune:true,invalidCronKeyRejected:true,externalNetworkCalls:0,storageWasSimulated:true,forcedRestoreFailureRolledBack:true,sqlMigrationsChanged:false};save('verification.json',results);console.log(JSON.stringify({ok:true,backups:3,restores:3,productionChanged:false}));
