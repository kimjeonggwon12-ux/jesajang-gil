// 가짜 백업 API 검증 전용. 외부 저장소나 실제 자격을 읽지 않으며 메모리 안에서만 보관한다.
import {randomBytes} from 'node:crypto';
export function localStorageFixture(serviceToken){
 const objects=new Map(),signed=new Map();let bucket=false;
 return async function handle(req,res,url){
  const pathname=url.pathname;
  if(!pathname.startsWith('/storage/v1/')&&!pathname.startsWith('/__local_storage/'))return false;
  const json=(value,status=200)=>{res.statusCode=status;res.setHeader('content-type','application/json');res.end(JSON.stringify(value));return true;};
  if(pathname==='/__local_storage/stats')return json({objects:objects.size,bucketPublic:false,keys:[...objects.keys()]});
  if(req.method==='GET'&&pathname.startsWith('/storage/v1/object/sign/backups/')){
   const name=decodeURIComponent(pathname.slice('/storage/v1/object/sign/backups/'.length)),permit=signed.get(url.searchParams.get('token')),file=objects.get(name);
   if(!file||!permit||permit.name!==name||permit.expires<Date.now())return json({error:'Invalid signed URL'},403);
   res.setHeader('content-type','application/gzip');res.setHeader('content-disposition','attachment; filename="'+name+'"');res.end(file.bytes);return true;
  }
  if(req.headers.authorization!=='Bearer '+serviceToken)return json({error:'Unauthorized'},401);
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);
  const body=()=>JSON.parse(bytes.toString()||'{}');
  if(pathname==='/storage/v1/bucket/backups'&&req.method==='GET')return bucket?json({id:'backups',name:'backups',public:false}):json({error:'Not found'},404);
  if(pathname==='/storage/v1/bucket'&&req.method==='POST'){if(body().public!==false)return json({error:'Private only'},400);bucket=true;return json({name:'backups'});}
  if(pathname==='/storage/v1/object/list/backups')return json([...objects.entries()].sort(([a],[b])=>b.localeCompare(a)).map(([name,file])=>({name,created_at:file.createdAt,metadata:{size:file.bytes.length}})));
  if(pathname==='/storage/v1/object/backups'&&req.method==='DELETE'){for(const name of body().prefixes||[])objects.delete(name);return json([]);}
  if(pathname.startsWith('/storage/v1/object/sign/backups/')&&req.method==='POST'){
   const name=decodeURIComponent(pathname.slice('/storage/v1/object/sign/backups/'.length));if(!objects.has(name))return json({error:'Not found'},404);
   const token=randomBytes(16).toString('hex');signed.set(token,{name,expires:Date.now()+Number(body().expiresIn)*1000});return json({signedURL:'/object/sign/backups/'+encodeURIComponent(name)+'?token='+token});
  }
  if(pathname.startsWith('/storage/v1/object/backups/')&&['POST','PUT'].includes(req.method)){
   const name=decodeURIComponent(pathname.slice('/storage/v1/object/backups/'.length));objects.set(name,{bytes,createdAt:new Date().toISOString()});return json({Key:'backups/'+name});
  }
  return json({error:'Unsupported local fixture operation'},404);
 };
}
