// 기존 합성 DB의 정책을 바꾸지 않고 실제 API/번호 가림/SQL 검증 경계까지 확인한다.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHmac} from 'node:crypto';
const runtime=JSON.parse(readFileSync(new URL('../../.local-auth-20261111/runtime.json',import.meta.url),'utf8'));
for(const key of Object.keys(process.env))if(/SUPABASE|TEACHERSQUARE|TEACHER_EXPORT|GEMINI|TELEGRAM|R2_|BOT_TOKEN|ATT_|VERCEL|AUTH_SIGNING|PILOT_|LOCAL_.*FIXTURE|NEXT_PUBLIC_/.test(key))delete process.env[key];
const value=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({role:'service_role',exp:4102444800})).toString('base64url');
Object.assign(process.env,{SUPABASE_URL:'http://127.0.0.1:58443',SUPABASE_SERVICE_ROLE_KEY:value+'.'+createHmac('sha256',runtime.jwtSecret).update(value).digest('base64url'),AUTH_SIGNING_KEY:runtime.authSigningKey,PILOT_ROUTING_ENABLED:'1',TEACHERSQUARE_SYSTEM_OWNER_ID:'9900000000990'});
const originalFetch=globalThis.fetch;
globalThis.fetch=(input,init)=>{const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);assert.equal(u.origin,'http://127.0.0.1:58443');return originalFetch(input,{...init,redirect:'error'});};
const {default:handler}=await import('../api/index.js'),{webHandler}=await import('../server/lib/web-handler.js'),{encId}=await import('../server/lib/idref.js');
const invoke=webHandler(handler);
async function api(action,body={},token=''){const r=await invoke(new Request('http://127.0.0.1/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...body,_tk:token})}));return {status:r.status,body:await r.json()};}
const login=await api('verifyLogin',{memberId:'9900000000990',name:'가짜운영자',dept:'장년회',pin:'582946'});assert.equal(login.status,200);assert.ok(login.body.token);
const token=login.body.token,state=async()=>{const r=await api('getPilotAdmin',{query:'가짜'},token);assert.equal(r.status,200);return {policy:r.body.policy,count:r.body.selectedCount,history:r.body.history};};
const before=await state(),checks=[];
// -1은 실제 정책 버전과 일치할 수 없다. SQL은 배정/정책/이력 쓰기보다 먼저 거절한다.
assert.ok(before.policy.version>=0);
for(const id of ['9900000000991','099000000-00991',encId('099000000-00991')]){
 const r=await api('savePilotAdmin',{operation:'assign',targetIds:[id],reason:'번호 형식 검증: 저장하지 않는 이전 버전',expectedVersion:-1,confirmed:true},token);
 assert.equal(r.status,200);assert.equal(r.body.stale,true,JSON.stringify(r.body));assert.match(r.body.error,/다른 곳에서 배정/);checks.push({case:id.startsWith('r_')?'masked-formatted':id.includes('-')?'formatted':'digits',reachedSqlVersionGuard:true});
}
const after=await state();assert.deepEqual(after,before);
const result={environment:'existing synthetic DB only',checks,policyChanged:false,assignmentsChanged:false,historyChanged:false,seedOrReset:false,externalRequests:0};
writeFileSync(new URL('../artifacts/hosted-ui-comparison-20261115/pilot-format-db.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
