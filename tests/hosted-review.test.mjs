import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL,fileURLToPath} from 'node:url';
import path from 'node:path';
import {deploymentProbe} from '../tools/hosted-review-probe.mjs';
const repo=fileURLToPath(new URL('../',import.meta.url)),workspace=path.dirname(repo.replace(/\/$/,'')),source=path.join(workspace,'.hosted-review-20261115/source');
test('검토 사본의 업무·로그인·웹훅·첨부 API 모든 메서드는 외부 호출 전 차단',async()=>{
 const prev=globalThis.fetch;let calls=0;globalThis.fetch=()=>{calls++;throw Error('외부 요청 금지');};
 try{for(const file of ['route.ts','tg/route.ts','room-attachment/route.ts','pilot-session/route.ts','pilot-page/route.ts']){
  const mod=await import(pathToFileURL(path.join(source,'next-app/app/api',file)));
  for(const method of ['GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD']){const r=await mod[method](new Request('https://review.invalid/api',{method}));assert.equal(r.status,503);}
 }assert.equal(calls,0);assert.match(readFileSync(path.join(source,'next-app/proxy.ts'),'utf8'),/return NextResponse.next\(\)/);
 }finally{globalThis.fetch=prev;}
});
test('진단은 인증/만료를 확인하며 승인된 조회·HEAD만 보냄',async()=>{
 const saved={...process.env},prev=globalThis.fetch,cwd=process.cwd(),calls=[];const key='f'.repeat(64);
 Object.assign(process.env,{HOSTED_REVIEW_TOKEN:key,HOSTED_REVIEW_EXPIRES:String(Date.now()+60000),SUPABASE_URL:'https://rbpqfpfuvlllaqidtdjg.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fake-service',TEACHERSQUARE_BOT_TOKEN:'fake-report',ATT_BOT_TOKEN:'fake-attend',R2_ACCOUNT_ID:'f'.repeat(32),R2_BUCKET:'fake-public',R2_ACCESS_KEY_ID:'fake-key',R2_SECRET_ACCESS_KEY:'fake-secret'});delete process.env.R2_PRIVATE_BUCKET;
 process.chdir(path.join(repo,'next-app'));
 globalThis.fetch=async(input,options={})=>{
  const u=new URL(typeof input==='string'||input instanceof URL?input:input.url),method=options.method||'GET';assert.ok(['GET','HEAD'].includes(method));calls.push({host:u.hostname,path:u.pathname,method});
  if(u.hostname==='rbpqfpfuvlllaqidtdjg.supabase.co'){assert.equal(method,'HEAD');return new Response(null,{status:u.pathname.endsWith('/teachers')?200:404,headers:{'content-range':'0-0/2515'}});}
  if(u.hostname==='api.telegram.org'){assert.match(u.pathname,/\/(getMe|getWebhookInfo)$/);return Response.json({ok:true,result:u.pathname.endsWith('getMe')?{username:'fake_bot'}:{url:'https://jesajang-gil.vercel.app/api/tg',pending_update_count:0}});}
  assert.equal(u.hostname,'f'.repeat(32)+'.r2.cloudflarestorage.com');return method==='HEAD'?new Response(null,{headers:{'content-length':'12'}}):new Response('<ListBucketResult><Contents><Key>fake/a.txt</Key></Contents></ListBucketResult>');
 };
 try{
  assert.equal((await deploymentProbe(new Request('https://review.invalid'))).status,404);assert.equal(calls.length,0);
  const request=()=>new Request('https://review.invalid',{headers:{authorization:'Bearer '+key}});
  process.env.HOSTED_REVIEW_EXPIRES='invalid';assert.equal((await deploymentProbe(request())).status,404);assert.equal(calls.length,0);process.env.HOSTED_REVIEW_EXPIRES=String(Date.now()+60000);
  const result=await (await deploymentProbe(request())).json();assert.equal(result.database.expectedProject,true);assert.equal(result.reportBot.messageSent,false);assert.equal(result.storage.objectsWritten,0);assert.equal(result.nativeRuntime.fontLoaded,true);assert.equal(result.storage.existingObject.status,200);assert.equal(calls.length,12);
 }finally{globalThis.fetch=prev;process.chdir(cwd);for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});
