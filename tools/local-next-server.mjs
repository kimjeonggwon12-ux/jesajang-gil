// 가짜 DB·고정 로컬 포트 전용. 운영 환경 파일을 읽거나 외부 AI/Telegram/R2에 전송하지 않는다.
import http from 'node:http';
import {localAiFixture} from './local-ai-fixture.mjs';
import {installLocalRoomResponse} from './local-room-storage.mjs';
import {readFile} from 'node:fs/promises';
import {createHmac} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {prepareLegacy} from './prepare-next-legacy.mjs';
const mode=process.argv[2]||'start';
if(!['dev','start'].includes(mode))throw Error('dev 또는 start만 사용할 수 있습니다.');
const runtime=JSON.parse(await readFile(new URL('../../.local-auth-20261111/runtime.json',import.meta.url),'utf8'));
for(const key of Object.keys(process.env))if(/EDU_ATTENDANCE|SUPABASE|TEACHER_EXPORT|TEACHERSQUARE|GEMINI|TELEGRAM|R2_|ATTEND_|BOT_TOKEN|VERCEL|AUTH_SIGNING|NEXT_PUBLIC_/.test(key))delete process.env[key];
const data=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({role:'service_role',exp:4102444800})).toString('base64url');
Object.assign(process.env,{
 NODE_ENV:mode==='dev'?'development':'production',NEXT_TELEMETRY_DISABLED:'1',
 SUPABASE_URL:'http://127.0.0.1:58433',SUPABASE_SERVICE_ROLE_KEY:data+'.'+createHmac('sha256',runtime.jwtSecret).update(data).digest('base64url'),
 TEACHER_EXPORT_PW:'local-only-export-password',AUTH_SIGNING_KEY:runtime.authSigningKey,TEACHERSQUARE_CRON_KEY:'local-only-education-webhook-key',
 R2_ACCOUNT_ID:'local-image-fixture',R2_BUCKET:'fake-images',R2_ACCESS_KEY_ID:'fake-local-key',R2_SECRET_ACCESS_KEY:'fake-local-secret',
 R2_PRIVATE_BUCKET:'fake-private',R2_PRIVATE_ACCESS_KEY_ID:'fake-private-key',R2_PRIVATE_SECRET_ACCESS_KEY:'fake-private-secret',R2_PUBLIC_BASE:'http://127.0.0.1:58433/__local_images',
});
installLocalRoomResponse();
process.env.EDU_ATTENDANCE_TEST_CHAT='-990019';
if(process.env.LOCAL_REPORT_FIXTURES==='1')process.env.ATT_BOT_TOKEN='local-report-fixture';
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
  const fakeAi=await localAiFixture(input,init);if(fakeAi)return fakeAi;
 const url=new URL(typeof input==='string'||input instanceof URL?input:input.url),method=init?.method||(input instanceof Request?input.method:'GET');
 if(process.env.LOCAL_REPORT_FIXTURES==='1'&&url.origin==='https://api.telegram.org'&&/^\/botlocal-report-fixture\/(getChat|sendMessage|sendPhoto|sendDocument)$/.test(url.pathname))return originalFetch('http://127.0.0.1:58433/__local_report_fixture/tg/'+url.pathname.split('/').at(-1),{...init,redirect:'error'});
 if(url.hostname==='local-image-fixture.r2.cloudflarestorage.com'&&/^\/fake-(images|private)\//.test(url.pathname)&&['PUT','HEAD','DELETE','GET'].includes(method)){
  const body=method==='PUT'?(init?.body||(input instanceof Request?Buffer.from(await input.arrayBuffer()):null)):undefined;
  return originalFetch('http://127.0.0.1:58433/__local_image_fixture/'+(url.pathname.startsWith('/fake-private/')?'private/'+url.pathname.slice('/fake-private/'.length):url.pathname.slice('/fake-images/'.length)),{method,headers:Object.fromEntries([...new Headers(init?.headers||(input instanceof Request?input.headers:undefined))].filter(([k])=>['content-type','x-amz-copy-source','x-amz-copy-source-if-match'].includes(k))),body,redirect:'error'});
 }
 if(url.hostname!=='127.0.0.1'||!['58432','58433','58434'].includes(url.port))throw Error('External network disabled in local Next verification');
 return originalFetch(input,{...init,redirect:'error'});
};
await prepareLegacy();
const next=(await import('../next-app/node_modules/next/dist/server/next.js')).default;
const app=next({dev:mode==='dev',dir:fileURLToPath(new URL('../next-app/',import.meta.url)),hostname:'127.0.0.1',port:58434});
await app.prepare();
const handle=app.getRequestHandler();
const server=http.createServer((req,res)=>{
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' http://127.0.0.1:58433 data: blob:; connect-src 'self' http://127.0.0.1:58433 ws://127.0.0.1:58434; frame-src 'none'; worker-src 'self'; form-action 'self'; base-uri 'self'");
 return handle(req,res);
});
server.listen(58434,'127.0.0.1',()=>console.log('Isolated Next.js app: http://127.0.0.1:58434'));
async function stop(){server.close();await app.close();process.exit(0);}
process.once('SIGTERM',stop);process.once('SIGINT',stop);
