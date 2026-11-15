// 현재 UI 수정의 배포용 빌드를 실행한다. 기존 합성 DB 재사용, 시드/초기화/운영 접속 없음.
// A/B는 이 한 서버와 한 DB를 공유한다. 운영 자격을 읽지 않고 외부 발송을 차단한다.
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {verifyPilotBuild} from './build-release-next.mjs';
const root=fileURLToPath(new URL('../.local-ab-non-r2-20261115/build-source/',import.meta.url));
// 정적 HTML에도 분기 브리지가 포함되어야 로그인 직후 A/B가 맞는다.
verifyPilotBuild(root+'next-app');
const runtime=JSON.parse(readFileSync(new URL('../../.local-auth-20261111/runtime.json',import.meta.url),'utf8'));
for(const key of Object.keys(process.env))if(/SUPABASE|TEACHERSQUARE|TEACHER_EXPORT|GEMINI|TELEGRAM|R2_|BOT_TOKEN|ATT_|VERCEL|AUTH_SIGNING|PILOT_|LOCAL_.*FIXTURE|NEXT_PUBLIC_/.test(key))delete process.env[key];
const value=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({role:'service_role',exp:4102444800})).toString('base64url');
Object.assign(process.env,{NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',SUPABASE_URL:'http://127.0.0.1:58443',SUPABASE_SERVICE_ROLE_KEY:value+'.'+createHmac('sha256',runtime.jwtSecret).update(value).digest('base64url'),AUTH_SIGNING_KEY:runtime.authSigningKey,PILOT_ROUTING_ENABLED:'1',TEACHERSQUARE_SYSTEM_OWNER_ID:'9900000000990',TEACHER_EXPORT_PW:'local-only-export-password'});
const originalFetch=globalThis.fetch;
globalThis.fetch=(input,init)=>{const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(url.hostname!=='127.0.0.1'||!['58443','58577'].includes(url.port))throw Error('External traffic disabled for pilot verification');return originalFetch(input,{...init,redirect:'error'});};
process.chdir(root+'next-app');
const next=(await import('../next-app/node_modules/next/dist/server/next.js')).default;
const app=next({dev:false,dir:root+'next-app',hostname:'127.0.0.1',port:58577});await app.prepare();const handle=app.getRequestHandler();
const server=http.createServer((req,res)=>handle(req,res));server.listen(58577,'127.0.0.1',()=>console.log('Pilot verification ready at http://127.0.0.1:58577 (one local DB, external writes disabled)'));
async function stop(){server.close();await app.close();process.exit(0);}process.once('SIGTERM',stop);process.once('SIGINT',stop);
