// 현재 가짜 출석 자료를 새 복원 DB에 보존한다. 운영/기존 복원 DB 초기화 없음.
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {jwt} from '../tests/helpers/local-db.mjs';
const sourceDb='jesajang_auth_local',targetDb='jesajang_attendance_restore_20261114';
for(const k of Object.keys(process.env))if(/SUPABASE|TELEGRAM|TEACHERSQUARE|ATT_BOT|R2_|GEMINI|VERCEL/.test(k))delete process.env[k];
process.env.SUPABASE_URL='http://127.0.0.1:58433';process.env.SUPABASE_SERVICE_ROLE_KEY=jwt('service_role');
const originalFetch=globalThis.fetch;let external=0;
globalThis.fetch=(input,init)=>{const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(u.origin!=='http://127.0.0.1:58433'){external++;throw Error('외부 연결 차단');}return originalFetch(input,{...init,redirect:'error'});};
const verifyExisting=process.argv[2]==='verify-existing';assert.ok(!process.argv[2]||verifyExisting);
const q=x=>"'"+String(x).replaceAll("'","''")+"'",ident=x=>{assert.match(x,/^[a-z_][a-z0-9_]*$/);return '"'+x+'"';};
function sql(statement,db=sourceDb){assert.ok(['postgres',sourceDb,targetDb].includes(db));try{return execFileSync('/opt/homebrew/bin/psql',['-h','/tmp/jesajang-auth-pg-socket','-p','58431','-U','postgres','-d',db,'-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'],{input:statement,encoding:'utf8',maxBuffer:32*1024*1024,stdio:['pipe','pipe','pipe']}).trim();}catch(e){throw Error('가짜 복원 SQL 실패: '+(String(e.stderr).match(/ERROR:\s+([A-Z0-9]{5})/)?.[1]||'unknown')+' (원문 비출력)');}}
const targetSql=s=>sql(s,targetDb),hashTable=table=>`select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]')::text,'UTF8')),'hex') from public.${ident(table)} t`;

assert.equal(sql(`select count(*) from pg_database where datname=${q(targetDb)}`,'postgres'),verifyExisting?'1':'0','기존 복원 DB는 덮어쓰지 않습니다.');
assert.equal(sql("select count(*) from teachers where member_id !~ '^99[0-9]+$'"),'0','가짜 명단만 허용');
const {buildBackup}=await import('../server/actions/backup.js');
const snapshot=JSON.parse(gunzipSync((await buildBackup()).bytes)),tables=Object.keys(snapshot.data);
const browserRecord=snapshot.data.attend_records.find(r=>r.meeting_id==='MT-SLOT-LOCAL');
assert.equal(browserRecord.additional_records[0].answers.q1,'Chrome 두 번째 타임 답변');
const sourceHashes=Object.fromEntries(tables.map(t=>[t,sql(hashTable(t))]));
const dir=new URL('../supabase/migrations/',import.meta.url),files=readdirSync(dir).filter(f=>f.endsWith('.sql')).sort();assert.equal(files.length,63);
if(!verifyExisting){
 sql('create database '+ident(targetDb),'postgres');
 targetSql(`create schema attendance_local;create table attendance_local.marker(reference text);insert into attendance_local.marker values('two-sessions-20261114');grant usage on schema public to anon,authenticated,service_role;
 alter default privileges for role postgres in schema public grant all on tables to anon,authenticated,service_role;
 alter default privileges for role postgres in schema public grant all on sequences to anon,authenticated,service_role;
 alter default privileges for role postgres in schema public grant execute on functions to anon,authenticated,service_role;`);
 for(const f of files)targetSql(readFileSync(new URL(f,dir),'utf8'));
}else assert.equal(targetSql('select reference from attendance_local.marker'),'two-sessions-20261114');
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

assert.equal(targetSql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('attendance_slot_start','attendance_late_text','attendance_session_submit','attendance_evening_start') and (p.prosecdef or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute') or not has_function_privilege('service_role',p.oid,'execute'))"),'0');
assert.equal(external,0);
const result={ok:true,migrations:files.length,tables:tables.length,rows:Object.values(snapshot.counts).reduce((a,b)=>a+b,0),sourceHashes,counts:snapshot.counts,browserRecordPreserved:true,allContentsMatch:true,triggersRestored:true,rlsAllTables:true,serviceOnlyFunctions:true,productionChanged:false,sourceDb,targetDb};
writeFileSync(new URL('../../artifacts/cross-check-attendance-sessions-20261114/backup-restore.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,sourceHashes:undefined,counts:undefined}));
