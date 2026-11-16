// 현재 빌드의 로컬 A/B 응답만 확인. 배정·정책 저장이나 외부 통신은 하지 않는다.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
const origin='http://127.0.0.1:58575',evidence=[];
async function api(action,body={},token=''){const r=await fetch(origin+'/api',{method:'POST',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify({action,...body,_tk:token})});return {status:r.status,body:await r.json()};}
async function login(id,name){const r=await api('verifyLogin',{memberId:id,name,dept:'장년회',pin:'582946'});assert.equal(r.status,200);assert.ok(r.body.token);return r.body.token;}
async function route(token,ownerView){const r=await fetch(origin+'/api/pilot-session',{method:'POST',redirect:'error',headers:{'content-type':'application/json',origin},body:JSON.stringify({token,...(ownerView?{ownerView}:{})})});return {status:r.status,body:await r.json(),cookie:r.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ')};}
async function page(cookie,path='/'){const r=await fetch(origin+path,{redirect:'error',headers:{cookie}});assert.equal(r.status,200,path);return r.text();}
const owner=await login('9900000000990','가짜운영자'),admin=await login('9900000000993','가짜시범관리자'),member=await login('9900000000991','가짜기존사용자');
const state=async()=>{const r=await api('getPilotAdmin',{query:'가짜시범부서'},owner);assert.equal(r.status,200);return r.body;};
const before=await state();assert.equal(before.policy.enabled,false);assert.ok(!before.users.rows.some(r=>r.memberId==='9900000000990'));
for(const site of ['A','B']){const r=await route(owner,site);assert.equal(r.status,200);assert.equal(r.body.site,site);const html=await page(r.cookie);assert.equal(html.includes('<base href="/">'),site==='A');assert.ok(html.includes('pilot-bridge.js'));evidence.push({check:'owner-'+site+'-html',passed:true});}
for(const [kind,token] of [['admin',admin],['member',member]]){assert.equal((await api('getPilotAdmin',{},token)).status,403);assert.equal((await route(token,'B')).status,403);const r=await route(token);assert.equal(r.body.site,'A');assert.ok((await page(r.cookie)).includes('<base href="/">'));evidence.push({check:kind+'-cannot-override-stopped-policy',passed:true});}
const after=await state();assert.deepEqual(after.policy,before.policy);assert.equal(after.selectedCount,before.selectedCount);
const b=await route(owner,'B');for(const path of ['/activities','/rooms','/connect','/coaching','/library','/community?section=story','/calendar','/admin','/admin/education','/admin/pilot']){const html=await page(b.cookie,path);assert.ok(html.includes('pilot-bridge.js'));assert.ok(!html.includes('<base href="/">'));}
evidence.push({check:'eleven-B-routes-and-policy-preserved',passed:true});
writeFileSync('artifacts/ui-parity-completion-20261115/release-routing.json',JSON.stringify({environment:origin,policyWritten:false,assignmentsWritten:false,externalRequests:0,policyVersion:before.policy.version,selectedCount:before.selectedCount,checks:evidence},null,2)+'\n');console.log(JSON.stringify({passed:evidence.length,policyChanged:false,BPages:11}));
