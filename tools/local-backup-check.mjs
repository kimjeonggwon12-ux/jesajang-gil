// 격리 가짜 DB 전용. 운영 복구 도구가 아니며 DB 이름·주소를 인자로 받지 않는다.
// jesajang_auth_local의 가짜 자료를 준비하고 jesajang_auth_backup_restore를 재생성한다.
// Storage/R2/메시지 발송을 호출하지 않는다. 인증 값이 든 백업 원문은 출력·파일 저장하지 않는다.
import {execFileSync} from 'node:child_process';
import {readdirSync,readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {seed,sql,quote,ids,register,issue,jwt} from '../tests/helpers/local-db.mjs';

for(const key of Object.keys(process.env))if(/SUPABASE|TEACHERSQUARE|TELEGRAM|GEMINI|R2_|ATTEND_|BOT_TOKEN|VERCEL/.test(key))delete process.env[key];
process.env.SUPABASE_URL='http://127.0.0.1:58433';
process.env.SUPABASE_SERVICE_ROLE_KEY=jwt('service_role');
const originalFetch=globalThis.fetch;
globalThis.fetch=(input,init)=>{
  const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);
  if(u.hostname!=='127.0.0.1'||u.port!=='58433')throw new Error('External network disabled in local backup check');
  return originalFetch(input,{...init,redirect:'error'});
};
const targetDb='jesajang_auth_backup_restore';
function targetSql(statement) {
  try {return execFileSync('/opt/homebrew/bin/psql',['-h','/tmp/jesajang-auth-pg-socket','-p','58431','-U','postgres','-d',targetDb,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','-qAt'],{input:statement,encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:32*1024*1024}).trim();}
  catch(error) {const state=String(error.stderr||'').match(/ERROR:\s+([A-Z0-9]{5})/)?.[1]||'unknown';const table=[...String(error.stdout||'').matchAll(/restore_table:([a-z_][a-z0-9_]*)/g)].at(-1)?.[1]||'schema';throw new Error('격리 복원 SQL 실패 ('+state+', '+table+') — 입력 자료와 인증 값은 출력하지 않습니다.');}
}
const ident=name=>{assert.match(name,/^[a-z_][a-z0-9_]*$/);return '"'+name+'"';};

seed();
sql(`insert into targets(target_id,creator_id,target_name,room_generation) values('BACKUP-ROOM','${ids.member}','가짜복원대상',3) on conflict(target_id) do update set room_generation=3;
 insert into room_attachments(id,target_id,uploader_nid,kind,name,mime,byte_size,object_key,message_id,expires_at)
 values('00000000-0000-4000-8000-000000000001','BACKUP-ROOM','${ids.member}','file','가짜복원.pdf','application/pdf',12,'room-private/fake/restore.pdf',987654,now()+interval '1 day');
 update center_approval_policy set mode='role_scoped',version=2 where id=1;
  insert into center_policy_changes(actor_id,actor_name,before_mode,after_mode,version,reason) values('${ids.admin}','가짜운영담당','legacy_global','role_scoped',2,'가짜 복원 확인');
  truncate app_visits,cohort_tg_chats,report_rooms;
  insert into app_visits(nid,member_id,name,visits) select '98'||lpad(g::text,11,'0'),'98'||lpad(g::text,11,'0'),'가짜방문'||g,1 from generate_series(1,1205) g;
  insert into cohort_tg_chats(chat_id,title) values('LOCAL-CHAT','가짜방');
  insert into report_rooms(dept,chat_id,title,active) values('격리부서','LOCAL-REPORT','가짜보고방',false);`);
assert.equal((await register({memberId:ids.missing,name:'테스트미등록',phone:'01000000007'})).body.ok,true);
assert.ok((await register({phone:'01000000009'})).body.error);
assert.equal((await issue(ids.other)).body.ok,true);
const {buildBackup}=await import('../server/actions/backup.js');
const backup=await buildBackup();
const snapshot=JSON.parse(gunzipSync(backup.bytes));
assert.equal(snapshot.counts.center_approval_policy,1);assert.equal(snapshot.counts.center_policy_changes,1);
assert.equal(snapshot.data.center_approval_policy[0].mode,'role_scoped');
assert.equal(snapshot.counts.app_visits,1205,'1000행 이후 페이지도 포함');
assert.equal(snapshot.counts.member_registration_contacts,1);
assert.equal(snapshot.counts.pin_recovery_challenges,1);
assert.equal(snapshot.counts.pin_enrollment_attempts,1);
const tables=Object.keys(snapshot.data);
assert.equal(tables.includes('work_locks'),false);assert.equal(tables.includes('attend_notify_queue'),false);

if(sql(`select count(*) from pg_database where datname=${quote(targetDb)}`)==='0')sql('create database '+ident(targetDb));
targetSql('drop schema public cascade; create schema public; grant usage on schema public to anon,authenticated,service_role; alter default privileges in schema public grant all on tables to service_role; alter default privileges in schema public grant all on sequences to service_role;');
const migrations=new URL('../supabase/migrations/',import.meta.url);
const files=readdirSync(migrations).filter(f=>f.endsWith('.sql')).sort();
for(const file of files)targetSql(readFileSync(new URL(file,migrations),'utf8'));
const columns=JSON.parse(targetSql("select jsonb_agg(jsonb_build_object('table',table_name,'column',column_name,'generated',is_generated,'identity',is_identity,'default',column_default) order by table_name,ordinal_position) from information_schema.columns where table_schema='public'"));
const edges=JSON.parse(targetSql("select coalesce(jsonb_agg(jsonb_build_object('child',conrelid::regclass::text,'parent',confrelid::regclass::text)),'[]') from pg_constraint where contype='f' and connamespace='public'::regnamespace"));
const ordered=[],visiting=new Set();
function visit(table) {
  if(ordered.includes(table))return;
  assert.equal(visiting.has(table),false,'순환 참조는 별도 복구 설계 필요');visiting.add(table);
  for(const edge of edges.filter(e=>e.child===table)){assert.ok(tables.includes(edge.parent));visit(edge.parent);}
  visiting.delete(table);ordered.push(table);
}
tables.forEach(visit);
const inserts=['begin;','truncate '+tables.map(t=>'public.'+ident(t)).join(',')+' restart identity;'];
// 복원 중 업무 감사 트리거를 다시 실행하면 백업에 포함된 이력과 충돌한다.
// 외래키/제약 트리거는 유지하며, 새로 만든 이 로컬 복구 DB의 사용자 트리거만 잠시 멈춘다.
const userTriggers=JSON.parse(targetSql("select coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'name',t.tgname,'enabled',t.tgenabled)),'[]') from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal"));
for(const t of userTriggers.filter(t=>tables.includes(t.table)))inserts.push(`alter table public.${ident(t.table)} disable trigger ${ident(t.name)};`);
for(const table of ordered) {
  if(!snapshot.data[table].length)continue;
  const meta=columns.filter(c=>c.table===table && c.generated==='NEVER');
  const fields=meta.map(c=>ident(c.column)).join(',');
  inserts.push(`\\echo restore_table:${table}\ninsert into public.${ident(table)} (${fields}) ${meta.some(c=>c.identity==='YES')?'overriding system value ':''}select ${fields} from jsonb_populate_recordset(null::public.${ident(table)},${quote(JSON.stringify(snapshot.data[table]))}::jsonb);`);
}
for(const c of columns.filter(c=>tables.includes(c.table)&&(c.identity==='YES'||/nextval/.test(c.default||'')))) {
  inserts.push(`select setval(pg_get_serial_sequence(${quote('public.'+c.table)},${quote(c.column)}),coalesce((select max(${ident(c.column)}) from public.${ident(c.table)}),1),exists(select 1 from public.${ident(c.table)}));`);
}
for(const t of userTriggers.filter(t=>tables.includes(t.table)))inserts.push(`alter table public.${ident(t.table)} ${{O:'enable',A:'enable always',R:'enable replica',D:'disable'}[t.enabled]} trigger ${ident(t.name)};`);
inserts.push('commit;');targetSql(inserts.join('\n'));
const restoredTriggerStates=JSON.parse(targetSql("select coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'name',t.tgname,'enabled',t.tgenabled)),'[]') from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal"));
assert.deepEqual(restoredTriggerStates,userTriggers,'복원 뒤 사용자 트리거 상태 보존');
for(const table of tables) {
  // 큰 명단 스냅샷 원문을 프로세스 출력으로 전달하지 않고 DB에서 전체 내용의 해시를 비교한다.
  const query=`select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]')::text,'UTF8')),'hex') from public.${ident(table)} t`;
  assert.equal(targetSql(query),sql(query),table+' 복원 자료 불일치');
}
const next=Number(targetSql("insert into centers(name) values('복원 후 가짜센터') returning id"));
const previous=Number(sql('select coalesce(max(id),0) from centers'));
assert.ok(next>previous,'복원 뒤 새 번호 충돌 없음');
assert.equal(targetSql("select count(*) from pg_tables where schemaname='public' and not rowsecurity"),'0');
console.log(JSON.stringify({ok:true,migrations:files.length,tables:tables.length,rows:Object.values(snapshot.counts).reduce((a,b)=>a+b,0),paginatedRows:snapshot.counts.app_visits,allTableContentsMatch:true,sequenceInsert:true,storageUpload:false,productionTouched:false},null,2));
