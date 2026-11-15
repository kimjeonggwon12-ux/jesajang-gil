// 운영 접속/시드/초기화 금지. 기존 합성 DB에서만 실제 배정 주기를 확인하고 원래 배정을 복원한다.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash,createHmac} from 'node:crypto';
const origin='http://127.0.0.1:58577',database='jesajang_pilot_20261114';
const ids={owner:'9900000000990',member:'9900000000991',other:'9900000000992',admin:'9900000000993'};
const names={owner:'가짜운영자',member:'가짜기존사용자',other:'가짜신규사용자',admin:'가짜시범관리자'};
const tokens={},checks=[];
function sql(statement){return execFileSync('/opt/homebrew/bin/psql',['-h','/tmp/jesajang-auth-pg-socket','-p','58431','-U','postgres','-d',database,'-qAt','-v','ON_ERROR_STOP=1'],{input:statement,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();}
assert.equal(sql('select current_database()'),database);
const originalFetch=globalThis.fetch;
globalThis.fetch=(input,init)=>{assert.equal(new URL(input).origin,origin);return originalFetch(input,{...init,redirect:'error'});};
const runtime=JSON.parse(readFileSync(new URL('../../.local-auth-20261111/runtime.json',import.meta.url),'utf8'));
const jwt=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({role:'service_role',exp:4102444800})).toString('base64url');
process.env.SUPABASE_SERVICE_ROLE_KEY=jwt+'.'+createHmac('sha256',runtime.jwtSecret).update(jwt).digest('base64url');
const {encId}=await import('../server/lib/idref.js');
async function api(action,body={},who='owner'){
 const response=await fetch(origin+'/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...body,_tk:tokens[who]||''})});
 return {status:response.status,body:await response.json()};
}
async function state(){const r=await api('getPilotAdmin',{query:'가짜'});assert.equal(r.status,200);return r.body;}
async function change(operation,targetIds=[]){const s=await state(),r=await api('savePilotAdmin',{operation,targetIds,expectedVersion:s.policy.version,reason:'합성 DB: 비공개 저장소 외 A/B 전환 검증',confirmed:true});assert.equal(r.status,200);assert.equal(r.body.ok,true,JSON.stringify(r.body));return r.body;}
async function route(who,ownerView){const r=await fetch(origin+'/api/pilot-session',{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify({token:tokens[who],...(ownerView?{ownerView}:{})})});return {status:r.status,body:await r.json(),cookie:r.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ')};}
async function html(cookie,path='/'){const r=await fetch(origin+path,{headers:{cookie}});assert.equal(r.status,200);return r.text();}
function business(){return Object.fromEntries(['activities','teachers'].map(table=>[table,sql(`select jsonb_build_object('count',count(*),'hash',md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]')::text)) from public.${table} t`)]));}
function assignment(){return JSON.parse(sql("select coalesce(jsonb_agg(nid order by nid),'[]') from site_pilot_members"));}
const businessBefore=business(),membersBefore=assignment();
for(const who of Object.keys(ids)){const r=await api('verifyLogin',{memberId:ids[who],name:names[who],dept:'장년회',pin:'582946'},'none');assert.equal(r.status,200);assert.ok(r.body.token);tokens[who]=r.body.token;}
const before=await state();assert.ok(!before.users.rows.some(r=>r.name===names.owner));
let restored=false;
try{
 if(before.policy.enabled)await change('stop');
 await change('remove',[ids.member,ids.admin]);
 const formatted='099000000-00991';
 await change('assign',[encId(formatted),encId('099000000-00993')]);
 assert.equal((await route('member')).body.site,'A');
 checks.push('formatted-masked-member-and-admin-assignment-saved-with-policy-stopped');
 await change('start');
 for(const who of ['member','admin']){
  const result=await route(who);assert.equal(result.body.site,'B');
  assert.doesNotMatch(await html(result.cookie),/<base href="\/">/);
 }
 const other=await route('other');assert.equal(other.body.site,membersBefore.includes(ids.other)?'B':'A');
 checks.push('member-and-admin-route-to-B-on-shared-local-DB');
 for(const who of ['member','admin']){
  assert.equal((await api('getPilotAdmin',{},who)).status,403);
  assert.equal((await api('savePilotAdmin',{operation:'stop',targetIds:[],confirmed:true,expectedVersion:(await state()).policy.version,reason:'거절 검증'},who)).status,403);
  assert.equal((await route(who,'B')).status,403);
 }
 const ownerRejected=await api('savePilotAdmin',{operation:'assign',targetIds:[encId('099000000-00990')],confirmed:true,expectedVersion:(await state()).policy.version,reason:'책임자 제외 확인'});
 assert.match(ownerRejected.body.error,/최종 책임자/);
 for(const view of ['A','B']){const result=await route('owner',view);assert.equal(result.body.site,view);assert.equal(result.body.canManage,true);assert.equal((await html(result.cookie)).includes('<base href="/">'),view==='A');}
 checks.push('only-owner-manages-assignment-and-selects-own-view');
 const stale=await api('savePilotAdmin',{operation:'remove',targetIds:[encId(formatted)],confirmed:true,expectedVersion:before.policy.version,reason:'오래된 화면 확인'});assert.equal(stale.body.stale,true);
 const previousCookie=(await route('member')).cookie;
 await change('stop');
 for(const who of ['member','admin','other'])assert.equal((await route(who)).body.site,'A');
 assert.match(await html(previousCookie),/<base href="\/">/);
 assert.ok(assignment().includes(ids.member));
 checks.push('stop-routes-all-nonowners-to-A-including-old-B-cookie-with-assignment-preserved');
 await change('start');assert.equal((await route('member')).body.site,'B');
 await change('remove',[encId(formatted)]);assert.equal((await route('member')).body.site,'A');
 checks.push('formatted-masked-removal-and-resume-work');
 const denied=await api('exportRosterSheet',{password:'local-only-export-password'},'member');assert.equal(denied.status,403);
 const wrong=await api('exportRosterSheet',{password:'incorrect-local-verification-password'});assert.ok(wrong.body.error);assert.ok(!wrong.body.base64);
 const exported=await api('exportRosterSheet',{password:'local-only-export-password',dept:'장년회'});assert.equal(exported.status,200);assert.equal(exported.body.ok,true,JSON.stringify({error:exported.body.error}));
 const bytes=Buffer.from(exported.body.base64,'base64');assert.equal(bytes.subarray(0,2).toString(),'PK');assert.ok(bytes.length>1000);
 checks.push('export-denies-member-and-wrong-password-and-generates-authorized-xlsx');
 writeFileSync(new URL('../artifacts/ab-non-r2-20261115/export.json',import.meta.url),JSON.stringify({syntheticOnly:true,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),fileReturned:true,contentsStored:false},null,2)+'\n');
}finally{
 // 감사 이력/버전은 지우지 않는다. 실행 전 선택 상태와 시작 여부만 정상 API로 복원한다.
 const wanted=[ids.member,ids.admin].filter(id=>membersBefore.includes(id)),unwanted=[ids.member,ids.admin].filter(id=>!membersBefore.includes(id));
 if(wanted.length)await change('assign',wanted);
 if(unwanted.length)await change('remove',unwanted);
 const latest=await state();if(latest.policy.enabled!==before.policy.enabled)await change(before.policy.enabled?'start':'stop');
 assert.deepEqual(assignment(),membersBefore);assert.equal((await state()).policy.enabled,before.policy.enabled);
 assert.deepEqual(business(),businessBefore);restored=true;
 const after=await state();writeFileSync(new URL('../artifacts/ab-non-r2-20261115/integration.json',import.meta.url),JSON.stringify({origin,database,checks,passed:checks.length,restored,businessUnchanged:true,policyBefore:before.policy,policyAfter:after.policy,selectedBefore:membersBefore.length,selectedAfter:after.selectedCount,auditPreserved:true,seedOrReset:false,productionAccess:false},null,2)+'\n');
}
console.log(JSON.stringify({passed:checks.length,restored,businessUnchanged:true,productionAccess:false}));
