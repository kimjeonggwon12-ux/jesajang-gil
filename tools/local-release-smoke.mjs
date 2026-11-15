// 실제 운영 대신 기존 가짜 DB에 새로 재빌드한 고정 후보를 연결한다. 저장 요청 없음.
import http from 'node:http';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHmac,createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const workspace=fileURLToPath(new URL('../../',import.meta.url)),out=path.join(workspace,'artifacts/release-prep-20261115');
const build=JSON.parse(readFileSync(path.join(out,'build-check.json'),'utf8')),source=build.source,origin='http://127.0.0.1:58445';
assert.equal(source,path.join(workspace,'.local-release-check-20261115/source'));
const runtime=JSON.parse(readFileSync(path.join(workspace,'.local-auth-20261111/runtime.json'),'utf8'));
for(const key of Object.keys(process.env))if(/SUPABASE|TEACHERSQUARE|TEACHER_EXPORT|GEMINI|TELEGRAM|R2_|BOT_TOKEN|ATT_|VERCEL|AUTH_SIGNING|PILOT_|LOCAL_.*FIXTURE|NEXT_PUBLIC_/.test(key))delete process.env[key];
const value=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({role:'service_role',exp:4102444800})).toString('base64url');
Object.assign(process.env,{NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',PILOT_ROUTING_ENABLED:'1',TEACHERSQUARE_SYSTEM_OWNER_ID:'9900000000990',SUPABASE_URL:'http://127.0.0.1:58443',SUPABASE_SERVICE_ROLE_KEY:value+'.'+createHmac('sha256',runtime.jwtSecret).update(value).digest('base64url'),AUTH_SIGNING_KEY:runtime.authSigningKey});
const fetchOriginal=globalThis.fetch;
globalThis.fetch=(input,init)=>{const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);assert.ok(u.hostname==='127.0.0.1'&&['58443','58444','58445'].includes(u.port),'외부 호출 금지');return fetchOriginal(input,{...init,redirect:'error'});};
function sql(query,db='jesajang_pilot_20261114'){
 assert.ok(['jesajang_pilot_20261114','jesajang_release_apply_20261115','jesajang_release_restore_20261115'].includes(db));
 return execFileSync('/opt/homebrew/bin/psql',['-h','/tmp/jesajang-auth-pg-socket','-p','58431','-U','postgres','-d',db,'-qAt','-v','ON_ERROR_STOP=1'],{input:"begin read only; set local statement_timeout='5s';\n"+query+';rollback;',encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:64*1024*1024}).trim();
}
const state=()=>sql("select jsonb_build_object('policy',(select to_jsonb(p) from site_pilot_policy p),'selected',(select jsonb_agg(to_jsonb(p) order by nid) from site_pilot_members p),'audit',(select count(*) from site_pilot_changes),'activities',(select count(*) from activities))");
const before=state();
const {tokenFor,pinVersion}=await import(pathToFileURL(path.join(source,'server/lib/auth.js')));
const ids=['9900000000990','9900000000991','9900000000993'],tokens={};
for(const id of ids){const pin=JSON.parse(sql(`select to_jsonb(p) from member_pins p where nid='${id}'`));tokens[id]=tokenFor(id,'m',{pinVersion:pinVersion(pin)});}
process.chdir(path.join(source,'next-app'));
const next=(await import(pathToFileURL(path.join(source,'next-app/node_modules/next/dist/server/next.js')))).default;
const app=next({dev:false,dir:path.join(source,'next-app'),hostname:'127.0.0.1',port:58445});await app.prepare();
const server=http.createServer(app.getRequestHandler());await new Promise(resolve=>server.listen(58445,'127.0.0.1',resolve));
const checks=[];
try{
 const post=async(url,body)=>fetch(url,{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify(body)});
 for(const [id,view,expected]of [[ids[0],'A','A'],[ids[0],'B','B'],[ids[1],undefined,'A'],[ids[2],undefined,'A']]){
  const r=await post(origin+'/api/pilot-session',{token:tokens[id],...(view?{ownerView:view}:{})});assert.equal(r.status,200);const body=await r.json();assert.equal(body.site,expected);
  const cookie=r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');const page=await fetch(origin+'/activities',{headers:{cookie}});assert.equal(page.status,200);const html=await page.text();assert.equal(html.includes('data-site="A"'),expected==='A');assert.match(html,/pilot-bridge\.js/);assert.match(page.headers.get('cache-control'),/no-store/);
 }
 checks.push('packaged build: owner A/B and member/admin A routing');
 for(const id of ids){const r=await post(origin+'/api',{action:'getPilotAdmin',_tk:tokens[id]});assert.equal(r.status,id===ids[0]?200:403);}
 checks.push('owner-only pilot management');
 for(const id of ids){const body={action:'checkAdmin',_tk:tokens[id]},a=await post('http://127.0.0.1:58444/api',body),b=await post(origin+'/api',body);assert.equal(a.status,b.status);assert.deepEqual(await a.json(),await b.json());}
 checks.push('previous verified build and packaged build permission responses identical');
 for(const url of ['/service-worker.js','/manifest.json','/pilot-bridge.js'])assert.equal((await fetch(origin+url)).status,200);
 const manifest=await (await fetch(origin+'/manifest.json')).json();assert.equal(manifest.id,'/app.html');assert.equal(manifest.start_url,'/');
 checks.push('existing install identity and worker assets preserved');
 const trace=JSON.parse(readFileSync(path.join(source,'next-app/.next/server/app/api/pilot-page/route.js.nft.json'),'utf8'));
 assert.ok(trace.files.some(f=>path.resolve(source,'next-app/.next/server/app/api/pilot-page',f)===path.join(source,'app.html')));
 assert.ok(trace.files.every(f=>existsSync(path.resolve(source,'next-app/.next/server/app/api/pilot-page',f))));
 checks.push('A HTML included in server file trace');
 assert.equal(state(),before);checks.push('pilot selections/audit/activity counts unchanged');
 const sequences="select coalesce(jsonb_agg(to_jsonb(s) order by sequencename),'[]') from pg_sequences s where schemaname='public'";
 assert.equal(sql(sequences,'jesajang_release_apply_20261115'),sql(sequences,'jesajang_release_restore_20261115'));checks.push('restored sequence counters identical');
 writeFileSync(path.join(out,'release-http-check.json'),JSON.stringify({ok:true,at:new Date().toISOString(),buildId:build.buildId,checks,localOnly:true,productionChanged:false,externalTrafficBlocked:true,preservedStateHash:createHash('sha256').update(before).digest('hex')},null,2)+'\n');console.log(JSON.stringify({ok:true,buildId:build.buildId,checkGroups:checks.length,productionChanged:false}));
}finally{server.close();server.closeAllConnections();await app.close();}
