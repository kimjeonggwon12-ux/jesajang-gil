// 허용한 소스만 고정한다. 비밀 설정·실제 자료·로컬 의존성·배포 명령은 포함하지 않는다.
import {readFileSync,writeFileSync,readdirSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=fileURLToPath(new URL('../',import.meta.url)),workspace=path.dirname(repo.replace(/\/$/,''));
const out=path.join(workspace,'artifacts/release-prep-20261115'),source=path.join(out,'candidate-source-final');
const tested=path.join(workspace,'.local-pilot-20261114/source');
const hash=x=>createHash('sha256').update(x).digest('hex');
function walk(dir,prefix=''){
 return readdirSync(path.join(dir,prefix),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e=>{const f=path.posix.join(prefix,e.name);assert.ok(!e.isSymbolicLink(),'링크 입력 금지');return e.isDirectory()?walk(dir,f):[f];});
}
const files=[];
for(const dir of ['api','server','shared','assets','vendor','next-app/app','next-app/components','next-app/lib','next-app/worker'])files.push(...walk(path.join(repo,dir)).map(f=>dir+'/'+f));
files.push(...readdirSync(repo).filter(f=>/\.(html|js|css|png)$/.test(f)));
files.push('manifest.json','package.json','package-lock.json','vercel.json','next-app/package.json','next-app/package-lock.json','next-app/next.config.mjs','next-app/tsconfig.json','next-app/next-env.d.ts','next-app/proxy.ts','next-app/vercel.json','tools/prepare-next-legacy.mjs','tools/build-release-next.mjs');
const all=[...new Set(files)].sort();
const packagingOnly=new Set(['next-app/vercel.json','tools/build-release-next.mjs']);
const engineOnly=new Set(['package.json','package-lock.json','next-app/package.json','next-app/package-lock.json']);
const compared=[];
for(const file of all){
 assert.ok(!/(^|\/)(?:\.env|\.git|node_modules|AGENTS\.md)/.test(file));
 if(engineOnly.has(file)){
  const now=JSON.parse(readFileSync(path.join(repo,file),'utf8')),old=JSON.parse(readFileSync(path.join(tested,file),'utf8'));
  const target=file.endsWith('lock.json')?now.packages['']:now,original=file.endsWith('lock.json')?old.packages['']:old;
  assert.equal(target.engines.node,'24.x');delete target.engines;delete original.engines;assert.deepEqual(now,old,'실행 버전 외 변경 금지');
 }else if(!packagingOnly.has(file)){assert.equal(hash(readFileSync(path.join(repo,file))),hash(readFileSync(path.join(tested,file))),'검증 후보와 다른 제품 파일: '+file);compared.push(file);}
}
const evidence=JSON.parse(readFileSync(path.join(out,'db-check.json'),'utf8'));assert.equal(evidence.sqlTotal,67);
const proof=JSON.parse(readFileSync(path.join(workspace,'artifacts/pilot-20261114/candidate-owner-mobile-20261115.json'),'utf8'));
assert.equal(readFileSync(path.join(tested,'next-app/.next/BUILD_ID'),'utf8').trim(),proof.buildId);
for(const [f,h]of Object.entries(proof.sourceHashes))assert.equal(hash(readFileSync(path.join(repo,f))),h,'최신 책임자 근거 불일치 '+f);
assert.ok(!existsSync(source),'기존 고정 소스 묶음을 덮어쓰지 않습니다.');mkdirSync(source,{recursive:true});
const hashes={};for(const file of all){mkdirSync(path.dirname(path.join(source,file)),{recursive:true});copyFileSync(path.join(repo,file),path.join(source,file));hashes[file]=hash(readFileSync(path.join(source,file)));}
const migrationFiles=readdirSync(path.join(repo,'supabase/migrations')).filter(f=>f.endsWith('.sql')).sort();assert.equal(migrationFiles.length,67);
const migrations=migrationFiles.map((f,i)=>({order:i+1,path:'supabase/migrations/'+f,sha256:hash(readFileSync(path.join(repo,'supabase/migrations',f))),decision:f.startsWith('00')?'baseline-do-not-rerun':'review-additional-after-approval'}));
mkdirSync(path.join(out,'database-review'),{recursive:true});
for(const m of migrations.filter(m=>m.decision.startsWith('review'))){copyFileSync(path.join(repo,m.path),path.join(out,'database-review',path.basename(m.path)));}
const canonical=rows=>rows.map(x=>{const p={...x.payload};delete p.estimated_rows;return JSON.stringify({kind:x.kind,payload:p});}).sort();
const current=JSON.parse(readFileSync(path.join(out,'production-schema.json'),'utf8')),previous=JSON.parse(readFileSync(path.join(workspace,'artifacts/cross-check-schema-20261114/production-schema.json'),'utf8'));
assert.deepEqual(canonical(current),canonical(previous));
const priorMigrations=JSON.parse(readFileSync(path.join(workspace,'artifacts/final-review-20261114/migrations-review.json'),'utf8'));
for(const p of priorMigrations.files)assert.equal(migrations.find(m=>m.path===p.path)?.sha256,p.sha256,'기존 SQL 변경');
const packageFile=path.join(out,'candidate-source-final.tar.gz');execFileSync('/usr/bin/tar',['-czf',packageFile,'-C',source,'.']);
const save=(name,value)=>writeFileSync(path.join(out,name),JSON.stringify(value,null,2)+'\n');
save('migrations-review.json',{createdAt:new Date().toISOString(),executedOnProduction:false,baselineCount:40,additionalCount:27,old65HashesUnchanged:true,productionSchemaUnchanged:true,files:migrations});
save('candidate-final.json',{createdAt:new Date().toISOString(),localBuildId:proof.buildId,sourceFingerprint:hash(JSON.stringify(hashes)),sourceFiles:all.length,testedFilesUnchanged:compared.length,packagingOnlyFiles:[...packagingOnly],nodeEngineOnlyFiles:[...engineOnly],sourceHashes:hashes,archive:packageFile,archiveSha256:hash(readFileSync(packageFile)),localBuildPath:path.join(tested,'next-app/.next'),previousDesktopMobileEvidence:'../pilot-20261114/candidate-owner-mobile-20261115.json',sqlCount:67,productionChanged:false,deployed:false});
console.log(JSON.stringify({ok:true,sourceFiles:all.length,testedFilesUnchanged:compared.length,localBuildId:proof.buildId,migrations:67,additional:27,productionChanged:false}));
