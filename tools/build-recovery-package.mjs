// 현재 화면 전체를 정적 출력하고 강화 API를 함께 고정하는 로컬 검토 패키지.
// 기존 Next 빌드/설정/운영을 변경하지 않고 별도 폴더에서 빌드한다. 배포 명령 없음.
import {cp,mkdir,readFile,writeFile,readdir,symlink,stat} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const repo=fileURLToPath(new URL('../',import.meta.url)),parent=path.dirname(repo),out=path.join(parent,'artifacts/recovery-package-20261114');
const stamp=new Date().toISOString().replace(/[:.]/g,'-'),run=path.join(parent,'.local-recovery-20261114',stamp),source=path.join(run,'source'),app=path.join(source,'next-app'),pkg=path.join(run,'package');
const digest=x=>createHash('sha256').update(x).digest('hex');
async function walk(base,prefix='') {const result=[];for(const entry of (await readdir(path.join(base,prefix),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const p=path.posix.join(prefix,entry.name);if(entry.isSymbolicLink())throw Error('패키지 입력 심볼릭 링크 거절: '+p);if(entry.isDirectory())result.push(...await walk(base,p));else if(entry.isFile())result.push(p);}return result;}
async function hashes(base,files){return Object.fromEntries(await Promise.all(files.map(async f=>[f,digest(await readFile(path.join(base,f)))])))}
await mkdir(out,{recursive:true});await mkdir(app,{recursive:true});
const inputs=[];
for(const dir of ['next-app/app','next-app/components','next-app/lib','next-app/types','next-app/worker','next-app/public','shared','api','server','supabase/migrations']){
  try{for(const f of await walk(path.join(repo,dir)))inputs.push(dir+'/'+f);}catch(e){if(e.code!=='ENOENT')throw e;}
}
inputs.push('tools/build-recovery-package.mjs','package.json','package-lock.json','next-app/package.json','next-app/package-lock.json','next-app/tsconfig.json','next-app/next-env.d.ts');
const before=await hashes(repo,inputs),fingerprint=digest(JSON.stringify(before)),buildId='recovery-'+fingerprint.slice(0,16);
for(const dir of ['app','components','lib','types','worker','public']){
  try{await cp(path.join(repo,'next-app',dir),path.join(app,dir),{recursive:true,filter:s=>!s.startsWith(path.join(repo,'next-app/app/api'))});}catch(e){if(e.code!=='ENOENT')throw e;}
}
for(const f of ['package.json','package-lock.json','tsconfig.json','next-env.d.ts'])await cp(path.join(repo,'next-app',f),path.join(app,f));
await cp(path.join(repo,'shared'),path.join(source,'shared'),{recursive:true});
await symlink(path.join(repo,'next-app/node_modules'),path.join(app,'node_modules'));
await symlink(path.join(repo,'node_modules'),path.join(run,'node_modules'));
// 디렉터리별 index.html로 /admin 출력과 /admin.html의 RSC 디렉터리 충돌을 피한다.
// 브라우저 URL의 슬래시는 강제 변경하지 않아 이전 링크/쿼리/해시 계약을 유지한다.
await writeFile(path.join(app,'next.config.mjs'),`export default {output:'export',trailingSlash:true,skipTrailingSlashRedirect:true,poweredByHeader:false,generateBuildId:async()=>${JSON.stringify(buildId)}};\n`);
const log=path.join(out,'build-'+stamp+'.log'),stream=createWriteStream(log);
const child=spawn(process.execPath,[path.join(repo,'next-app/node_modules/next/dist/bin/next'),'build','--webpack'],{cwd:app,env:{PATH:process.env.PATH,TMPDIR:process.env.TMPDIR,NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
child.stdout.pipe(stream,{end:false});child.stderr.pipe(stream,{end:false});
const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});await new Promise(resolve=>stream.end(resolve));
if(code!==0)throw Error('별도 정적 빌드 실패. 로그: '+log);
assert.deepEqual(await hashes(repo,inputs),before,'빌드 중 입력 파일 변경 시 패키지를 확정하지 않음');
await mkdir(pkg);await cp(path.join(app,'out'),path.join(pkg,'public'),{recursive:true});
for(const dir of ['api','server','shared'])await cp(path.join(repo,dir),path.join(pkg,dir),{recursive:true});
for(const f of ['package.json','package-lock.json'])await cp(path.join(repo,f),path.join(pkg,f));
const publicFiles=await walk(path.join(pkg,'public'));
assert.ok(publicFiles.includes('index.html'));assert.ok(!publicFiles.some(f=>f.startsWith('api/')),'API를 정적 결과에 넣지 않음');
const publicPages=publicFiles.filter(f=>f.endsWith('.html')&&!f.startsWith('_next/'));
// 정적 원본은 원래 URL 그대로, 생성 페이지는 디렉터리의 index.html로 제공한다.
const routes=Object.fromEntries(publicPages.filter(f=>!['404.html','404/index.html','500.html'].includes(f)).map(f=>[f==='index.html'?'/':f.endsWith('/index.html')?'/'+f.slice(0,-11):'/'+f,'/'+f]));
const manifest={format:1,createdAt:new Date().toISOString(),sourceFingerprint:fingerprint,nextVersion:JSON.parse(await readFile(path.join(repo,'next-app/package.json'),'utf8')).dependencies.next,buildId,routes,sourceHashes:before,publicHashes:await hashes(path.join(pkg,'public'),publicFiles),apiSourceHashes:await hashes(pkg,(await walk(pkg)).filter(f=>!f.startsWith('public/'))),productionDeployment:false};
await writeFile(path.join(pkg,'recovery-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
await writeFile(path.join(pkg,'README.md'),'# 교사광장 정적 복구 검토 패키지\n\n현재 화면 전체와 강화 API를 고정한 로컬 후보입니다. 운영 배포 권한을 뜻하지 않습니다.\n\n공개 제공 대상은 public/뿐이며 api/·server/·shared/·잠금 파일·manifest를 정적 파일로 공개하지 않습니다. API와 비공개 첨부 처리는 서버에서 실행해야 합니다. DB·서명 키·파일 저장소는 유지하며 DB를 과거 상태로 되돌리지 않습니다.\n\nNext 실행 서버 장애를 우회하기 위한 후보입니다. 같은 업무/API/화면 코드의 오류, DB 장애, 외부 서비스 장애까지 자동 복구하지 않습니다. 변경된 화면 버전을 되돌릴 때는 이전에 검증해 보관한 패키지를 선택해야 합니다. 실제 호스팅·운영 전환은 별도 검증과 승인이 필요합니다.\n');
await writeFile(path.join(out,'latest.json'),JSON.stringify({run,package:pkg,manifest:path.join(pkg,'recovery-manifest.json'),buildLog:log,buildId,sourceFingerprint:fingerprint,pages:publicPages.length,routes:Object.keys(routes).length,publicFiles:publicFiles.length},null,2)+'\n');
console.log(JSON.stringify({ok:true,package:pkg,buildId,pages:publicPages.length,routes:Object.keys(routes).length,publicFiles:publicFiles.length,productionChanged:false}));
