// 격리된 Next 빌드만 실제 HTTP로 검사한다. 운영 주소/비밀값/DB를 받지 않는다.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { probeBackup } from './backup-watch.mjs';
const root = fileURLToPath(new URL('../', import.meta.url)), out = path.join(root,'artifacts/backup-watch-auth-20261115');
assert.equal(process.argv.length,2); assert.ok(!existsSync(path.join(out,'next-http.json')));
const cwd = path.resolve(root,'../.local-backup-watch-auth-20261115/candidate/next-app');
const env = Object.fromEntries(Object.entries(process.env).filter(([k])=>!/SUPABASE|AUTH_SIGNING|TEACHER|TELEGRAM|BOT_TOKEN|R2_|ATTEND_|GEMINI|VERCEL|NEXT_PUBLIC|BACKUP_WATCH/.test(k)));
Object.assign(env,{NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1'});
const child = spawn(process.execPath,['--import',path.join(root,'tools/local-backup-watch-preload.mjs'),path.join(root,'next-app/node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port','58615'],{cwd,env,stdio:['ignore','pipe','pipe']});
let log=''; child.stdout.on('data',c=>log+=c); child.stderr.on('data',c=>log+=c);
const url='http://127.0.0.1:58615', key='tsbw_'+'a'.repeat(64), rows=[];
try {
  let ready=false; for(let i=0;i<60;i++){ if(child.exitCode!==null)throw Error('Local server stopped'); try{if((await fetch(url+'/api')).ok){ready=true;break;}}catch{} await new Promise(r=>setTimeout(r,200));} assert.ok(ready);
  const cases=[['GET','',401],['GET','Bearer wrong',401],['GET','Bearer fixture-cron-only',401],['POST','Bearer '+key,405],['GET','Bearer '+key,200]];
  for(const [method,authorization,status] of cases){const r=await fetch(url+'/api/backup-health',{method,headers:{authorization}});assert.equal(r.status,status);assert.equal(r.headers.get('cache-control'),'no-store');const body=await r.json();if(status===200){assert.equal(body.health.state,'healthy');assert.equal(body.verification,'sha256');assert.ok(!JSON.stringify(body).includes('rows'));}rows.push({method,case:rows.length+1,status:r.status});}
  const denied=await fetch(url+'/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'backupNow',key})});assert.equal(denied.status,401);rows.push({action:'backupNow',status:denied.status});
  const outcome=await probeBackup({key,fetchImpl:(target,options)=>{assert.equal(target,'https://jesajang-gil.vercel.app/api/backup-health');return fetch(url+'/api/backup-health',options);}});assert.equal(outcome.code,'healthy');rows.push({monitor:outcome.code});
}finally{if(child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}writeFileSync(path.join(out,'next-server.log'),log);}
const storage=JSON.parse(readFileSync(path.join(out,'next-storage.json')));assert.equal(storage.external,0);assert.equal(storage.fileHashesUnchanged,true);assert.equal(storage.readOnlyCalls,true);assert.equal(storage.archiveReads,2);
writeFileSync(path.join(out,'next-http.json'),JSON.stringify({buildId:readFileSync(path.join(cwd,'.next/BUILD_ID'),'utf8').trim(),rows,storage,productionConfigured:false,serverStopped:true},null,2));console.log(JSON.stringify({passed:rows.length,storage,serverStopped:true}));
