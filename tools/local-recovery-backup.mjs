// 4B 실제 흐름으로 만든 가짜 기록을 보존한 채 새 DB에 백업을 복원한다.
// 기존 DB 초기화/운영 접속/Storage 업로드 없음. 백업 원문과 PIN 정보는 메모리에만 둔다.
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {installRecoveryEnvironment} from './local-recovery-environment.mjs';
const sourceDb='jesajang_compat_after_20261114',targetDb='jesajang_compat_restore_20261114';
const verifyExisting=process.argv[2]==='verify-existing';assert.ok(!process.argv[2]||verifyExisting);
const q=x=>"'"+String(x).replaceAll("'","''")+"'",ident=x=>{assert.match(x,/^[a-z_][a-z0-9_]*$/);return '"'+x+'"';};
function sql(statement,db=sourceDb){assert.ok(['postgres',sourceDb,targetDb].includes(db));try{return execFileSync('/opt/homebrew/bin/psql',['-h','/tmp/jesajang-auth-pg-socket','-p','58431','-U','postgres','-d',db,'-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'],{input:statement,encoding:'utf8',maxBuffer:32*1024*1024,stdio:['pipe','pipe','pipe']}).trim();}catch(e){throw Error('가짜 복원 SQL 실패: '+(String(e.stderr).match(/ERROR:\s+([A-Z0-9]{5})/)?.[1]||'unknown')+' (원문 비출력)');}}
const targetSql=s=>sql(s,targetDb),hashTable=table=>`select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]')::text,'UTF8')),'hex') from public.${ident(table)} t`;
assert.equal(sql('select reference from compat_local.marker'),'0ea5ac7ea16a67b8ceb5b1848e45e13c0c064872');
assert.equal(sql("select count(*) from teachers where member_id not like '990800000000_'"),'0');
assert.equal(sql(`select count(*) from pg_database where datname=${q(targetDb)}`,'postgres'),verifyExisting?'1':'0','기존 복구 DB는 덮어쓰지 않습니다.');
if(verifyExisting)assert.equal(targetSql('select reference from compat_local.marker'),'recovery-backup-20261114');
// 정책·위임/감사·1000행 초과 페이지도 빈 표 비교가 아닌 내용 복원으로 확인한다.
if(!verifyExisting)sql(`begin;
 insert into education_delegations(scope_type,scope_id,nid,permissions,actor_nid) values('cohort','COMPAT-COURSE','9908000000002',array['attendance','reports'],'9908000000004') on conflict(scope_type,scope_id,nid) do nothing;
 insert into center_policy_changes(actor_id,actor_name,before_mode,after_mode,version,reason) select '9908000000004','가짜복구담당','legacy_global','role_scoped',2,'격리 복원 시험 자료' where exists(select 1 from center_approval_policy where id=1 and version=1 and mode='legacy_global');
 update center_approval_policy set mode='role_scoped',version=2 where id=1 and version=1 and mode='legacy_global';
 insert into app_visits(nid,member_id,name,visits) select '9907'||lpad(g::text,9,'0'),'9907'||lpad(g::text,9,'0'),'가짜복구방문'||g,1 from generate_series(1,1205) g on conflict(nid) do nothing;
 commit;`);
