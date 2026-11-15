// 같은 localhost 주소에서 Next 실행 서버 또는 고정 정적 패키지를 검증한다.
// 전환 때 DB/서명 키/가짜 파일을 보존한다. 운영 배포·예약·외부 발송 기능 없음.
import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {installRecoveryEnvironment} from './local-recovery-environment.mjs';
const mode=process.argv[2],rest=process.argv[3]||'after',phase=process.argv[4]||'4B2';
assert.ok(['next','recovery','legacy'].includes(mode));assert.ok(['after','restore'].includes(rest));assert.ok(['4B2','5A4'].includes(phase));
assert.ok(mode!=='legacy'||phase==='5A4');
const metrics=installRecoveryEnvironment(rest==='after'?58436:58438,phase);
// 최신 포인터가 다음 작업에서 바뀌어도 5A4의 증거는 검증한 패키지에 묶는다.
const pointer=phase==='5A4'?'../../artifacts/recovery-current-20261114/package.json':'../../artifacts/recovery-package-20261114/latest.json';
const latest=JSON.parse(await readFile(new URL(pointer,import.meta.url),'utf8'));
const root=path.resolve(latest.package),allowedRoot=fileURLToPath(new URL('../../.local-recovery-20261114/',import.meta.url));
assert.ok(root.startsWith(allowedRoot)&&root.endsWith('/package'));
const manifest=JSON.parse(await readFile(path.join(root,'recovery-manifest.json'),'utf8'));
const hash=x=>createHash('sha256').update(x).digest('hex');
for(const [file,digest] of Object.entries(manifest.apiSourceHashes))assert.equal(hash(await readFile(path.join(root,file))),digest,'고정 API 변경: '+file);
for(const [file,digest] of Object.entries(manifest.publicHashes))assert.equal(hash(await readFile(path.join(root,'public',file))),digest,'고정 화면 변경: '+file);
let handle,app;
const apiRoot=mode==='legacy'?fileURLToPath(new URL('../',import.meta.url)):root;
const {webHandler:wrap}=await import(pathToFileURL(path.join(apiRoot,'server/lib/web-handler.js')));
const webhook=phase==='5A4'?wrap((await import(pathToFileURL(path.join(apiRoot,'api/tg.js')))).default):null;
if(mode==='next'){
 const next=(await import('../next-app/node_modules/next/dist/server/next.js')).default;
 app=next({dev:false,dir:fileURLToPath(new URL('../next-app/',import.meta.url)),hostname:'127.0.0.1',port:58437});await app.prepare();handle=app.getRequestHandler();
}else{
 const {default:handler}=await import(pathToFileURL(path.join(apiRoot,'api/index.js')));
 const {webHandler}=await import(pathToFileURL(path.join(apiRoot,'server/lib/web-handler.js')));
 const {roomDownload}=await import(pathToFileURL(path.join(apiRoot,'server/lib/room-download.js')));
 const api=webHandler(handler),types={'.html':'text/html; charset=utf-8','.txt':'text/x-component; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2'};
 handle=async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1:58437');
  if(['/api','/api/','/api/room-attachment'].includes(url.pathname)){
   let length=0;const chunks=[];for await(const chunk of req){length+=chunk.length;if(length>16*1024*1024){res.writeHead(413);res.end();return;}chunks.push(chunk);}
   const response=await (url.pathname==='/api/room-attachment'?roomDownload:api)(new Request(url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})}));
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
  }
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
  let pathname;try{pathname=decodeURIComponent(url.pathname);}catch{res.writeHead(400);res.end();return;}
  if(pathname.split('/').some(s=>s.startsWith('.'))||pathname.includes('\\')){res.writeHead(404);res.end();return;}
  if(mode==='legacy'){
   const file=pathname==='/'?'home.html':pathname.slice(1);
   if(!/^(?:[\w-]+\.html|(?:vendor|assets)\/[\w./-]+)$/.test(file)||file.split('/').includes('..')){res.writeHead(404);res.end();return;}
   try{const bytes=await readFile(path.join(apiRoot,file));res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});res.end(req.method==='HEAD'?undefined:bytes);}catch{res.writeHead(404);res.end();}return;
  }
  const key=pathname==='/'?'/':pathname.replace(/\/$/,''),file=manifest.routes[key]||pathname;
  let local=path.join(root,'public',file),status=200;
  if(!local.startsWith(root+'/public/')){res.writeHead(404);res.end();return;}
  try{if(!(await stat(local)).isFile())throw Error('not file');}catch{local=path.join(root,'public/404.html');status=404;}
  res.writeHead(status,{'Content-Type':types[path.extname(local)]||'application/octet-stream','Cache-Control':file.startsWith('/_next/static/')?'public, max-age=31536000, immutable':'no-store'});res.end(req.method==='HEAD'?undefined:await readFile(local));
 };
}
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Cache-Control','no-store');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self'; frame-src 'none'; worker-src 'self'; form-action 'self'; base-uri 'self'");
 if(req.url==='/service-worker.js'){res.setHeader('Service-Worker-Allowed','/');}
 if(req.url==='/__local_recovery/status'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({mode,rest,phase,buildId:manifest.buildId,metrics}));return;}
 if(req.url?.startsWith('/api/tg')){
  if(!webhook){res.writeHead(503);res.end('Local rehearsal: external delivery disabled');return;}
  try{let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>1024*1024){res.writeHead(413);res.end();return;}chunks.push(chunk);}const r=await webhook(new Request('http://127.0.0.1:58437/api/tg',{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})}));res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));}catch{res.writeHead(500);res.end();}return;
 }
 try{await handle(req,res);}catch{if(!res.headersSent)res.writeHead(500);res.end('Local recovery request failed');}
});
server.listen(58437,'127.0.0.1',()=>console.log(JSON.stringify({ready:true,mode,rest,origin:'http://127.0.0.1:58437',buildId:manifest.buildId})));
async function stop(){server.close();server.closeAllConnections();if(app)await app.close();process.exit(0);}
process.once('SIGTERM',stop);process.once('SIGINT',stop);
