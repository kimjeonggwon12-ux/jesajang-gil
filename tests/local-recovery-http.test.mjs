import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {LEGACY_ENTRIES} from '../next-app/lib/legacy-entry.mjs';
const base='http://127.0.0.1:58437',out=new URL('../../artifacts/recovery-package-20261114/',import.meta.url),repo=new URL('../',import.meta.url);
const hash=x=>createHash('sha256').update(x).digest('hex');
const latest=JSON.parse(await readFile(new URL('latest.json',out),'utf8')),manifest=JSON.parse(await readFile(latest.manifest,'utf8'));
const ids={owner:'9908000000001',chair:'9908000000002',edu:'9908000000004',fresh:'9908000000005'},names={owner:'가짜전환교사',chair:'가짜전환회장',edu:'가짜전환교육',fresh:'가짜전환미등록'};
const facts={buildId:manifest.buildId,productionChanged:false,browserProof:'별도 Chrome 기록',stages:[]};let child;
async function start(mode,rest='after'){
 child=spawn(process.execPath,['tools/local-recovery-server.mjs',mode,rest],{cwd:repo,stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('로컬 복구 서버 시작 시간 초과')),15000);child.stdout.on('data',b=>{text+=b;if(text.includes('"ready":true')){clearTimeout(timer);resolve();}});child.once('exit',code=>{clearTimeout(timer);reject(Error('로컬 서버 종료 '+code));});child.once('error',reject);});
}
async function stop(){if(!child||child.exitCode!==null)return;const done=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await done;child=null;}
async function call(action,body={},token){const r=await fetch(base+'/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...body,...(token?{_tk:token}:{})}),signal:AbortSignal.timeout(10000)});return {status:r.status,body:await r.json()};}
async function ok(action,body={},token){const r=await call(action,body,token);assert.equal(r.status,200,action);assert.equal(r.body.error,undefined,action+': '+r.body.error);return r.body;}
async function login(key){const r=await ok('verifyLogin',{memberId:ids[key],name:names[key],dept:key==='edu'?'교육부':'청년회',pin:'582946'});assert.equal(r.ok,true);assert.ok(r.token);return r.token;}
const specs=[['getRoster',{},'owner'],['getMyActivities',{},'owner'],['getMyTargets',{includeHistory:false},'owner'],['getTargetJournal',{targetId:'COMPAT-TARGET'},'owner'],['getMyAttendance',{},'owner'],['getRequiredEducation',{},'owner'],['getTargetRoom',{targetId:'COMPAT-TARGET'},'owner'],['educationAccess',{},'chair'],['cohortDetail',{cohortId:'COMPAT-COURSE'},'chair'],['getCenterDesk',{},'chair']];
async function readAll(tokens){const data={};for(const [action,body,key]of specs)data[action]=await ok(action,body,tokens[key]);return data;}
async function inspectSafety(tokens){
 assert.equal((await call('getMyAttendance',{memberId:ids.owner})).status,401);
 assert.equal((await call('getMyActivities',{memberId:ids.owner},tokens.edu)).status,403);
 assert.ok((await call('getTargetRoom',{targetId:'COMPAT-TARGET'},tokens.edu)).body.error);
 assert.equal((await call('cohortDetail',{cohortId:'COMPAT-COURSE'},tokens.edu)).status,403);
 const request=token=>fetch(base+'/api/room-attachment',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({_tk:token,targetId:'COMPAT-TARGET',id:2,kind:'file'})});
 const r=await request(tokens.owner);assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);const sha256=hash(Buffer.from(await r.arrayBuffer()));assert.equal(sha256,'2ab0389bc1bab448ae809f96ea67659df189bb202574588653cefb11ee7b337a');assert.equal((await request(tokens.edu)).status,403);return sha256;
}
async function expectedRoutes(dir,prefix=''){let routes=[];for(const f of await readdir(dir,{withFileTypes:true})){if(f.name==='api'||f.name==='[legacy]')continue;if(f.isDirectory())routes.push(...await expectedRoutes(path.join(dir,f.name),f.name.startsWith('(')?prefix:prefix+'/'+f.name));else if(f.name==='page.tsx')routes.push(prefix||'/');}return routes;}
test('전체 화면 패키지·강화 API와 62 SQL 복원 DB의 실제 HTTP 업무를 대조',async()=>{
 try{
  await start('next');const tokens={};for(const key of Object.keys(ids))tokens[key]=await login(key);
  const baseline=await readAll(tokens);assert.ok(baseline.getMyActivities.rows.some(r=>r.todayWork==='전환 후 보존할 새 활동'));
  assert.match(JSON.stringify(baseline.getTargetRoom),/복구 화면에서 남긴 두 번째 확인 기록/);
  assert.deepEqual(baseline.cohortDetail.permissions,['attendance','reports']);assert.equal(baseline.getCenterDesk.policy.mode,'role_scoped');
  assert.equal(baseline.educationAccess.telegramLinked,false);await inspectSafety(tokens);
  facts.stages.push({mode:'next',rest:'after',reads:specs.length,blocked:(await (await fetch(base+'/__local_recovery/status')).json()).metrics.blocked});await stop();
  await start('recovery');assert.deepEqual(await readAll(tokens),baseline,'복구에서도 같은 세션과 업무 결과');await inspectSafety(tokens);
  const routes=[...await expectedRoutes(fileURLToPath(new URL('../next-app/app',import.meta.url))),...Object.keys(LEGACY_ENTRIES).map(x=>'/'+x)];assert.equal(routes.length,40);
  for(const route of routes){assert.ok(manifest.routes[route],route);const response=await fetch(base+route);assert.equal(response.status,200,route);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(hash(bytes),manifest.publicHashes[manifest.routes[route].slice(1)],route+' 정적 원본 일치');assert.doesNotMatch(bytes.toString(),/가짜전환교사|9908000000001|compat-fixture|AUTH_SIGNING_KEY/);}
  for(const url of ['/recovery-manifest.json','/package.json','/server/actions/roster.js','/api/index.js','/.env','/.generated-legacy'])assert.equal((await fetch(base+url)).status,404,url+' 비공개 파일');
  const rsc=await fetch(base+'/activities/index.txt');assert.equal(rsc.status,200);assert.match(rsc.headers.get('content-type'),/text\/x-component/);
  const sw=await fetch(base+'/service-worker.js');assert.equal(sw.status,200);assert.match(sw.headers.get('cache-control'),/no-store/);
  facts.routes={generated:routes.length,legacy:16,contentHashesMatch:true,rsc:true,privateFilesDenied:6};
  facts.stages.push({mode:'recovery',rest:'after',reads:specs.length,blocked:(await (await fetch(base+'/__local_recovery/status')).json()).metrics.blocked});await stop();
  await start('next');assert.deepEqual(await readAll(tokens),baseline,'후보로 복귀한 뒤 같은 기록');await inspectSafety(tokens);await stop();
  await start('next','restore');assert.deepEqual(await readAll(tokens),baseline,'복원 DB의 업무 결과 동일');for(const key of Object.keys(ids))assert.ok(await login(key));const attachmentHash=await inspectSafety(tokens);
  facts.stages.push({mode:'next',rest:'restore',reads:specs.length,logins:4,attachmentHash,blocked:(await (await fetch(base+'/__local_recovery/status')).json()).metrics.blocked});
  facts.apiResults=Object.fromEntries(Object.entries(baseline).map(([key,value])=>[key,hash(JSON.stringify(value))]));
  assert.ok(facts.stages.every(s=>s.blocked.length===0));facts.ok=true;
 }finally{await stop();await writeFile(new URL('http-validation.json',out),JSON.stringify(facts,null,2)+'\n');}
});
