// 격리 검증 전용. 운영 환경 파일을 읽지 않고 127.0.0.1 고정 포트만 사용한다.
import http from 'node:http';
import {localReportFixture} from './local-report-fixture.mjs';
import {localAiFixture} from './local-ai-fixture.mjs';
import {localRoomUploadResult} from './local-room-storage.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac, createHash } from 'node:crypto';
import {localStorageFixture} from './local-storage-fixture.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = JSON.parse(await fs.readFile(path.join(root,'../.local-auth-20261111/runtime.json'),'utf8'));
for (const key of Object.keys(process.env)) if (/EDU_ATTENDANCE|SUPABASE|TEACHER_EXPORT|TEACHERSQUARE|GEMINI|TELEGRAM|R2_|ATTEND_|BOT_TOKEN|VERCEL|AUTH_SIGNING/.test(key)) delete process.env[key];
// 두 로컬 서버의 번호 가림 결과도 같아야 하므로 가짜 서비스 자격만 고정한다. 사용자 세션 만료는 바꾸지 않는다.
const jwt = role => { const base = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({role,exp:4102444800})).toString('base64url'); return base+'.'+createHmac('sha256',runtime.jwtSecret).update(base).digest('base64url'); };
process.env.SUPABASE_URL='http://127.0.0.1:58433';
process.env.SUPABASE_SERVICE_ROLE_KEY=jwt('service_role');
process.env.AUTH_SIGNING_KEY=runtime.authSigningKey;
process.env.TEACHER_EXPORT_PW='local-only-export-password';
process.env.TEACHERSQUARE_CRON_KEY='local-only-education-webhook-key';
// 선택형 로컬 가짜 이미지 저장소. 실제 R2 자격/주소를 읽거나 호출하지 않는다.
const imageFixtures=process.env.LOCAL_IMAGE_FIXTURES==='1', imageObjects=new Map(), imageReads=[];
if(imageFixtures) Object.assign(process.env,{
  R2_ACCOUNT_ID:'local-image-fixture',R2_BUCKET:'fake-images',R2_ACCESS_KEY_ID:'fake-local-key',R2_SECRET_ACCESS_KEY:'fake-local-secret',
  R2_PRIVATE_BUCKET:'fake-private',R2_PRIVATE_ACCESS_KEY_ID:'fake-private-key',R2_PRIVATE_SECRET_ACCESS_KEY:'fake-private-secret',R2_PUBLIC_BASE:'http://127.0.0.1:58433/__local_images',
});
process.env.EDU_ATTENDANCE_TEST_CHAT='-990019';
if(process.env.LOCAL_REPORT_FIXTURES==='1')process.env.ATT_BOT_TOKEN='local-report-fixture';
const originalFetch=globalThis.fetch;
// 가짜 자료의 요청 수·응답량만 측정한다. 본문·쿼리 값·토큰은 기록하지 않는다.
let metrics={api:{},db:{}};
globalThis.fetch=async(input,init)=>{
  const fakeAi=await localAiFixture(input,init);if(fakeAi)return fakeAi;
  const u = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if(process.env.LOCAL_REPORT_FIXTURES==='1'&&u.origin==='https://api.telegram.org'&&/^\/botlocal-report-fixture\/(getChat|sendMessage|sendPhoto|sendDocument)$/.test(u.pathname))return originalFetch('http://127.0.0.1:58433/__local_report_fixture/tg/'+u.pathname.split('/').at(-1),{...init,redirect:'error'});
  if(imageFixtures && u.hostname==='local-image-fixture.r2.cloudflarestorage.com' && /^\/fake-(images|private)\//.test(u.pathname)) {
    const key=u.pathname.startsWith('/fake-private/')?'private/'+u.pathname.slice('/fake-private/'.length):u.pathname.slice('/fake-images/'.length);
    const method=init?.method||input.method||'GET',headers=new Headers(init?.headers||input.headers);
    const bytes=method==='PUT'?(init?.body?Buffer.from(init.body):input instanceof Request?Buffer.from(await input.arrayBuffer()):Buffer.alloc(0)):null;
    return imageReply(key,method,bytes,headers);
  }
  if (u.hostname!=='127.0.0.1' || !['58432','58433'].includes(u.port)) throw new Error('External network disabled in isolated test server');
  const response=await originalFetch(input,{...init,redirect:'error'});
  if(u.port==='58432') {
    const bytes=await response.clone().arrayBuffer();
    const key=(init?.method||'GET')+' '+u.pathname;
    const stat=metrics.db[key]??={requests:0,rows:0,bytes:0};
    stat.requests++;stat.bytes+=bytes.byteLength;
    try {const data=JSON.parse(Buffer.from(bytes).toString());if(Array.isArray(data))stat.rows+=data.length;}catch{}
  }
  return response;
};
function imageReply(key,method,bytes,headers){
 const item=imageObjects.get(key),etag=v=>'"'+createHash('sha256').update(v.bytes).digest('hex')+'"';
 if(method==='PUT'){
  const source=headers.get('x-amz-copy-source');
  if(source){const original=imageObjects.get('private/'+source.replace(/^\/fake-private\//,''));if(!original||etag(original)!==headers.get('x-amz-copy-source-if-match'))return new Response(null,{status:412});imageObjects.set(key,{bytes:Buffer.from(original.bytes),type:original.type});return new Response('<CopyObjectResult><ETag>'+etag(original)+'</ETag></CopyObjectResult>');}
  imageObjects.set(key,{bytes,type:headers.get('content-type')});return new Response(null,{status:200});
 }
 if(method==='DELETE'){imageObjects.delete(key);return new Response(null,{status:204});}
 if(method==='GET'&&item)imageReads.push({key,bytes:item.bytes.length});
 return new Response(method==='GET'&&item?item.bytes:null,{status:item?200:404,headers:item?{'content-length':String(item.bytes.length),'content-type':item.type||'application/octet-stream',etag:etag(item)}:{}});
}
const reportFixture=process.env.LOCAL_REPORT_FIXTURES==='1'?localReportFixture():null;
const storageFixture=process.env.LOCAL_STORAGE_FIXTURES==='1'?localStorageFixture(jwt('service_role')):null;
const {default:handler}=await import('../api/index.js');
const {default:attachmentHandler}=await import('../api/room-attachment.js');
const {default:telegramHandler}=await import('../api/tg.js');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.jpg':'image/jpeg','.ico':'image/x-icon','.json':'application/json','.woff2':'font/woff2'};
const server=http.createServer(async(req,res)=>{
  try {
    const url = new URL(req.url,'http://127.0.0.1:58433');
    // 별도 Next 프로세스도 같은 가짜 이미지 저장소를 사용한다. 이 검증 서버에서만 제공한다.
    if(imageFixtures && url.pathname.startsWith('/__local_image_fixture/')) {
      res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:58434');
      res.setHeader('Access-Control-Allow-Methods','PUT,HEAD,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers','content-type,content-disposition');
      const key=url.pathname.slice('/__local_image_fixture/'.length);
      if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const response=imageReply(key,req.method,Buffer.concat(chunks),new Headers(req.headers));
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
    }
    if(imageFixtures && url.pathname==='/__local_image_stats') {
      if(req.method==='POST')imageReads.length=0;
      res.setHeader('Content-Type','application/json');
      res.end(JSON.stringify({objects:[...imageObjects].map(([key,v])=>({key,bytes:v.bytes.length,sha256:createHash('sha256').update(v.bytes).digest('hex')})),reads:imageReads}));return;
    }
    if(imageFixtures && url.pathname.startsWith('/__local_images/')) {
      const key=url.pathname.slice('/__local_images/'.length), item=key.startsWith('private/')?null:imageObjects.get(key);
      if(!item){res.writeHead(404);res.end();return;}
      imageReads.push({key,bytes:item.bytes.length});
      res.writeHead(200,{'Content-Type':item.type,'Cache-Control':'no-store','Access-Control-Allow-Origin':'http://127.0.0.1:58434'});res.end(item.bytes);return;
    }
    if(url.pathname==='/__local_metrics') {
      if(req.method==='POST')metrics={api:{},db:{}};
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(metrics));return;
    }
    if (reportFixture && await reportFixture(req,res,url)) return;
    if (storageFixture && await storageFixture(req,res,url)) return;
    if (url.pathname.startsWith('/rest/v1/')) {
      // 같은 로컬 DB만 중계한다. 브라우저 요청에 서비스 키를 덧붙이지 않는다.
      const chunks=[];for await (const c of req) chunks.push(c);
      const headers={...req.headers};delete headers.host;delete headers['content-length'];
      const response=await fetch('http://127.0.0.1:58432/'+url.pathname.slice(9)+url.search,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
      res.writeHead(response.status,Object.fromEntries([...response.headers].filter(([k])=>!['content-encoding','content-length','transfer-encoding'].includes(k))));
      res.end(Buffer.from(await response.arrayBuffer()));return;
    }
    if(url.pathname==='/api/room-attachment'){await attachmentHandler(req,res);return;}
    if (url.pathname==='/api' || url.pathname==='/api/tg') {
      const chunks=[];for await(const c of req)chunks.push(c);
      req.body=Buffer.concat(chunks).toString()||'{}';
      let parsed;try{parsed=JSON.parse(req.body);}catch{}
      const action=url.pathname==='/api/tg'?'telegram':String(parsed?.action||'unknown');
      res.status=n=>{res.statusCode=n;return res;};res.json=data=>{const body=JSON.stringify(imageFixtures?localRoomUploadResult(data):data);const stat=metrics.api[action]??={requests:0,bytes:0};stat.requests++;stat.bytes+=Buffer.byteLength(body);res.setHeader('Content-Type','application/json');res.end(body);return res;};
      await (url.pathname==='/api/tg' ? telegramHandler : handler)(req,res);return;
    }
    if (url.pathname==='/service-worker.js') {res.writeHead(404);res.end();return;}
    const rel=decodeURIComponent(url.pathname==='/'?'/app.html':url.pathname).slice(1);
    if (!/^(app\.html|[^/]+\.(css|png|jpg|jpeg|webp|svg|ico|woff2)|(?:assets|images|fonts|css)\/[^.][^?]*|manifest\.json)$/.test(rel) || rel.split('/').includes('..')) {res.writeHead(404);res.end();return;}
    const file=path.resolve(root,rel);if (!file.startsWith(root)) {res.writeHead(404);res.end();return;}
    const bytes=await fs.readFile(file);
    res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self'; frame-src 'none'; worker-src 'none'; form-action 'self'; base-uri 'self'");
    res.end(bytes);
  } catch(e) {res.statusCode=500;res.end('Local verification request failed');console.error(e.message);}
});
server.listen(58433,'127.0.0.1',()=>console.log('Isolated authentication app: http://127.0.0.1:58433/app.html'));
