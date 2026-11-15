// 테스트의 별도 프로세스. 원격/로컬 실제 모듈을 같은 격리 DB 어댑터로 호출한다.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHmac,createHash} from 'node:crypto';
const mode=process.argv[2];if(!['old-before','old-after','candidate'].includes(mode)||!process.send)throw new Error('검증 자식 프로세스 전용');
const runtime=JSON.parse(readFileSync(new URL('../../.local-auth-20261111/runtime.json',import.meta.url),'utf8'));
for(const key of Object.keys(process.env))if(/SUPABASE|AUTH_SIGNING|TELEGRAM|BOT_TOKEN|R2_|ATTEND_|TEACHER|GEMINI|LEGACY_URL|VERCEL|NEXT_PUBLIC/.test(key))delete process.env[key];
const tokenBody=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({role:'service_role',exp:4102444800})).toString('base64url');
Object.assign(process.env,{SUPABASE_URL:'http://127.0.0.1:58436',SUPABASE_SERVICE_ROLE_KEY:tokenBody+'.'+createHmac('sha256',runtime.jwtSecret).update(tokenBody).digest('base64url'),AUTH_SIGNING_KEY:runtime.authSigningKey,TEACHER_EXPORT_PW:'local-only-export-password',R2_ACCOUNT_ID:'compat-fixture',R2_BUCKET:'compat-public',R2_PRIVATE_BUCKET:'compat-private',R2_PRIVATE_ACCESS_KEY_ID:'fake-private-key',R2_PRIVATE_SECRET_ACCESS_KEY:'fake-private-secret',R2_ACCESS_KEY_ID:'local-fake-key',R2_SECRET_ACCESS_KEY:'local-fake-secret',R2_PUBLIC_BASE:'https://compat-public.invalid'});
const port=mode==='old-before'?58435:58436,originalFetch=globalThis.fetch,objects=new Map(),blocked=[];
const storage=new URL('../../.local-compat-20261114/private-storage/',import.meta.url);mkdirSync(storage,{recursive:true,mode:0o700});
globalThis.fetch=async(input,init)=>{
  const u=new URL(typeof input==='string'||input instanceof URL?input:input.url),method=init?.method||(input instanceof Request?input.method:'GET');
  if(u.hostname==='127.0.0.1'&&u.port==='58436'&&u.pathname.startsWith('/rest/v1/'))return originalFetch('http://127.0.0.1:'+port+u.pathname.slice(8)+u.search,{...init,redirect:'error'});
  if(mode==='candidate'&&u.hostname==='compat-fixture.r2.cloudflarestorage.com'&&u.pathname.startsWith('/compat-private/')){
    const key=createHash('sha256').update(u.pathname).digest('hex'),dataPath=new URL(key+'.bytes',storage),metaPath=new URL(key+'.json',storage);
    if(method==='PUT'){const file={bytes:Buffer.from(init?.body||(input instanceof Request?await input.arrayBuffer():[])),type:new Headers(init?.headers||(input instanceof Request?input.headers:undefined)).get('content-type')};objects.set(u.pathname,file);writeFileSync(dataPath,file.bytes,{mode:0o600});writeFileSync(metaPath,JSON.stringify({type:file.type}),{mode:0o600});return new Response(null,{status:200});}
    const file=objects.get(u.pathname)||(existsSync(dataPath)&&existsSync(metaPath)?{bytes:readFileSync(dataPath),...JSON.parse(readFileSync(metaPath,'utf8'))}:null);return new Response(method==='GET'&&file?file.bytes:null,{status:file?200:404,headers:file?{'content-type':file.type||'application/octet-stream','content-length':String(file.bytes.length)}:{}});
  }
  blocked.push({host:u.hostname,method});throw new Error('External network disabled in compatibility rehearsal');
};
const root=mode==='candidate'?new URL('../',import.meta.url):new URL('../../.local-compat-20261114/upstream/',import.meta.url);
const {default:handler}=await import(new URL('api/index.js',root));
const {webHandler}=await import('../server/lib/web-handler.js');
const web=webHandler(handler);
process.on('message',async message=>{
  if(message.op==='stop'){process.disconnect();process.exit(0);}
  try{
    if(message.op==='metrics'){process.send({id:message.id,value:{blocked,storedObjects:objects.size}});return;}
    if(message.op==='download'){
      if(mode!=='candidate')throw new Error('원격 사본에는 인증 첨부 경로가 없습니다. HTTP 상태를 모의하지 않습니다.');
      const {roomDownload}=await import('../server/lib/room-download.js');const response=await roomDownload(new Request('http://local.invalid/api/room-attachment',{method:'POST',body:JSON.stringify(message.body)}));
      process.send({id:message.id,value:{status:response.status,bytes:Buffer.from(await response.arrayBuffer()).toString('base64'),headers:Object.fromEntries(response.headers)}});return;
    }
    const request=new Request('http://local.invalid/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(message.body)});
    const response=await web(request);process.send({id:message.id,value:{status:response.status,body:await response.json()}});
  }catch(error){process.send({id:message.id,error:String(error.message)});}
});
process.send({ready:true,mode});
