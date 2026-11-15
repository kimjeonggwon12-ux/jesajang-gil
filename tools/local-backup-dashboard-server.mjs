// 새 로컬 빌드 + 실제 API/인증 + 합성 DB/파일. 운영 DB/외부 서비스에는 접속하지 않는다.
import http from 'node:http';
import {mock} from 'node:test';
import {scryptSync} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {readFileSync,unlinkSync} from 'node:fs';
import path from 'node:path';
import * as fake from '../tests/helpers/fake-db.mjs';
import {fileStorage} from '../tests/helpers/backup-file-storage.mjs';
const repo=path.resolve(import.meta.dirname,'..'),source=path.resolve(repo,'../.local-backup-dashboard-20261115/source/next-app');
for(const k of Object.keys(process.env))if(/SUPABASE|AUTH_SIGNING|TEACHER|TELEGRAM|R2_|BOT_TOKEN|ATTEND_|GEMINI|NEXT_PUBLIC|VERCEL/.test(k))delete process.env[k];
Object.assign(process.env,{NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',PILOT_ROUTING_ENABLED:'1',AUTH_SIGNING_KEY:'local-backup-dashboard-auth-key-at-least-32',SUPABASE_SERVICE_ROLE_KEY:'local-only-fake',TEACHERSQUARE_SYSTEM_OWNER_ID:'9900000000001',TEACHERSQUARE_CRON_KEY:'local-only-cron'});
const nativeFetch=globalThis.fetch;
globalThis.fetch=(input,init)=>{const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(u.hostname!=='127.0.0.1'||u.port!=='58613')throw Error('External network disabled');return nativeFetch(input,{...init,redirect:'error'});};
let storage,actorValid=true;
mock.module('../server/lib/db.js',{exports:{db:()=>({...fake.db(),storage:storage.client.storage,rpc(name,args){
  if(name==='sensitive_actor_valid')return Promise.resolve({data:actorValid});
  return fake.db().rpc(name,args);
}}),run:fake.run,selectAll:fake.selectAll,isDuplicate:fake.isDuplicate}});
const {default:handler}=await import('../api/index.js');
const {webHandler}=await import('../server/lib/web-handler.js');
const {tokenFor,pinVersion}=await import('../server/lib/auth.js');
const {forgetRoster}=await import('../server/actions/roster.js');
const {saveVerifiedBackup}=await import('../server/lib/backup-storage.js');
const people=['9900000000001','9900000000002','9900000000003','7777'].map((nid,i)=>({nid,member_id:nid,name:'가짜확인'+i,dept:i===2?'교육부':'청년회',position:'',region:'1지역',tier:'활동교사',note:'',affiliation:''}));
const pin={pin_hash:scryptSync('582946','local-test-salt',32).toString('hex'),salt:'local-test-salt',ver:'seed',fails:0,locked_until:''};
fake.reset({teachers:people,admins:[{...people[2],id:1}],member_pins:people.map(p=>({...pin,nid:p.nid}))});forgetRoster();
const build=async()=>{const takenAt='2026-11-15 00:00:00',counts={teachers:1},data={teachers:[{id:'synthetic'}]};return{takenAt,counts,bytes:gzipSync(JSON.stringify({takenAt,counts,data}))};};
const fixtures={};
for(const state of ['healthy','failed','missing','stale','offline','interrupted']){
  const f=fileStorage();fixtures[state]=f;
  if(state==='missing'){f.state.exists=false;continue;}
  await saveVerifiedBackup(f.client,build,undefined,()=>new Date(Date.now()-(state==='stale'?9*86400000:3600000)));
  if(['failed','interrupted'].includes(state)){
    try{await saveVerifiedBackup(f.client,async()=>{throw Error('local fixture');},undefined,()=>new Date(Date.now()-20*60000));}catch{}
    if(state==='interrupted'){
      const failed=f.state.calls.filter(c=>c.method==='POST'&&c.path.endsWith('.failed.json')).at(-1).path.split('/backups/')[1];unlinkSync(f.file(failed));
    }
  }
  if(state==='offline')f.state.fault='offline';
  f.state.calls=[];f.state.receivedBytes=0;
}
storage=fixtures.healthy;
const next=(await import('../next-app/node_modules/next/dist/server/next.js')).default;
const app=next({dev:false,dir:source,hostname:'127.0.0.1',port:58613});await app.prepare();const handle=app.getRequestHandler();
const counts={};
const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://127.0.0.1:58613');
  const json=value=>{res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(value));};
  try{
    if(u.pathname==='/__local/session'){
      const person=people[Number(u.searchParams.get('person'))];if(!person)throw Error('local persona');
      return json({account:{memberId:person.member_id,name:person.name,dept:person.dept},token:tokenFor(person.nid,'m',{pinVersion:pinVersion({...pin,nid:person.nid})})});
    }
    if(u.pathname==='/__local/state'){
      const state=u.searchParams.get('value');if(!Object.hasOwn(fixtures,state))throw Error('local state');
      storage=fixtures[state];actorValid=u.searchParams.get('expired')!=='1';storage.state.calls=[];storage.state.receivedBytes=0;for(const k of Object.keys(counts))delete counts[k];return json({ok:true});
    }
    if(u.pathname==='/__local/metrics')return json({counts,storageCalls:storage.state.calls,storageBytes:storage.state.receivedBytes,blocked:storage.state.blocked});
    if(u.pathname==='/api'){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks).toString();
      const action=JSON.parse(body||'{}').action;counts[action]=(counts[action]||0)+1;
      const r=await webHandler(handler)(new Request(u,{method:req.method,headers:req.headers,...(body?{body}:{})}));res.statusCode=r.status;
      for(const [k,v]of r.headers)res.setHeader(k,v);return res.end(Buffer.from(await r.arrayBuffer()));
    }
    return handle(req,res);
  }catch{res.statusCode=500;json({error:'local verification request failed'});}
});
server.listen(58613,'127.0.0.1',()=>console.log(JSON.stringify({ready:true,port:58613,buildId:readFileSync(path.join(source,'.next/BUILD_ID'),'utf8').trim(),productionConnected:false})));
async function stop(){server.close();await app.close();process.exit(0);}process.once('SIGTERM',stop);process.once('SIGINT',stop);
