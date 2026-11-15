// 65개 SQL 검증 DB를 새 로컬 사본으로 복원하고 마지막 2개만 검증한다.
// 운영 주소/자격/임의 DB 옵션은 받지 않으며 기존 DB와 증거를 덮어쓰지 않는다.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const repo=new URL('../',import.meta.url),out=new URL('../../artifacts/release-prep-20261115/',import.meta.url);
const base='jesajang_final_workflows_20261114',db='jesajang_release_apply_20261115',restored='jesajang_release_restore_20261115';
const args=['-h','/tmp/jesajang-auth-pg-socket','-p','58431','-U','postgres'];
const migrations=['20261114063324_account_pilot_routing.sql','20261114113413_system_owner_room_control.sql'];
const digest=x=>createHash('sha256').update(x).digest('hex');
function sql(text,name=db){
 assert.ok([base,db,restored,'postgres'].includes(name));
 return execFileSync('/opt/homebrew/bin/psql',[...args,'-d',name,'-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'],{input:text,encoding:'utf8',maxBuffer:64*1024*1024,stdio:['pipe','pipe','pipe']}).trim();
}
const json=(text,name)=>JSON.parse(sql(text,name));
const schema=name=>json(readFileSync(new URL('tools/schema-review-readonly.sql',repo),'utf8'),name);
const comparable=rows=>rows.filter(x=>!['environment','default_acl'].includes(x.kind)).map(x=>{const p={...x.payload};delete p.estimated_rows;return JSON.stringify({kind:x.kind,payload:p});}).sort();
const tables=name=>json("select json_agg(tablename order by tablename) from pg_tables where schemaname='public'",name);
function contents(name,names=tables(name)){
 return Object.fromEntries(names.map(t=>{assert.match(t,/^[a-z_][a-z0-9_]*$/);return [t,json(`select json_build_object('rows',count(*),'hash',md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]')::text)) from public."${t}" t`,name)];}));
}
const dump=name=>execFileSync('/opt/homebrew/bin/pg_dump',[...args,'-d',name,'--format=custom'],{maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe']});
function restore(name,bytes){sql('create database '+name,'postgres');execFileSync('/opt/homebrew/bin/pg_restore',[...args,'-d',name,'--exit-on-error'],{input:bytes,stdio:['pipe','pipe','pipe']});}
const save=(file,data)=>writeFileSync(new URL(file,out),JSON.stringify(data,null,2)+'\n');
assert.ok(!existsSync(new URL('db-check.json',out)),'기존 완료 증거 보존');
for(const name of [db,restored])assert.equal(sql(`select count(*) from pg_database where datname='${name}'`,'postgres'),'0','기존 DB 재사용/초기화 금지');
assert.equal(sql('select reference from final_local.marker',base),'final-workflows-5B');
const before=contents(base),baseSchema=schema(base);assert.equal(Object.keys(before).length,80);
mkdirSync(out,{recursive:true});const baseline=dump(base);writeFileSync(new URL('local-baseline-65.dump',out),baseline,{mode:0o600});restore(db,baseline);
assert.deepEqual(contents(db),before);
// 운영 postgres의 기본 부여 권한을 추가 객체에도 재현해 누락된 revoke를 찾는다.
sql(`alter default privileges for role postgres in schema public grant all on tables to anon,authenticated,service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon,authenticated,service_role;
alter default privileges for role postgres in schema public grant execute on functions to anon,authenticated,service_role;`);
const results=[];
for(const file of migrations){
 const code=readFileSync(new URL('supabase/migrations/'+file,repo),'utf8');const beforeFailure=schema(db);let state;
 try{sql(`begin; set local lock_timeout='500ms'; set local statement_timeout='5s';\n${code}\nselect 1/0; commit;`);}catch(e){state=String(e.stderr).match(/ERROR:\s+([A-Z0-9]{5})/)?.[1];}
 assert.equal(state,'22012');assert.deepEqual(comparable(schema(db)),comparable(beforeFailure));assert.deepEqual(contents(db,Object.keys(before)),before);
 sql(`begin; set local lock_timeout='500ms'; set local statement_timeout='5s';\n${code}\ncommit;`);
 assert.deepEqual(contents(db,Object.keys(before)),before);results.push({file,sha256:digest(code),forcedFailureRolledBack:true,originalTablesPreserved:true});
}
const finalSchema=schema(db),finalContents=contents(db);
const addedFunctions=finalSchema.filter(x=>x.kind==='function'&&!baseSchema.some(y=>y.kind==='function'&&x.payload.name===y.payload.name&&x.payload.identity===y.payload.identity));
assert.ok(addedFunctions.length>=4);
assert.ok(addedFunctions.every(x=>!x.payload.anon_execute&&!x.payload.authenticated_execute&&x.payload.service_execute));
for(const t of ['site_pilot_policy','site_pilot_members','site_pilot_changes']){
 const p=finalSchema.find(x=>x.kind==='relation'&&x.payload.name===t).payload;assert.equal(p.rls,true);assert.ok(!/anon=|authenticated=|(?:^|,)=[^,]*/.test(p.acl));
}
assert.ok(!/anon=|authenticated=/.test(finalSchema.find(x=>x.kind==='relation'&&x.payload.name==='site_pilot_changes_id_seq').payload.acl));
assert.deepEqual(json('select json_build_object(\'enabled\',enabled,\'version\',version) from site_pilot_policy'),{enabled:false,version:1});
assert.equal(sql('select count(*) from site_pilot_members'),'0');
const backup=dump(db);writeFileSync(new URL('local-candidate-67.dump',out),backup,{mode:0o600});restore(restored,backup);
assert.deepEqual(contents(restored),finalContents);assert.deepEqual(comparable(schema(restored)),comparable(finalSchema));
assert.deepEqual(contents(base),before,'원본 80표 불변');
save('db-final-schema.json',finalSchema);save('db-before-content-hashes.json',before);save('db-restored-content-hashes.json',contents(restored));
save('db-check.json',{completedAt:new Date().toISOString(),base,db,restored,sqlTotal:67,onlyNewFiles:results,originalTables:80,restoredTables:Object.keys(finalContents).length,restoredRows:Object.values(finalContents).reduce((n,x)=>n+x.rows,0),privateFunctions:addedFunctions.map(x=>x.payload.name),newPrivateAclPassed:true,initialPilotDisabled:true,initialAssignments:0,originalUnchanged:true,backupSha256:digest(backup),productionChanged:false});
console.log(JSON.stringify({ok:true,deltaFiles:2,forcedRollbackChecks:2,originalTablesPreserved:80,restoredTables:Object.keys(finalContents).length,productionChanged:false}));
