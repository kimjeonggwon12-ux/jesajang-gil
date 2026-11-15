// 5A4: 이미 준비한 가짜 DB만 조회한다. 초기화/운영 접속/실제 외부 발송 없음.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {LEGACY_ENTRIES} from '../next-app/lib/legacy-entry.mjs';
import {OWNER} from './helpers/education-fixture.mjs';
const base='http://127.0.0.1:58437',out=new URL('../../artifacts/recovery-current-20261114/',import.meta.url),repo=new URL('../',import.meta.url);
const hash=x=>createHash('sha256').update(x).digest('hex');
const latest=JSON.parse(await readFile(new URL('package.json',out),'utf8'));
const manifest=JSON.parse(await readFile(latest.manifest,'utf8'));
const ids={owner:'9908000000001',chair:'9908000000002',edu:'9908000000004',fresh:'9908000000005',appOwner:OWNER};
const names={owner:'가짜전환교사',chair:'가짜전환회장',edu:'가짜전환교육',fresh:'가짜전환미등록',appOwner:'테스트앱관리'};
const facts={phase:'5A4',buildId:manifest.buildId,productionChanged:false,realExternalSends:0,browserProof:'별도 Chrome 기록',stages:[]};let child;
async function start(mode,rest='after'){
 child=spawn(process.execPath,['tools/local-recovery-server.mjs',mode,rest,'5A4'],{cwd:repo,stdio:['ignore','pipe','pipe']});
 child.stderr.resume();
 await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('로컬 서버 시작 시간 초과')),15000);child.stdout.on('data',b=>{text+=b;if(text.includes('"ready":true')){clearTimeout(timer);resolve();}});child.once('exit',code=>{clearTimeout(timer);reject(Error('로컬 서버 종료 '+code));});child.once('error',reject);});
}
async function stop(){if(!child||child.exitCode!==null)return;const done=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await done;child=null;}
async function call(action,body={},token){const r=await fetch(base+'/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...body,...(token?{_tk:token}:{})}),signal:AbortSignal.timeout(10000)});return {status:r.status,body:await r.json()};}
async function ok(action,body={},token){const r=await call(action,body,token);assert.equal(r.status,200,action);assert.equal(r.body.error,undefined,action);return r.body;}
async function login(key){const r=await ok('verifyLogin',{memberId:ids[key],name:names[key],dept:key==='edu'?'교육부':'청년회',pin:'582946'});assert.equal(r.ok,true);assert.ok(r.token);return r.token;}
const specs=[['roster','getRoster',{},'owner'],['activities','getMyActivities',{},'owner'],['targets','getMyTargets',{includeHistory:false},'owner'],['journal','getTargetJournal',{targetId:'COMPAT-TARGET'},'owner'],['attendance','getMyAttendance',{},'owner'],['education','getRequiredEducation',{},'owner'],['room','getTargetRoom',{targetId:'COMPAT-TARGET'},'owner'],['access','educationAccess',{},'chair'],['course','cohortDetail',{cohortId:'COMPAT-COURSE'},'chair'],['center','getCenterDesk',{},'chair'],['reports','getDeliveryReview',{source:'reports'},'appOwner'],['webhooks','getDeliveryReview',{source:'webhooks'},'appOwner']];
async function readAll(tokens){const data={};for(const [label,action,body,key]of specs){const result=await ok(action,body,tokens[key]);if(action==='getDeliveryReview'){assert.ok(result.checkedAt);delete result.checkedAt;}data[label]=result;}return data;}
async function safety(tokens){
 assert.equal((await call('getMyAttendance',{memberId:ids.owner})).status,401);
 assert.equal((await call('getMyActivities',{memberId:ids.owner},tokens.edu)).status,403);
 assert.ok((await call('getTargetRoom',{targetId:'COMPAT-TARGET'},tokens.edu)).body.error);
 assert.equal((await call('cohortDetail',{cohortId:'COMPAT-COURSE'},tokens.edu)).status,403);
 for(const who of ['owner','chair','edu'])assert.equal((await call('getDeliveryReview',{source:'reports'},tokens[who])).status,403);
 const request=token=>fetch(base+'/api/room-attachment',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({_tk:token,targetId:'COMPAT-TARGET',id:2,kind:'file'})});
 const r=await request(tokens.owner);assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);const sha256=hash(Buffer.from(await r.arrayBuffer()));assert.equal(sha256,'2ab0389bc1bab448ae809f96ea67659df189bb202574588653cefb11ee7b337a');assert.equal((await request(tokens.edu)).status,403);return sha256;
}
async function repeatWebhook(){
 const results=[];
 for(const [id,chat,done]of [[990801,-990999,false],[990802,-990801,true]]){
  const update={update_id:id,message:{message_id:id,chat:{id:chat,type:'supergroup'},from:{id:990202,first_name:'가짜 복구학생'},text:'방번호'}};
  const r=await fetch(base+'/api/tg',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':hash('local-only-recovery-webhook|att-tg').slice(0,48)},body:JSON.stringify(update)});
  assert.equal(r.status,200);const body=await r.json();assert.deepEqual(body,done?{ok:true,duplicate:true}:{ok:false,duplicate:true,needsReview:true});results.push(body);
 }
 return results;
}
async function routesIn(dir,prefix=''){let routes=[];for(const f of await readdir(dir,{withFileTypes:true})){if(f.name==='api'||f.name==='[legacy]')continue;if(f.isDirectory())routes.push(...await routesIn(path.join(dir,f.name),f.name.startsWith('(')?prefix:prefix+'/'+f.name));else if(f.name==='page.tsx')routes.push(prefix||'/');}return routes;}
async function staticRoutes(){
 const routes=[...await routesIn(fileURLToPath(new URL('../next-app/app',import.meta.url))),...Object.keys(LEGACY_ENTRIES).map(x=>'/'+x)];assert.equal(routes.length,40);
 for(const route of routes){assert.ok(manifest.routes[route],route);const r=await fetch(base+route);assert.equal(r.status,200,route);const bytes=Buffer.from(await r.arrayBuffer());assert.equal(hash(bytes),manifest.publicHashes[manifest.routes[route].slice(1)],route);assert.doesNotMatch(bytes.toString(),/가짜전환교사|9908000000001|compat-fixture|AUTH_SIGNING_KEY/);}
 for(const url of ['/recovery-manifest.json','/package.json','/server/actions/roster.js','/api/index.js','/.env','/.generated-legacy'])assert.equal((await fetch(base+url)).status,404,url);
 const rsc=await fetch(base+'/activities/index.txt');assert.equal(rsc.status,200);assert.match(rsc.headers.get('content-type'),/text\/x-component/);assert.match(rsc.headers.get('cache-control'),/no-store/);
 const sw=await fetch(base+'/service-worker.js');assert.equal(sw.status,200);assert.match(sw.headers.get('cache-control'),/no-store/);
 const asset=Object.keys(manifest.publicHashes).find(p=>p.startsWith('_next/static/')&&p.endsWith('.js'));assert.ok(asset);const r=await fetch(base+'/'+asset);assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/immutable/);assert.equal(hash(Buffer.from(await r.arrayBuffer())),manifest.publicHashes[asset]);
 facts.routes={total:40,legacy:16,contentHashesMatch:true,rsc:true,workerNoStore:true,immutableAsset:true,privateFilesDenied:6};
}
test('64 SQL 최신 DB: 기존 강화 API → Next → 고정 복구본 → Next → 복원 DB의 업무와 수신 상태 보존',async t=>{
 const tokens={};let baseline;
 try{
  for(const [mode,rest]of [['legacy','after'],['next','after'],['recovery','after'],['next','after'],['next','restore'],['recovery','restore']]){
   await t.test(mode+'/'+rest+' #'+(facts.stages.length+1),async()=>{
    await start(mode,rest);
    if(!baseline){for(const key of Object.keys(ids))tokens[key]=await login(key);baseline=await readAll(tokens);
     assert.ok(baseline.activities.rows.some(r=>r.todayWork==='전환 후 보존할 새 활동'));assert.match(JSON.stringify(baseline.room),/복구 화면에서 남긴 두 번째 확인 기록/);
     assert.deepEqual(baseline.course.permissions,['attendance','reports']);assert.equal(baseline.center.policy.mode,'role_scoped');assert.equal(baseline.access.telegramLinked,false);
     const rec=baseline.attendance.records.find(r=>r.meetingId==='RECOVERY-SLOTS');assert.ok(rec);assert.equal(rec.additionalRecords.length,1);assert.match(JSON.stringify(rec),/가짜 오전/);assert.match(JSON.stringify(rec),/가짜 저녁/);
     assert.equal(baseline.reports.total,2);assert.deepEqual(baseline.reports.rows.map(r=>r.status).sort(),['sending','unknown']);assert.equal(baseline.webhooks.total,1);assert.equal(baseline.webhooks.rows[0].status,'unknown');
    }else assert.deepEqual(await readAll(tokens),baseline,'같은 세션과 12종 업무 결과');
    const attachmentHash=await safety(tokens),duplicates=await repeatWebhook();
    if(mode==='recovery'&&rest==='after')await staticRoutes();
    if(mode==='legacy'){const r=await fetch(base+'/app.html');assert.equal(r.status,200);assert.equal(hash(Buffer.from(await r.arrayBuffer())),hash(await readFile(new URL('../app.html',import.meta.url))));}
    if(rest==='restore')for(const key of Object.keys(ids))assert.ok(await login(key));
    const state=await (await fetch(base+'/__local_recovery/status')).json();assert.equal(state.phase,'5A4');assert.deepEqual(state.metrics.blocked,[]);assert.deepEqual(state.metrics.telegramCalls,[]);
    facts.stages.push({mode,rest,reads:specs.length,attachmentHash,duplicates,logins:rest==='restore'?5:undefined,metrics:state.metrics});
   });await stop();
  }
  assert.equal(facts.stages.length,6);facts.apiResults=Object.fromEntries(Object.entries(baseline).map(([key,value])=>[key,hash(JSON.stringify(value))]));facts.ok=true;
 }finally{await stop();await writeFile(new URL('http-validation.json',out),JSON.stringify(facts,null,2)+'\n');}
});
