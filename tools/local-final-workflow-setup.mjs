// 5B 전체 회귀: 기존 DB와 증거는 보존하고 새 가짜 DB/시험 사본만 만든다.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,readdirSync,mkdirSync,cpSync,symlinkSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const repo=fileURLToPath(new URL('../',import.meta.url)),parent=path.dirname(repo.replace(/\/$/,''));
const run=path.join(parent,'.local-final-workflows-20261114'),copy=path.join(run,'candidate'),out=path.join(parent,'artifacts/final-workflows-20261114');
const target='jesajang_final_workflows_20261114',base='jesajang_auth_local';
const hash=x=>createHash('sha256').update(x).digest('hex');
function sql(text,db=target){assert.ok(['postgres',base,target].includes(db));try{return execFileSync('/opt/homebrew/bin/psql',['-h','/tmp/jesajang-auth-pg-socket','-p','58431','-U','postgres','-d',db,'-qAt','-v','ON_ERROR_STOP=1'],{input:text,encoding:'utf8',maxBuffer:32*1024*1024,stdio:['pipe','pipe','pipe']}).trim();}catch{throw Error('고정 로컬 DB 준비 실패 — 원문 비출력');}}
assert.ok(!existsSync(run),'기존 시험 폴더는 덮어쓰지 않습니다.');
assert.equal(sql("select count(*) from pg_database where datname='"+target+"'",'postgres'),'0');
const candidate=JSON.parse(readFileSync(path.join(parent,'artifacts/recovery-current-20261114/candidate.json'),'utf8'));
for(const [file,digest]of Object.entries(candidate.sourceHashes))assert.equal(hash(readFileSync(path.join(repo,file))),digest,file+' 후보 변경');
const tables=JSON.parse(sql("select json_agg(tablename order by tablename) from pg_tables where schemaname='public'",base));
const sourceHashes=Object.fromEntries(tables.map(t=>{assert.match(t,/^[a-z_][a-z0-9_]*$/);return[t,sql(`select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]')::text) from public."${t}" x`,base)];}));
mkdirSync(out,{recursive:true});mkdirSync(copy,{recursive:true,mode:0o700});
const files=readdirSync(path.join(repo,'supabase/migrations')).filter(f=>f.endsWith('.sql')).sort();assert.equal(files.length,64);
sql('create database '+target,'postgres');
sql(`create schema final_local;create table final_local.marker(reference text);insert into final_local.marker values('final-workflows-5B');grant usage on schema public to anon,authenticated,service_role;
 alter default privileges for role postgres in schema public grant all on tables to anon,authenticated,service_role;
 alter default privileges for role postgres in schema public grant all on sequences to anon,authenticated,service_role;
 alter default privileges for role postgres in schema public grant execute on functions to anon,authenticated,service_role;`);
for(const file of files)sql(readFileSync(path.join(repo,'supabase/migrations',file),'utf8'));
// 업무 소스/빌드는 원래 후보를 사용하고, 검사·증거만 별도 위치로 분리한다.
for(const e of readdirSync(repo,{withFileTypes:true}))if(!e.name.startsWith('.')&&e.name!=='tests')symlinkSync(path.join(repo,e.name),path.join(copy,e.name),e.isDirectory()?'dir':'file');
cpSync(path.join(repo,'tests'),path.join(copy,'tests'),{recursive:true,errorOnExist:true});
symlinkSync(path.join(repo,'.git'),path.join(copy,'.git'),'dir'); // git show의 이전 계산 원본 읽기 전용
mkdirSync(path.join(run,'.local-auth-20261111'),{mode:0o700});
writeFileSync(path.join(run,'.local-auth-20261111/runtime.json'),readFileSync(path.join(parent,'.local-auth-20261111/runtime.json')),{mode:0o600});
const helper=path.join(copy,'tests/helpers/local-db.mjs'),original=readFileSync(helper,'utf8');assert.equal(original.split("'jesajang_auth_local'").length,2);
const guard=`\nif(!finalChecked){const finalMarker=execFileSync('/opt/homebrew/bin/psql',['-h','/tmp/jesajang-auth-pg-socket','-p','58431','-U','postgres','-d','${target}','-qAt','-c','select reference from final_local.marker'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();\nif(finalMarker!=='final-workflows-5B')throw Error('새 전용 DB가 아닙니다.');finalChecked=true;}\n`;
writeFileSync(helper,original.replace("'jesajang_auth_local'","'"+target+"'").replace('export function sql(text) {','let finalChecked=false;\nexport function sql(text) {'+guard));
const copiedHashes={};function walk(dir,prefix=''){for(const e of readdirSync(dir,{withFileTypes:true})){const rel=path.posix.join(prefix,e.name),local=path.join(dir,e.name);if(e.isDirectory())walk(local,rel);else copiedHashes[rel]=hash(readFileSync(local));}}walk(path.join(copy,'tests'));
// 기존 검사의 상대 출력 주소가 과거 증거를 덮어쓰지 않도록 같은 하위 폴더만 빈 상태로 준비한다.
mkdirSync(path.join(run,'artifacts'));for(const e of readdirSync(path.join(parent,'artifacts'),{withFileTypes:true}))if(e.isDirectory())mkdirSync(path.join(run,'artifacts',e.name));
const conf=readFileSync(path.join(parent,'.local-current-recovery-20261114/after.conf'),'utf8');assert.ok(conf.includes('jesajang_recovery_current_20261114'));
writeFileSync(path.join(run,'postgrest.conf'),conf.replaceAll('jesajang_recovery_current_20261114',target).replace(/server-port\s*=\s*58436/,'server-port = 58432'),{mode:0o600});
const result={ok:true,phase:'5B',targetDb:target,sourceDbPreserved:base,sourceTableHashes:sourceHashes,migrations:64,sourceFiles:407,buildId:candidate.buildId,copy,artifacts:path.join(run,'artifacts'),testHashes:copiedHashes,changedTestFiles:['helpers/local-db.mjs (fixed local DB and marker guard only)'],productionChanged:false};
writeFileSync(path.join(out,'setup.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({ok:true,targetDb:target,migrations:64,testFiles:Object.keys(copiedHashes).length,productionChanged:false}));
