// 검토용 사본에만 넣는 비공개 진단. 조회/HEAD만 사용하며 업무 API를 호출하지 않는다.
import {timingSafeEqual,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {AwsClient} from 'aws4fetch';
import sharp from 'sharp';
import {Resvg} from '@resvg/resvg-js';
const EXPECTED_DB='rbpqfpfuvlllaqidtdjg.supabase.co';
const safeFetch=(url,options={})=>fetch(url,{...options,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});
const errorCode=e=>e?.name==='TimeoutError'?'timeout':'connection_failed';
async function database(){
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)return {configured:false};
 const base=new URL(url);if(base.protocol!=='https:'||base.hostname!==EXPECTED_DB)return {configured:true,expectedProject:false};
 const headers={apikey:key,Authorization:'Bearer '+key,Prefer:'count=exact'};
 const tables=['teachers','site_pilot_policy','room_attachments','telegram_update_receipts','member_registration_contacts'];
 const result=[];
 for(const table of tables){const r=await safeFetch(new URL('/rest/v1/'+table+'?select=*',base),{method:'HEAD',headers});result.push({table,status:r.status,count:r.ok?Number((r.headers.get('content-range')||'').split('/')[1]):null});}
 return {configured:true,expectedProject:true,method:'HEAD',tables:result};
}
async function telegram(name){
 const token=process.env[name];if(!token)return {configured:false};
 const me=await safeFetch('https://api.telegram.org/bot'+token+'/getMe'),who=await me.json();
 const r=await safeFetch('https://api.telegram.org/bot'+token+'/getWebhookInfo'),info=await r.json();
 const u=info.result?.url?new URL(info.result.url):null;
 return {configured:true,botConnected:me.ok&&who.ok===true,botUsername:who.result?.username||null,webhookConnected:r.ok&&info.ok===true,webhookHost:u?.hostname||null,webhookPath:u?.pathname==='/api/tg'?'/api/tg':u?'other':null,webhookFingerprint:createHash('sha256').update(info.result?.url||'').digest('hex'),pendingUpdates:info.result?.pending_update_count,hasRecentError:!!info.result?.last_error_date,messageSent:false};
}
async function storage(){
 const account=process.env.R2_ACCOUNT_ID,key=process.env.R2_ACCESS_KEY_ID,secret=process.env.R2_SECRET_ACCESS_KEY,bucket=process.env.R2_BUCKET;
 if(!account||!key||!secret||!bucket)return {configured:false,privateConfigured:!!(process.env.R2_PRIVATE_BUCKET&&(process.env.R2_PRIVATE_ACCOUNT_ID||account)&&process.env.R2_PRIVATE_ACCESS_KEY_ID&&process.env.R2_PRIVATE_SECRET_ACCESS_KEY)};
 if(!/^[a-zA-Z0-9]+$/.test(account))return {configured:false};
 const client=new AwsClient({accessKeyId:key,secretAccessKey:secret,service:'s3',region:'auto',retries:0});
 const base='https://'+account+'.r2.cloudflarestorage.com/';
 const get=async(url,method)=>{const request=await client.sign(url,{method});return safeFetch(request,{method});};
 const head=await get(base+encodeURIComponent(bucket),'HEAD');
 const listed=await get(base+encodeURIComponent(bucket)+'?list-type=2&max-keys=1','GET');
 let objectHead=null;
 if(listed.ok){const xml=await listed.text();const encoded=xml.match(/<Key>([\s\S]*?)<\/Key>/)?.[1];if(encoded){const object=encoded.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'");const r=await get(base+encodeURIComponent(bucket)+'/'+object.split('/').map(encodeURIComponent).join('/'),'HEAD');objectHead={status:r.status,bytes:Number(r.headers.get('content-length'))};}}
 let privateHead=null;const privateBucket=process.env.R2_PRIVATE_BUCKET;
 const privateAccount=process.env.R2_PRIVATE_ACCOUNT_ID||account,privateKey=process.env.R2_PRIVATE_ACCESS_KEY_ID,privateSecret=process.env.R2_PRIVATE_SECRET_ACCESS_KEY;
 const privateConfigured=!!(privateBucket&&privateAccount&&privateKey&&privateSecret);
 if(privateConfigured&&privateBucket!==bucket&&/^[a-zA-Z0-9]+$/.test(privateAccount)){
  const privateClient=new AwsClient({accessKeyId:privateKey,secretAccessKey:privateSecret,service:'s3',region:'auto',retries:0});
  const request=await privateClient.sign('https://'+privateAccount+'.r2.cloudflarestorage.com/'+encodeURIComponent(privateBucket),{method:'HEAD'});
  privateHead=(await safeFetch(request,{method:'HEAD'})).status;
 }
 return {configured:true,bucketHeadStatus:head.status,listOneStatus:listed.status,existingObject:objectHead,privateConfigured,privateSeparate:!!privateBucket&&privateBucket!==bucket,privateHeadStatus:privateHead,objectsWritten:0};
}
export async function nativeRuntime(){
 let font,fontPath;
 for(const prefix of ['../server','server']){
  try{fontPath=path.resolve(process.cwd(),prefix,'assets/fonts/NanumGothic-Regular.ttf');font=await readFile(fontPath);break;}
  catch(error){if(error.code!=='ENOENT')throw error;}
 }
 if(!font)throw Error('bundled_font_missing');
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><text x="2" y="24" font-size="18" font-family="NanumGothic">교사광장</text></svg>';
 const png=new Resvg(svg,{font:{fontFiles:[fontPath],loadSystemFonts:false,defaultFontFamily:'NanumGothic'}}).render().asPng();const webp=await sharp(png).webp().toBuffer();
 return {node:process.version,platform:process.platform,fontLoaded:font.length>0,pngBytes:png.length,webpBytes:webp.length};
}
export async function deploymentProbe(request){
 const token=request.headers.get('authorization')||'',expected='Bearer '+(process.env.HOSTED_REVIEW_TOKEN||'');
 const expires=Number(process.env.HOSTED_REVIEW_EXPIRES);
 if(request.method!=='GET'||expected.length<40||token.length!==expected.length||!timingSafeEqual(Buffer.from(token),Buffer.from(expected))||!Number.isFinite(expires)||Date.now()>expires)return new Response('Not found',{status:404,headers:{'Cache-Control':'private, no-store'}});
 const checks={};for(const [name,fn]of Object.entries({database,reportBot:()=>telegram('TEACHERSQUARE_BOT_TOKEN'),attendanceBot:()=>telegram('ATT_BOT_TOKEN'),storage,nativeRuntime})){
  try{checks[name]=await fn();}catch(e){checks[name]={error:errorCode(e)};}
 }
 return Response.json({checkedAt:new Date().toISOString(),readOnly:true,applicationWritesBlocked:true,...checks},{headers:{'Cache-Control':'private, no-store'}});
}