const metrics=installRecoveryEnvironment();
const {buildBackup}=await import('../server/actions/backup.js');
const backup=await buildBackup(),snapshot=JSON.parse(gunzipSync(backup.bytes)),tables=Object.keys(snapshot.data);
assert.equal(tables.length,77);assert.ok(snapshot.counts.app_visits>=1205);assert.equal(snapshot.counts.member_registration_contacts,1);assert.equal(snapshot.counts.room_attachments,1);
assert.ok(snapshot.counts.education_delegations>0&&snapshot.counts.education_access_events>0);assert.equal(snapshot.data.center_approval_policy[0].mode,'role_scoped');
assert.ok(snapshot.data.target_room_messages.some(m=>m.body==='복구 화면에서 남긴 두 번째 확인 기록'),'브라우저에서 실제 저장한 가짜 기록 포함');
assert.ok(!tables.includes('work_locks')&&!tables.includes('attend_notify_queue'));
const sourceHashes=Object.fromEntries(tables.map(t=>[t,sql(hashTable(t))]));
const dir=new URL('../supabase/migrations/',import.meta.url),files=readdirSync(dir).filter(f=>f.endsWith('.sql')).sort();assert.equal(files.length,62);
if(!verifyExisting){
sql('create database '+ident(targetDb),'postgres');
targetSql(`create schema compat_local;create table compat_local.marker(reference text);insert into compat_local.marker values('recovery-backup-20261114');grant usage on schema public to anon,authenticated,service_role;
 alter default privileges for role postgres in schema public grant all on tables to anon,authenticated,service_role;
 alter default privileges for role postgres in schema public grant all on sequences to anon,authenticated,service_role;
 alter default privileges for role postgres in schema public grant execute on functions to anon,authenticated,service_role;`);
for(const f of files)targetSql(readFileSync(new URL(f,dir),'utf8'));
}
const columns=JSON.parse(targetSql("select jsonb_agg(jsonb_build_object('table',table_name,'column',column_name,'generated',is_generated,'identity',is_identity,'default',column_default) order by table_name,ordinal_position) from information_schema.columns where table_schema='public'"));
const edges=JSON.parse(targetSql("select coalesce(jsonb_agg(jsonb_build_object('child',conrelid::regclass::text,'parent',confrelid::regclass::text)),'[]') from pg_constraint where contype='f' and connamespace='public'::regnamespace"));
const ordered=[],visiting=new Set();function visit(t){if(ordered.includes(t))return;assert.ok(!visiting.has(t));visiting.add(t);for(const e of edges.filter(x=>x.child===t)){assert.ok(tables.includes(e.parent));visit(e.parent);}visiting.delete(t);ordered.push(t);}tables.forEach(visit);
const triggersSql="select coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'name',t.tgname,'enabled',t.tgenabled) order by c.relname,t.tgname),'[]') from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal";
const triggers=JSON.parse(targetSql(triggersSql)),commands=['begin;','truncate '+tables.map(t=>'public.'+ident(t)).join(',')+' restart identity;'];
for(const t of triggers.filter(t=>tables.includes(t.table)))commands.push(`alter table public.${ident(t.table)} disable trigger ${ident(t.name)};`);
for(const table of ordered){if(!snapshot.data[table].length)continue;const meta=columns.filter(c=>c.table===table&&c.generated==='NEVER'),fields=meta.map(c=>ident(c.column)).join(',');commands.push(`insert into public.${ident(table)} (${fields}) ${meta.some(c=>c.identity==='YES')?'overriding system value ':''}select ${fields} from jsonb_populate_recordset(null::public.${ident(table)},${q(JSON.stringify(snapshot.data[table]))}::jsonb);`);}
for(const c of columns.filter(c=>tables.includes(c.table)&&(c.identity==='YES'||/nextval/.test(c.default||''))))commands.push(`select setval(pg_get_serial_sequence(${q('public.'+c.table)},${q(c.column)}),coalesce((select max(${ident(c.column)}) from public.${ident(c.table)}),1),exists(select 1 from public.${ident(c.table)}));`);
for(const t of triggers.filter(t=>tables.includes(t.table)))commands.push(`alter table public.${ident(t.table)} ${{O:'enable',A:'enable always',R:'enable replica',D:'disable'}[t.enabled]} trigger ${ident(t.name)};`);
commands.push('commit;');if(!verifyExisting)targetSql(commands.join('\n'));
assert.deepEqual(JSON.parse(targetSql(triggersSql)),triggers);
assert.deepEqual(JSON.parse(targetSql(triggersSql)),JSON.parse(sql(triggersSql)),'원본 업무 감사 트리거 상태와 일치');
for(const t of tables){assert.equal(sql(hashTable(t)),sourceHashes[t],'원본이 백업 중 바뀌면 중단: '+t);assert.equal(targetSql(hashTable(t)),sourceHashes[t],t+' 복원 내용 불일치');}
assert.equal(targetSql("select count(*) from pg_tables where schemaname='public' and not rowsecurity"),'0');
const newSeqs=['education_delegations_id_seq','education_access_events_id_seq','education_telegram_links_id_seq','education_telegram_challenges_id_seq','edu_roster_changes_id_seq','edu_excused_changes_id_seq','center_policy_changes_id_seq'];
for(const seq of newSeqs)assert.equal(targetSql(`select has_sequence_privilege('anon',${q(seq)},'USAGE,SELECT,UPDATE') or has_sequence_privilege('authenticated',${q(seq)},'USAGE,SELECT,UPDATE')`),'f',seq);
// 삽입 시험은 복구 DB에서만 수행하고 취소한다. 원본/복원 자료 내용은 그대로 유지한다.
targetSql("begin;insert into centers(name) values('가짜 복원 후 번호 확인');rollback;");
const conf=readFileSync(new URL('../../.local-compat-20261114/after.conf',import.meta.url),'utf8');assert.match(conf,/server-port\s*=\s*58436/);writeFileSync(new URL('../../.local-compat-20261114/restore.conf',import.meta.url),conf.replaceAll(sourceDb,targetDb).replace(/server-port\s*=\s*58436/,'server-port = 58438'),{mode:0o600});
assert.deepEqual(metrics.blocked,[]);const result={ok:true,migrations:files.length,tables:tables.length,rows:Object.values(snapshot.counts).reduce((a,b)=>a+b,0),sourceHashes,counts:snapshot.counts,allContentsMatch:true,triggersRestored:true,rlsAllTables:true,newSequencePrivilegesClosed:true,sequenceInsert:true,productionChanged:false,storageUploaded:false,externalObjectBackup:false,businessApiReadsPending:true};
writeFileSync(new URL('../../artifacts/recovery-package-20261114/backup-restore.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({...result,sourceHashes:undefined,counts:undefined}));
