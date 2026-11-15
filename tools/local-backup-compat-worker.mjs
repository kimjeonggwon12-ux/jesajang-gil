// 고정 로컬 검증 전용. 실제 Storage/Telegram/운영 DB로 나가는 요청은 거절한다.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {pathToFileURL,fileURLToPath} from 'node:url';
import path from 'node:path';
const workspace=fileURLToPath(new URL('../../',import.meta.url));
const root=path.join(workspace,'.local-backup-compat-20261115');
const cases={
 'old-original':{port:58451,module:path.join(root,'legacy/server/actions/backup-before-fix.js'),error:true},
 'new-original':{port:58452,module:path.join(root,'candidate-before.mjs'),error:true},
 'legacy-old':{port:58451,module:path.join(root,'legacy/server/actions/backup.js')},
 'legacy-new':{port:58452,module:path.join(root,'legacy/server/actions/backup.js')},
 'candidate-new':{port:58452,module:fileURLToPath(new URL('../server/actions/backup.js',import.meta.url))},
};
const label=process.argv[2],spec=cases[label];assert.ok(spec&&process.argv.length===3);
for(const key of Object.keys(process.env))if(/SUPABASE|AUTH_SIGNING|TEACHER|TELEGRAM|BOT_TOKEN|R2_|ATTEND_|GEMINI|LEGACY_URL|VERCEL|NEXT_PUBLIC/.test(key))delete process.env[key];
const local=JSON.parse(readFileSync(path.join(workspace,'.local-auth-20261111/runtime.json'),'utf8'));
const payload=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({role:'service_role',exp:4102444800})).toString('base64url');
Object.assign(process.env,{SUPABASE_URL:`http://127.0.0.1:${spec.port}`,SUPABASE_SERVICE_ROLE_KEY:payload+'.'+createHmac('sha256',local.jwtSecret).update(payload).digest('base64url'),TEACHERSQUARE_CRON_KEY:'local-backup-compat-only'});
const metrics={dbReads:0,uploads:0,removes:0,blocked:[],orders:{},pages:{}};
const oldFiles=Array.from({length:8},(_,i)=>({name:`backup-20260101-00000${i}.json.gz`}));
let uploaded,failTable;
const nativeFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
 const req=new Request(input,init),u=new URL(req.url),method=req.method;
 if(u.origin!==process.env.SUPABASE_URL){metrics.blocked.push('external');throw Error('External network disabled');}
 if(u.pathname.startsWith('/rest/v1/')){
  const table=u.pathname.slice('/rest/v1/'.length);
  assert.ok(method==='GET'||(method==='POST'&&table==='rpc/backup_tables'),'업무 DB 쓰기 금지');
  metrics.dbReads++;
  if(table===failTable)return Response.json({code:'XX000',message:'local injected backup read failure'},{status:500});
  if(method==='GET'){metrics.orders[table]=u.searchParams.get('order');metrics.pages[table]=(metrics.pages[table]||0)+1;}
  const headers=new Headers(req.headers);
  return nativeFetch(`http://127.0.0.1:${spec.port}`+u.pathname.slice(8)+u.search,{method,headers,...(method==='POST'?{body:await req.text()}:{}),redirect:'error'});
 }
 // 저장소 호출은 네트워크로 보내지 않고 이 프로세스의 가짜 보관함에서만 처리한다.
 if(method==='GET'&&u.pathname==='/storage/v1/bucket/backups')return Response.json({id:'backups',name:'backups',public:false});
 if(method==='POST'&&u.pathname.startsWith('/storage/v1/object/backups/')){
  metrics.uploads++;uploaded={name:decodeURIComponent(u.pathname.split('/').at(-1)),bytes:Buffer.from(await req.arrayBuffer())};return Response.json({Key:'backups/'+uploaded.name});
 }
 if(method==='POST'&&u.pathname==='/storage/v1/object/list/backups')return Response.json([{name:uploaded.name},...oldFiles.slice().reverse()]);
 if(method==='DELETE'&&u.pathname==='/storage/v1/object/backups'){
  const body=await req.json();assert.deepEqual(body.prefixes,[oldFiles[0].name]);metrics.removes++;return Response.json([]);
 }
 metrics.blocked.push('unsupported');throw Error('Unexpected local backup endpoint');
};
const actions=(await import(pathToFileURL(spec.module))).default;
assert.deepEqual(await actions.backupNow({key:'wrong-key'}),{error:'key'});assert.equal(metrics.dbReads,0);
const out=path.join(workspace,'artifacts/backup-compat-20261115');
if(spec.error){
 await assert.rejects(()=>actions.backupNow({key:process.env.TEACHERSQUARE_CRON_KEY}),/column .*id.*does not exist/);
 assert.equal(metrics.uploads,0);assert.equal(metrics.removes,0);
 writeFileSync(path.join(out,label+'.json'),JSON.stringify({label,missingOrderColumnReproduced:true,noUploadOrRetentionDeletion:true,externalCalls:metrics.blocked.length},null,2)+'\n');
}else{
 const result=await actions.backupNow({key:process.env.TEACHERSQUARE_CRON_KEY});assert.equal(result.ok,true);
 assert.equal(metrics.uploads,1);assert.equal(metrics.removes,1);
 const snapshot=JSON.parse(gunzipSync(uploaded.bytes));assert.deepEqual(Object.keys(snapshot).sort(),['counts','data','takenAt']);
 assert.equal(result.tables,Object.keys(snapshot.data).length);
 for(const [table,rows]of Object.entries(snapshot.data))assert.equal(rows.length,snapshot.counts[table]);
 writeFileSync(path.join(root,label+'.json.gz'),uploaded.bytes,{mode:0o600});
 const successfulMetrics=structuredClone(metrics);
 failTable=label==='legacy-old'?'member_pins':'site_pilot_members';
 await assert.rejects(()=>actions.backupNow({key:process.env.TEACHERSQUARE_CRON_KEY}),/local injected backup read failure/);
 assert.equal(metrics.uploads,1,'읽기 실패를 부분 백업 업로드로 처리하지 않음');assert.equal(metrics.removes,1,'실패 뒤 과거 백업 삭제 금지');assert.deepEqual(metrics.blocked,[]);
 writeFileSync(path.join(out,label+'.json'),JSON.stringify({label,tables:result.tables,rows:result.rows,formatUnchanged:true,wrongCronKeyRejected:true,failedReadPreservesPriorBackups:true,simulatedStorageOnly:true,metrics:successfulMetrics},null,2)+'\n');
}
console.log(JSON.stringify({label,ok:true,externalCalls:0}));
