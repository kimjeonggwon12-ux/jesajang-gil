import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import {AwsClient} from 'aws4fetch';
import {AccessError} from '../server/lib/request-context.js';
import {cleanFileName,docExt,DOC_TYPES} from '../server/lib/images.js';
const source=readFileSync(new URL('../server/lib/room-attachments.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/export /g,'')+'\n({uploadRoomFile,uploadRoomPhoto,readyAttachment,attachmentResponse})';
// 실제 서명 생성기를 사용하되 모든 HTTP와 DB는 메모리로 한정한다. 운영 자격을 읽지 않는다.
function fixture(overrides={}){
 const env={R2_ACCOUNT_ID:'public-account',R2_BUCKET:'public-bucket',R2_ACCESS_KEY_ID:'PUBLIC_KEY',R2_SECRET_ACCESS_KEY:'fake-public-secret',R2_PUBLIC_BASE:'https://images.invalid',R2_PRIVATE_ACCOUNT_ID:'private-account',R2_PRIVATE_BUCKET:'private-bucket',R2_PRIVATE_ACCESS_KEY_ID:'PRIVATE_KEY',R2_PRIVATE_SECRET_ACCESS_KEY:'fake-private-secret',...overrides};
 const requests=[],rows=[],objects=new Map();
 class MemoryAws extends AwsClient{
  async fetch(url,options){const request=await this.sign(url,options);requests.push(request);const key=new URL(request.url).pathname;
   if(request.method==='HEAD'){const data=objects.get(key);return new Response(null,{status:data?200:404,headers:data?{'content-length':String(data.length),etag:'"local-etag"'}:{}});}
   if(request.method==='PUT'){
    const copy=request.headers.get('x-amz-copy-source');
    if(copy){assert.equal(request.headers.get('x-amz-copy-source-if-match'),'"local-etag"');assert.ok(objects.has(copy));objects.set(key,objects.get(copy));return new Response('<CopyObjectResult><ETag>local</ETag></CopyObjectResult>');}
    objects.set(key,Buffer.from(await request.arrayBuffer()));return new Response(null,{status:200});
   }
   assert.equal(request.method,'GET');const data=objects.get(key);return new Response(data||null,{status:data?200:404,headers:data?{'content-length':String(data.length)}:{}});
  }
 }
 const database={from(table){assert.equal(table,'room_attachments');return {insert(row){rows.push(row);return null;},select(){const where=[];const query={eq(key,value){where.push([key,value]);return query;},limit(){return rows.filter(r=>where.every(([k,v])=>r[k]===v));}};return query;}};}};
 const api=vm.runInNewContext(source,{process:{env},AwsClient:MemoryAws,randomUUID,AccessError,cleanFileName,docExt,DOC_TYPES,isStoredUrl:v=>typeof v==='string'&&v.startsWith(env.R2_PUBLIC_BASE+'/'),prepareImage:()=>{throw Error('unused image transformation');},IMAGE_MAX_BYTES:20*1024*1024,db:()=>database,run:async v=>v,Buffer,URL,Response,Date,fetch:()=>{throw Error('external network forbidden');}});
 return {...api,env,requests,rows,objects};
}
const body={targetId:'fake-room',fileName:'sample.pdf',data:Buffer.from('%PDF-fake').toString('base64')},actor={nid:'fake-user'};
const credential=request=>request.headers.get('authorization').match(/Credential=([^/]+)/)[1];
test('비공개 설정 누락/부분 키/같은 버킷이면 공개 키로 업로드 우회하지 않는다',async()=>{
 for(const override of [{R2_PRIVATE_BUCKET:''},{R2_PRIVATE_BUCKET:'public-bucket'},{R2_PRIVATE_ACCESS_KEY_ID:''},{R2_PRIVATE_SECRET_ACCESS_KEY:''},{R2_PRIVATE_ACCESS_KEY_ID:'',R2_PRIVATE_SECRET_ACCESS_KEY:''}]){
  const f=fixture(override);for(const operation of [()=>f.uploadRoomFile(body,actor),()=>f.uploadRoomPhoto('data:image/png;base64,ZmFrZQ==',body,actor)])await assert.rejects(operation,e=>e.status===503);
  assert.equal(f.requests.length,0);assert.equal(f.rows.length,0);
 }
});
test('작은 첨부 저장과 새 첨부 읽기는 비공개 계정·키만 사용한다',async()=>{
 const f=fixture(),result=await f.uploadRoomFile(body,actor);assert.match(result.url,/^room-private:/);assert.equal(f.requests.length,1);
 assert.equal(credential(f.requests[0]),'PRIVATE_KEY');assert.equal(new URL(f.requests[0].url).hostname,'private-account.r2.cloudflarestorage.com');assert.ok(new URL(f.requests[0].url).pathname.startsWith('/private-bucket/'));
 f.rows[0].message_id=7;
 const response=await f.attachmentResponse({id:7,target_id:body.targetId,file_url:result.url},'file');assert.equal(await response.text(),'%PDF-fake');assert.equal(credential(f.requests[1]),'PRIVATE_KEY');assert.equal(response.headers.get('cache-control'),'private, no-store');
});
test('큰 첨부의 서명 PUT·HEAD·확정 복사는 같은 비공개 키를 사용한다',async()=>{
 const f=fixture(),data=Buffer.from('%PDF-large-fake'),result=await f.uploadRoomFile({...body,data:null,size:data.length},actor),url=new URL(result.put);
 assert.ok(url.searchParams.get('X-Amz-Credential').startsWith('PRIVATE_KEY/'));assert.equal(url.searchParams.get('X-Amz-Expires'),'900');assert.equal(url.hostname,'private-account.r2.cloudflarestorage.com');assert.equal(result.headers['Content-Type'],'application/pdf');
 f.objects.set(url.pathname,data);const ready=await f.readyAttachment(result.url,body,actor,'file');assert.notEqual(ready.object_key,f.rows[0].staging_key);assert.deepEqual(f.requests.map(r=>r.method),['HEAD','PUT']);assert.ok(f.requests.every(r=>credential(r)==='PRIVATE_KEY'));
 assert.deepEqual(f.objects.get('/private-bucket/'+ready.object_key),data);
});
test('비공개 설정이 없어도 기존 공개 첨부는 기존 키로 읽을 수 있다',async()=>{
 const f=fixture({R2_PRIVATE_BUCKET:'',R2_PRIVATE_ACCESS_KEY_ID:'',R2_PRIVATE_SECRET_ACCESS_KEY:''}),key='/public-bucket/room-files/old.pdf';f.objects.set(key,Buffer.from('legacy bytes'));
 const response=await f.attachmentResponse({file_url:'https://images.invalid/room-files/old.pdf',file_name:'old.pdf'},'file');assert.equal(await response.text(),'legacy bytes');assert.equal(credential(f.requests[0]),'PUBLIC_KEY');assert.equal(new URL(f.requests[0].url).hostname,'public-account.r2.cloudflarestorage.com');
});
test('비공개 계정 생략 시 계정만 공유하며 공개 키와 비공개 키는 섞지 않는다',async()=>{
 const f=fixture({R2_PRIVATE_ACCOUNT_ID:''});await f.uploadRoomFile(body,actor);assert.equal(new URL(f.requests[0].url).hostname,'public-account.r2.cloudflarestorage.com');assert.equal(credential(f.requests[0]),'PRIVATE_KEY');
 f.objects.set('/public-bucket/room/00000000-0000-4000-8000-000000000099.iv1-320-960.jpg',Buffer.from('legacy image'));
 const response=await f.attachmentResponse({photo:'https://images.invalid/room/00000000-0000-4000-8000-000000000099.iv1-320-960.jpg'},'photo','preview');assert.equal(await response.text(),'legacy image');assert.equal(f.requests.length,3);assert.ok(f.requests.slice(1).every(r=>credential(r)==='PUBLIC_KEY'));
});
test('읽기 전용 배포 점검도 공개/비공개 버킷을 각각의 키로 서명한다',async()=>{
 const requests=[],env=fixture({R2_ACCOUNT_ID:'publicaccount',R2_PRIVATE_ACCOUNT_ID:'privateaccount'}).env;
 const code=readFileSync(new URL('../tools/hosted-review-probe.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/export /g,'')+'\n({storage})';
 const probe=vm.runInNewContext(code,{process:{env},AwsClient,URL,Request,Response,AbortSignal,fetch:async(input,options)=>{
  const request=new Request(input,options);requests.push(request);assert.ok(['GET','HEAD'].includes(request.method));return new Response(request.method==='GET'?'<ListBucketResult/>':null,{status:200});
 }});
 const result=await probe.storage();assert.equal(result.privateConfigured,true);assert.equal(result.privateHeadStatus,200);assert.equal(result.objectsWritten,0);assert.deepEqual(requests.map(credential),['PUBLIC_KEY','PUBLIC_KEY','PRIVATE_KEY']);
 requests.length=0;env.R2_PRIVATE_SECRET_ACCESS_KEY='';const missing=await probe.storage();assert.equal(missing.privateConfigured,false);assert.equal(missing.privateHeadStatus,null);assert.equal(requests.length,2);
});
