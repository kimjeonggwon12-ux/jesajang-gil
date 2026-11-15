// 4B 가짜 자료/파일만 연결한다. 운영 주소·키를 인자로 받을 수 없다.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHmac,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
export function installRecoveryEnvironment(restPort=58436,phase='4B2'){
 assert.ok(['4B2','5A4'].includes(phase));
 assert.ok([58436,58438].includes(restPort));
 const runtime=JSON.parse(readFileSync(new URL('../../.local-auth-20261111/runtime.json',import.meta.url),'utf8'));
 for(const key of Object.keys(process.env))if(/SUPABASE|AUTH_SIGNING|TEACHER|TELEGRAM|BOT_TOKEN|R2_|ATTEND_|GEMINI|LEGACY_URL|VERCEL|NEXT_PUBLIC/.test(key))delete process.env[key];
 const body=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({role:'service_role',exp:4102444800})).toString('base64url');
 Object.assign(process.env,{NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',SUPABASE_URL:'http://127.0.0.1:58436',SUPABASE_SERVICE_ROLE_KEY:body+'.'+createHmac('sha256',runtime.jwtSecret).update(body).digest('base64url'),AUTH_SIGNING_KEY:runtime.authSigningKey,TEACHER_EXPORT_PW:'local-only-export-password',R2_ACCOUNT_ID:'compat-fixture',R2_BUCKET:'compat-public',R2_PRIVATE_BUCKET:'compat-private',R2_PRIVATE_ACCESS_KEY_ID:'fake-private-key',R2_PRIVATE_SECRET_ACCESS_KEY:'fake-private-secret',R2_ACCESS_KEY_ID:'local-fake-key',R2_SECRET_ACCESS_KEY:'local-fake-secret',R2_PUBLIC_BASE:'https://compat-public.invalid'});
 const original=globalThis.fetch,metrics={dbRequests:0,fileRequests:0,telegramCalls:[],blocked:[]};
 if(phase==='5A4')Object.assign(process.env,{ATT_BOT_TOKEN:'990123:recovery-fixture',TEACHERSQUARE_CRON_KEY:'local-only-recovery-webhook'});
 const storage=new URL(phase==='5A4'?'../../.local-current-recovery-20261114/private-storage/':'../../.local-compat-20261114/private-storage/',import.meta.url);mkdirSync(storage,{recursive:true,mode:0o700});
 globalThis.fetch=async(input,init)=>{
  const u=new URL(typeof input==='string'||input instanceof URL?input:input.url),method=init?.method||(input instanceof Request?input.method:'GET');
  if(phase==='5A4'&&u.origin==='https://api.telegram.org'&&u.pathname==='/bot990123:recovery-fixture/sendMessage'){
   const body=JSON.parse(init?.body||'{}');assert.match(String(body.chat_id),/^-?990\d+$/);metrics.telegramCalls.push({method:'sendMessage',chat:String(body.chat_id)});
   return Response.json(body.chat_id===-990999?{ok:false,description:'가짜 수신 거절'}:{ok:true,result:{message_id:metrics.telegramCalls.length}},{status:body.chat_id===-990999?400:200});
  }
  if(u.hostname==='127.0.0.1'&&u.port==='58436'&&u.pathname.startsWith('/rest/v1/')){metrics.dbRequests++;return original('http://127.0.0.1:'+restPort+u.pathname.slice(8)+u.search,{...init,redirect:'error'});}
  if(u.hostname==='compat-fixture.r2.cloudflarestorage.com'&&u.pathname.startsWith('/compat-private/')&&['GET','HEAD','PUT'].includes(method)){
   metrics.fileRequests++;const key=createHash('sha256').update(u.pathname).digest('hex'),dataPath=new URL(key+'.bytes',storage),metaPath=new URL(key+'.json',storage);
   if(method==='PUT'){const bytes=Buffer.from(init?.body||(input instanceof Request?await input.arrayBuffer():[])),type=new Headers(init?.headers||(input instanceof Request?input.headers:undefined)).get('content-type');writeFileSync(dataPath,bytes,{mode:0o600});writeFileSync(metaPath,JSON.stringify({type}),{mode:0o600});return new Response(null,{status:200});}
   const file=existsSync(dataPath)&&existsSync(metaPath)?{bytes:readFileSync(dataPath),...JSON.parse(readFileSync(metaPath,'utf8'))}:null;
   return new Response(method==='GET'&&file?file.bytes:null,{status:file?200:404,headers:file?{'content-type':file.type||'application/octet-stream','content-length':String(file.bytes.length)}:{}});
  }
  metrics.blocked.push({host:u.hostname,method});throw Error('External network disabled in recovery rehearsal');
 };
 return metrics;
}
