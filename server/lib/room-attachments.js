// 방 첨부는 공개 이미지 버킷과 분리한다. DB에는 주소 대신 일회용 첨부 참조를 보관한다.
import {AwsClient} from 'aws4fetch';
import {randomUUID} from 'node:crypto';
import {db,run} from './db.js';
import {AccessError} from './request-context.js';
import {cleanFileName,docExt,DOC_TYPES,isStoredUrl} from './images.js';
import {prepareImage,IMAGE_MAX_BYTES} from './image-variants.js';

export const FILE_MAX=50*1024*1024,INLINE_MAX=3*1024*1024;
const PREFIX='room-private:',types={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'};
const fail=()=>new AccessError('첨부 파일을 확인하지 못했어요. 다시 올려 주세요.',400);
// 비공개 키를 기존 이미지 키로 대체하지 않는다. 옛 공개 첨부 읽기는 기존 키만 사용한다.
const config=(legacy=false)=>{
 const e=legacy
  ? {account:process.env.R2_ACCOUNT_ID,bucket:process.env.R2_BUCKET,key:process.env.R2_ACCESS_KEY_ID,secret:process.env.R2_SECRET_ACCESS_KEY}
  : {account:process.env.R2_PRIVATE_ACCOUNT_ID||process.env.R2_ACCOUNT_ID,bucket:process.env.R2_PRIVATE_BUCKET,key:process.env.R2_PRIVATE_ACCESS_KEY_ID,secret:process.env.R2_PRIVATE_SECRET_ACCESS_KEY};
 if(!e.account||!e.bucket||!e.key||!e.secret||(!legacy&&e.bucket===process.env.R2_BUCKET))throw new AccessError(legacy?'기존 첨부 저장소에 연결하지 못했어요. 담당자에게 알려 주세요.':'비공개 첨부 저장소가 준비되지 않았어요. 담당자에게 알려 주세요.',503);
 return e;
};
const objectUrl=(key,legacy=false)=>{const e=config(legacy);return `https://${e.account}.r2.cloudflarestorage.com/${e.bucket}/${key}`;};
const client=(legacy=false)=>{const e=config(legacy);return new AwsClient({accessKeyId:e.key,secretAccessKey:e.secret,service:'s3',region:'auto',retries:0});};
const send=(key,options,legacy=false)=>client(legacy).fetch(objectUrl(key,legacy),{...options,cache:'no-store',redirect:'error'});
const objectKey=(id,name)=>`room-private/${id}/${name}`;
export const attachmentId=ref=>typeof ref==='string'&&/^room-private:[0-9a-f-]{36}$/.test(ref)?ref.slice(PREFIX.length):null;
const ref=id=>PREFIX+id;
async function insert(row){await run(db().from('room_attachments').insert({...row,expires_at:new Date(Date.now()+30*60000).toISOString()}));return row;}
async function put(key,bytes,type){const r=await send(key,{method:'PUT',body:bytes,headers:{'Content-Type':type,'Cache-Control':'private, no-store'}});if(!r.ok)throw fail();}
export async function uploadRoomFile(body,actor){
 config();const name=cleanFileName(body.fileName);if(!name)throw fail();
 const id=randomUUID(),key=objectKey(id,'original.'+docExt(name)),type=DOC_TYPES[docExt(name)];
 const base={id,target_id:body.targetId,uploader_nid:actor.nid,kind:'file',name,mime:type,object_key:key};
 if(body.data){
  const data=String(body.data).replace(/^data:[^,]*,/, '');
  if(data.length>Math.ceil(INLINE_MAX/3)*4||!data||data.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(data))throw fail();
  const bytes=Buffer.from(data,'base64');if(!bytes.length||bytes.length>INLINE_MAX)throw fail();
  await put(key,bytes,type);await insert({...base,byte_size:bytes.length});
  return {ok:true,url:ref(id),name,size:bytes.length};
 }
 const size=Number(body.size);if(!Number.isSafeInteger(size)||size<=0||size>FILE_MAX)throw fail();
 const staging=objectKey(id,'pending.'+docExt(name));
 await insert({...base,byte_size:size,staging_key:staging});
 const u=new URL(objectUrl(staging));u.searchParams.set('X-Amz-Expires','900');
 const headers={'Content-Type':type};const signed=await client().sign(u,{method:'PUT',headers,aws:{signQuery:true}});
 return {ok:true,url:ref(id),name,put:signed.url,headers};
}
export async function uploadRoomPhoto(data,body,actor){
 config();const s=String(data||'');if(s.length>Math.ceil(IMAGE_MAX_BYTES/3)*4+100)throw fail();
 const m=s.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/]*={0,2})$/);
 if(!m||m[2].length%4)throw fail();
 const bytes=Buffer.from(m[2],'base64'),prepared=await prepareImage(bytes,m[1]),id=randomUUID(),key=objectKey(id,'original.'+types[m[1]]),variants={};
 await put(key,bytes,m[1]);
 for(const v of prepared.variants){const k=objectKey(id,`w${v.side}.webp`);await put(k,v.bytes,v.type);variants[v.side]={key:k,size:v.bytes.length,mime:v.type};}
 await insert({id,target_id:body.targetId,uploader_nid:actor.nid,kind:'photo',name:'사진.'+types[m[1]],mime:m[1],byte_size:bytes.length,object_key:key,variants});
 return ref(id);
}
export async function readyAttachment(value,body,actor,kind){
 const id=attachmentId(value);if(!id)throw fail();
 const [row]=await run(db().from('room_attachments').select('*').eq('id',id).limit(1));
 if(!row||row.target_id!==body.targetId||row.uploader_nid!==actor.nid||row.kind!==kind||row.message_id||Date.parse(row.expires_at)<=Date.now())throw fail();
 if(row.staging_key){
  const head=await send(row.staging_key,{method:'HEAD'}),size=Number(head.headers.get('content-length')),etag=head.headers.get('etag');
  if(!head.ok||size!==Number(row.byte_size)||!size||size>FILE_MAX||!etag)throw fail();
  // 서명 PUT은 유효기간 내 다시 사용할 수 있다. 확정 파일은 다른 키로 복사하여 재업로드와 분리한다.
  const finalKey=objectKey(id,randomUUID()+'.'+docExt(row.name));
  const copy=await send(finalKey,{method:'PUT',headers:{'x-amz-copy-source':`/${config().bucket}/${row.staging_key}`,'x-amz-copy-source-if-match':etag}});
  const xml=await copy.text();if(!copy.ok||!xml.includes('<CopyObjectResult')||xml.includes('<Error'))throw fail();
  return {...row,object_key:finalKey};
 }
 return row;
}
export async function attachmentResponse(message,kind,variant){
 const value=kind==='photo'?message.photo:message.file_url,id=attachmentId(value);
 let key,type,size,name,fallback,legacy=false;
 if(id){
  const [row]=await run(db().from('room_attachments').select('*').eq('id',id).eq('target_id',message.target_id).eq('message_id',message.id).limit(1));
  if(!row||row.kind!==kind)throw fail();
  const v=kind==='photo'&&variant==='preview'?(row.variants['960']||row.variants['320']):null;
  key=v?.key||row.object_key;type=v?.mime||row.mime;size=Number(v?.size||row.byte_size);name=row.name;
 }else{
  // 기존 원본은 덮어쓰거나 지우지 않는다. 공개 URL 자체 폐쇄는 별도 운영 이관 작업이다.
  if(kind==='photo'&&String(value).startsWith('data:image/')){
   const m=value.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/);if(!m||m[2].length>Math.ceil(IMAGE_MAX_BYTES/3)*4)throw fail();
   return new Response(Buffer.from(m[2],'base64'),{headers:downloadHeaders(m[1],'사진.'+types[m[1]],kind)});
  }
  if(!isStoredUrl(value))throw fail();
  const base=String(process.env.R2_PUBLIC_BASE).replace(/\/+$/,''),part=String(value).slice(base.length+1);
  if(!/^(room|room-files)\/[A-Za-z0-9._/-]+$/.test(part)||part.split('/').some(x=>!x||x==='.'||x==='..'))throw fail();
  key=part;legacy=true;name=kind==='photo'?'사진.'+(part.split('.').at(-1)||'jpg'):cleanFileName(message.file_name);
  type=kind==='photo'?Object.entries(types).find(([,ext])=>ext===part.split('.').at(-1))?.[0]:DOC_TYPES[docExt(name)];
  if(!type)throw fail();
  const match=part.match(/\/[0-9a-f-]{36}\.iv1-((?:320|960|1600)(?:-(?:320|960|1600))*)\.(?:jpg|png|webp)$/);
  if(kind==='photo'&&variant==='preview'&&match){
   const side=match[1].split('-').map(Number).sort((a,b)=>a-b).find(n=>n>=960);
   if(side){fallback={key,type};key=part.replace(/\.(jpg|png|webp)$/,`.w${side}.webp`);type='image/webp';}
  }
 }
 let response=await send(key,{method:'GET'},legacy);
 if(!response.ok&&fallback){void response.body?.cancel().catch(()=>{});response=await send(fallback.key,{method:'GET'},legacy);type=fallback.type;}
 const actual=Number(response.headers.get('content-length')),max=kind==='photo'?IMAGE_MAX_BYTES:FILE_MAX;
 if(!response.ok||!Number.isSafeInteger(actual)||actual<=0||actual>max||(size&&actual!==size)){void response.body?.cancel().catch(()=>{});throw fail();}
 return new Response(response.body,{headers:downloadHeaders(type,name,kind)});
}
function downloadHeaders(type,name,kind){return {'Content-Type':type,'Content-Disposition':`${kind==='photo'?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; sandbox"};}
