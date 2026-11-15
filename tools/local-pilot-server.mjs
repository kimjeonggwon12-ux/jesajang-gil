// A/B는 이 한 서버와 한 DB를 공유한다. 운영 자격을 읽지 않고 외부 발송을 차단한다.
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../.local-pilot-20261114/',import.meta.url));
// 정적 HTML에도 분기 브리지가 포함되어야 로그인 직후 A/B가 맞는다.
if(!readFileSync(root+'source/next-app/.next/server/app/index.html','utf8').includes('/pilot-bridge.js'))throw Error('A/B 시험 빌드는 PILOT_ROUTING_ENABLED=1로 만들어야 합니다.');
const runtime=JSON.parse(readFileSync(new URL('../../.local-auth-20261111/runtime.json',import.meta.url),'utf8'));
for(const key of Object.keys(process.env))if(/SUPABASE|TEACHERSQUARE|TEACHER_EXPORT|GEMINI|TELEGRAM|R2_|BOT_TOKEN|ATT_|VERCEL|AUTH_SIGNING|PILOT_|LOCAL_.*FIXTURE|NEXT_PUBLIC_/.test(key))delete process.env[key];
const value=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({role:'service_role',exp:4102444800})).toString('base64url');
Object.assign(process.env,{NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',SUPABASE_URL:'http://127.0.0.1:58443',SUPABASE_SERVICE_ROLE_KEY:value+'.'+createHmac('sha256',runtime.jwtSecret).update(value).digest('base64url'),AUTH_SIGNING_KEY:runtime.authSigningKey,PILOT_ROUTING_ENABLED:'1',TEACHERSQUARE_SYSTEM_OWNER_ID:'9900000000990',TEACHER_EXPORT_PW:'local-only-export-password'});
const originalFetch=globalThis.fetch;
globalThis.fetch=(input,init)=>{const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(url.hostname!=='127.0.0.1'||!['58442','58443','58444'].includes(url.port))throw Error('External traffic disabled for pilot verification');return originalFetch(input,{...init,redirect:'error'});};
const dbProxy=http.createServer(async(req,res)=>{try{if(!req.url.startsWith('/rest/v1/')){res.writeHead(404);res.end();return;}let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>16*1024*1024)throw Error('body');chunks.push(c);}const r=await originalFetch('http://127.0.0.1:58442'+req.url.slice(8),{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));}catch{res.writeHead(503);res.end();}});
await new Promise(resolve=>dbProxy.listen(58443,'127.0.0.1',resolve));
process.chdir(root+'source/next-app');
const next=(await import('../next-app/node_modules/next/dist/server/next.js')).default;
const app=next({dev:false,dir:root+'source/next-app',hostname:'127.0.0.1',port:58444});await app.prepare();const handle=app.getRequestHandler();
const server=http.createServer((req,res)=>handle(req,res));server.listen(58444,'127.0.0.1',()=>console.log('Pilot verification ready at http://127.0.0.1:58444 (one local DB, external writes disabled)'));
async function stop(){server.close();dbProxy.close();await app.close();process.exit(0);}process.once('SIGTERM',stop);process.once('SIGINT',stop);
