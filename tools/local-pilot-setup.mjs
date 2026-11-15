// 기존 검증 자료를 한 번 복제한다. 운영 접속·기존 DB 초기화·전체 migration 재실행 없음.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,cpSync,readdirSync,symlinkSync,existsSync} from 'node:fs';
import {scryptSync,createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const repo=fileURLToPath(new URL('../',import.meta.url)),workspace=path.dirname(repo.replace(/\/$/,''));
const root=path.join(workspace,'.local-pilot-20261114'),source=path.join(root,'source'),art=path.join(workspace,'artifacts/pilot-20261114');
const target='jesajang_pilot_20261114',base='jesajang_final_workflows_20261114';
const args=['-h','/tmp/jesajang-auth-pg-socket','-p','58431','-U','postgres'];
function sql(text,db=target){assert.ok([target,base,'postgres'].includes(db));return execFileSync('/opt/homebrew/bin/psql',[...args,'-d',db,'-qAt','-v','ON_ERROR_STOP=1'],{input:text,encoding:'utf8',maxBuffer:64*1024*1024,stdio:['pipe','pipe','pipe']}).trim();}
function snapshot(){
 mkdirSync(source,{recursive:true});
 for(const dir of ['api','server','shared','assets','tools'])cpSync(path.join(repo,dir),path.join(source,dir),{recursive:true});
 for(const file of readdirSync(repo).filter(f=>/\.(html|js|css|png|json)$/.test(f)))cpSync(path.join(repo,file),path.join(source,file));
 cpSync(path.join(repo,'vendor'),path.join(source,'vendor'),{recursive:true});
 mkdirSync(path.join(source,'next-app'),{recursive:true});
 for(const dir of ['app','components','lib','worker'])cpSync(path.join(repo,'next-app',dir),path.join(source,'next-app',dir),{recursive:true});
 for(const file of ['package.json','package-lock.json','tsconfig.json','next.config.mjs','next-env.d.ts','proxy.ts'])cpSync(path.join(repo,'next-app',file),path.join(source,'next-app',file));
 for(const [dest,origin] of [[path.join(source,'node_modules'),path.join(repo,'node_modules')],[path.join(source,'next-app/node_modules'),path.join(repo,'next-app/node_modules')]])if(!existsSync(dest))symlinkSync(origin,dest,'dir');
}
if(process.argv[2]==='snapshot'){assert.ok(existsSync(path.join(root,'prepared.json')));snapshot();console.log('Updated isolated source snapshot only');process.exit(0);}
assert.ok(!existsSync(root),'기존 준비 폴더를 덮어쓰지 않습니다.');
assert.equal(sql('select reference from final_local.marker',base),'final-workflows-5B');
assert.equal(sql("select count(*) from pg_database where datname='"+target+"'",'postgres'),'0');
mkdirSync(root,{mode:0o700});mkdirSync(art,{recursive:true});
const tables=JSON.parse(sql("select json_agg(tablename order by tablename) from pg_tables where schemaname='public'",base));
const hashes=Object.fromEntries(tables.map(t=>[t,sql(`select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]')::text) from public."${t}" x`,base)]));
const dump=execFileSync('/opt/homebrew/bin/pg_dump',[...args,'-d',base,'--format=custom'],{maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe']});writeFileSync(path.join(root,'baseline.dump'),dump,{mode:0o600});
sql('create database '+target,'postgres');
execFileSync('/opt/homebrew/bin/pg_restore',[...args,'-d',target,'--exit-on-error'],{input:dump,stdio:['pipe','pipe','pipe']});
const migration='20261114063324_account_pilot_routing.sql',content=readFileSync(path.join(repo,'supabase/migrations',migration),'utf8');sql('begin;'+content+'commit;');
const salt='cd'.repeat(16),hash=scryptSync('582946',salt,32).toString('hex');
for(const [suffix,name] of [['990','가짜운영자'],['991','가짜기존사용자'],['992','가짜신규사용자']]){const id='9900000000'+suffix;sql(`insert into teachers(member_id,name,dept,region) values('${id}','${name}','장년회','가짜시범부서');insert into member_pins(nid,pin_hash,salt,ver) values('${id}','${hash}','${salt}','pilot-${suffix}');`);}
const conf=readFileSync(path.join(workspace,'.local-final-workflows-20261114/postgrest.conf'),'utf8').replaceAll(base,target).replace(/server-port\s*=\s*58432/,'server-port = 58442');
assert.ok(conf.includes(target)&&conf.includes('58442'));writeFileSync(path.join(root,'postgrest.conf'),conf,{mode:0o600});
snapshot();
const result={target,base,source,sourceTableHashes:hashes,migration,migrationHash:createHash('sha256').update(content).digest('hex'),productionChanged:false};
writeFileSync(path.join(root,'prepared.json'),JSON.stringify(result,null,2));writeFileSync(path.join(art,'setup.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({ready:true,target,migrationsApplied:1,originalTables:tables.length,productionChanged:false}));
