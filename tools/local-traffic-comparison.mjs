// 운영 연결 옵션이 없는 비교 도구. 기존 가짜 DB 준비 이후에는 조회만 실행한다.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {ids,sql,jwt} from '../tests/helpers/local-db.mjs';
import {seedAggregates} from '../tests/helpers/aggregates-fixture.mjs';
import {createPrivateChat} from '../next-app/lib/private-chat.mjs';

const out=new URL('../../artifacts/traffic-comparison-20261113/',import.meta.url);
mkdirSync(out,{recursive:true});
const runtime=JSON.parse(readFileSync(new URL('../../.local-auth-20261111/runtime.json',import.meta.url),'utf8'));
for(const key of Object.keys(process.env))if(/SUPABASE|GEMINI|TELEGRAM|R2_|ATTEND_|BOT_TOKEN|VERCEL|AUTH_SIGNING|LEGACY_URL/.test(key))delete process.env[key];
Object.assign(process.env,{SUPABASE_URL:'http://127.0.0.1:58433',SUPABASE_SERVICE_ROLE_KEY:jwt('service_role'),AUTH_SIGNING_KEY:runtime.authSigningKey});
const actions=new Set(['getMessages','getMyTargets','getRoster','getTeacherListReport','getTeacherDirectory','getMyActivities','getMyActivityPage','getMyTierStatus','getDistrictView','getDistrictReport','getOrgSummary']);
const readRpcs=new Set(['roster_counts','teacher_report_facts','personal_tier_facts','scope_tier_facts']);
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,init={})=>{
 const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);
 const method=String(init.method||(input instanceof Request?input.method:'GET')).toUpperCase();
 assert.equal(u.hostname,'127.0.0.1','외부 연결 금지');assert.ok(['58433','58434'].includes(u.port),'고정 로컬 포트만 허용');
 if(!['GET','HEAD'].includes(method)){
  const metrics=u.port==='58433'&&u.pathname==='/__local_metrics'&&method==='POST';
  const api=u.port==='58434'&&u.pathname==='/api'&&method==='POST'&&actions.has(JSON.parse(init.body).action);
  const rpc=u.port==='58433'&&method==='POST'&&u.pathname.startsWith('/rest/v1/rpc/')&&readRpcs.has(u.pathname.split('/').at(-1));
  assert.ok(metrics||api||rpc,'허용한 읽기/계측 이외 요청 금지');
 }
 return originalFetch(input,{...init,redirect:'error'});
};

// 별도 로컬 DB의 합성 명단 2,347명, 활동 17,218건에 같은 채팅/이력을 보탠다.
seedAggregates();
const chatId=[ids.member,ids.other].sort().join('__');
sql(`begin; truncate chat_messages,coop_requests,target_history restart identity;
 insert into chat_messages(chat_id,from_id,to_id,message,sent_at,is_read)
 select '${chatId}','${ids.other}','${ids.member}','가짜 대화 '||g||' '||repeat('가짜 내용 ',12),'2026-11-12 09:00:00',true from generate_series(1,1205)g;
 insert into target_history(member_id,target_id,changed_at,from_stage,to_stage,memo)
 select '${ids.member}','LIST-1','2026-11-12 09:00:00','섭외','친분',repeat('가짜 이력 ',50) from generate_series(1,1205)g; commit;`);
const tables=sql("select tablename from pg_tables where schemaname='public' order by tablename").split('\n');
function digest(){
 return sql('begin read only; '+tables.map(t=>`select '${t}',count(*),md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) from public."${t}" t;`).join('\n')+' commit;');
}
const before=digest();
const {tokenFor,pinVersion}=await import('../server/lib/auth.js');
const row=JSON.parse(sql(`select row_to_json(p) from member_pins p where nid='${ids.member}'`));
const token=tokenFor(ids.member,'m',{pinVersion:pinVersion(row)});
const bytes=x=>Buffer.byteLength(JSON.stringify(x));
const metric=async(reset=false)=>(await fetch('http://127.0.0.1:58433/__local_metrics',{method:reset?'POST':'GET'})).json();
const totals=m=>Object.values(m.db).reduce((s,r)=>({bytes:s.bytes+r.bytes,requests:s.requests+r.requests,rows:s.rows+r.rows}),{bytes:0,requests:0,rows:0});
async function api(action,data={}){
 const start=performance.now();const r=await fetch('http://127.0.0.1:58434/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...data,_tk:token})});
 const text=await r.text(),value=JSON.parse(text);assert.equal(r.status,200,action);assert.equal(value.error,undefined,action+': '+value.error);
 return {value,bytes:Buffer.byteLength(text),gzipBytes:gzipSync(text).length,ms:Math.round((performance.now()-start)*10)/10};
}
async function measure(action,data={}){await metric(true);const r=await api(action,data);return {...r,db:totals(await metric())};}
const compact=({value,...r})=>({...r,returnedRows:value.rows?.length});
const comparisons=[];
async function pair(name,first,second,check){const a=await measure(...first),b=await measure(...second);if(check)check(a.value,b.value);comparisons.push({name,before:compact(a),after:compact(b)});return [a,b];}
const [chat,paged]=await pair('chatInitial',['getMessages',{chatId}],['getMessages',{chatId,paged:true}],(a,b)=>assert.deepEqual(b.rows,a.rows.slice(-50)));
const [idleOld,idleNew]=await pair('chatIdle',['getMessages',{chatId,after:'2026-11-12 09:00:00'}],['getMessages',{chatId,paged:true,afterId:1205}],(a,b)=>assert.deepEqual(b.rows,a.rows));
// 현재 서버의 옛 호출 계약도 이미 최적화되어 있다. 실제 이전 채팅 조회는 보관한 커밋에서 따로 실행한다.
// 이 합성 비교의 기준을 고정한다. 현재 운영 소스/실제 자료 검증은 별도 production-* 근거를 따른다.
const baseline='94450a6c30ffd36d54f79f90f78b94c1a154e1fd';
const oldChatSource=execFileSync('git',['show',baseline+':server/actions/chat.js'],{encoding:'utf8'});
const patchedChat=oldChatSource.replace(/from\s*['"](\.[^'"]+)['"]/g,(_,p)=>'from '+JSON.stringify(new URL(p,new URL('../server/actions/chat.js',import.meta.url)).href));
const oldChat=(await import('data:text/javascript;base64,'+Buffer.from(patchedChat).toString('base64'))).default;
const {maskOut}=await import('../server/lib/idref.js');
const originalChat=[];
for(const [name,body,newResult] of [['initial',{chatId},paged],['idle',{chatId,after:'2026-11-12 09:00:00'},idleNew]]){
 await metric(true);const r=await oldChat.getMessages(body),db=totals(await metric());assert.equal(r.error,undefined);
 const expected=name==='initial'?r.rows.slice(-50):r.rows;
 assert.deepEqual(newResult.value.rows.map(({message,sentAt,read})=>({message,sentAt,read})),expected.map(({message,sentAt,read})=>({message,sentAt,read})));
 const text=JSON.stringify(maskOut(r,ids.member));
 originalChat.push({name,before:{bytes:Buffer.byteLength(text),gzipBytes:gzipSync(text).length,db,returnedRows:r.rows.length},after:compact(newResult)});
}
await pair('targetsInitial',['getMyTargets',{}],['getMyTargets',{includeHistory:false}],(a,b)=>assert.deepEqual(b.rows.map(({history,...x})=>x),a.rows.map(({history,...x})=>x)));
const roster=await measure('getRoster'),report=await measure('getTeacherListReport');
const directory=await measure('getTeacherDirectory',{page:1,limit:20,refresh:true});assert.equal(directory.value.total,2347);assert.equal(directory.value.rows.length,20);
const reportById=new Map(report.value.rows.map(r=>[r.memberId,r]));
for(const r of directory.value.rows)for(const [k,v] of Object.entries(reportById.get(r.memberId)))assert.deepEqual(r[k],v,k);
const add=(a,b)=>({bytes:a.bytes+b.bytes,gzipBytes:a.gzipBytes+b.gzipBytes,ms:a.ms+b.ms,db:{bytes:a.db.bytes+b.db.bytes,requests:a.db.requests+b.db.requests,rows:a.db.rows+b.db.rows}});
comparisons.push({name:'directoryInitial',before:{...add(roster,report),returnedRows:2347},after:compact(directory)});
const cachedDirectory=await measure('getTeacherDirectory',{page:2,limit:20});assert.equal(cachedDirectory.value.rows.length,20);
const [full,overview]=await pair('activityOverview',['getMyActivities',{}],['getMyActivities',{summary:true,aggregate:true}],(a,b)=>{assert.equal(b.overview.total,a.rows.length);assert.deepEqual(b.roleCounts,a.roleCounts);assert.deepEqual(b.roleItemCounts,a.roleItemCounts);});
const firstActivityPage=await measure('getMyActivityPage',{page:1,limit:20,query:'',withSequence:true,feedbackOnly:false});
assert.equal(firstActivityPage.value.total,full.value.rows.length);assert.equal(firstActivityPage.value.rows.length,20);
comparisons.push({name:'activityOverviewAndFirstPage',before:compact(full),after:{...add(overview,firstActivityPage),returnedRows:20}});

const old=await import('../tests/helpers/legacy-status.mjs'),next=await import('../server/actions/tiers.js');
const {legacyTeacherReport}=await import('../tests/helpers/legacy-teacher-report.mjs');
const {forgetRoster}=await import('../server/actions/roster.js');
const at=new Date('2026-11-13T12:00:00+09:00'),dbComparisons=[];
for(const [name,a,b] of [
 ['personal',()=>old.legacygetMyTierStatus({memberId:ids.member},at),()=>next.myTierStatusAt({memberId:ids.member},at)],
 ['district',()=>old.legacygetDistrictView({memberId:ids.member},at),()=>next.districtViewAt({memberId:ids.member},at)],
 ['department',()=>old.legacygetDistrictReport({dept:'청년회'},at),()=>next.districtReportAt({dept:'청년회'},at)],
 ['organization',()=>old.legacygetOrgSummary(at),()=>next.orgSummaryAt(at)],
 ['rosterAggregate',()=>legacyTeacherReport(at),()=>next.teacherListReportAt(at)],
]){
 forgetRoster();await metric(true);const original=await a(),m1=totals(await metric());
 forgetRoster();await metric(true);const improved=await b(),m2=totals(await metric());assert.deepEqual(improved,original,name);
 dbComparisons.push({name,before:m1,after:m2,equal:true,browserResultBytes:bytes(improved)});
}

// 현재 Next 채팅 제어기를 가상 시계로 실행한다. 읽음은 모의 응답이며 DB에 쓰지 않는다.
let now=0,seq=0,shown=true;const timers=new Map(),calls=[];
const request=async(action,data)=>{calls.push({action,at:now});return action==='markRead'?{ok:true}:data.afterId==null?{rows:[{id:1,toId:'1',fromId:'2',read:false,message:'합성'}],nextCursor:1}:{rows:[],nextCursor:1};};
const c=createPrivateChat({request,chatId:'synthetic',memberId:'1',onChange(){},visible:()=>shown,schedule:(fn,ms)=>{timers.set(++seq,{fn,at:now+ms});return seq;},cancel:id=>timers.delete(id)});
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
c.start();await flush();
async function advance(ms){const end=now+ms;for(;;){const [id,t]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0]||[];if(!t||t.at>end)break;now=t.at;timers.delete(id);await t.fn();await flush();}now=end;}
await advance(60000);const firstMinute=[...calls];shown=false;c.visibility();await advance(60000);assert.equal(calls.length,firstMinute.length);c.dispose();
assert.equal(firstMinute.filter(x=>x.action==='getMessages').length,4);assert.equal(firstMinute.filter(x=>x.action==='markRead').length,1);
const poll={seconds:60,oldEvidence:'artifacts/traffic-20261112/request-counts.json; source verification in baseline-source.json',oldGet:13,oldRead:13,newGet:4,newRead:1,hiddenAdditionalRequests:0,nextControllerExecuted:true,readReceiptsMocked:true};

const baselineHtml=execFileSync('git',['show',baseline+':app.html'],{maxBuffer:20*1024*1024});
const baselineText=baselineHtml.toString(),refs=(text)=>[...text.matchAll(/<(script|link)\b[^>]*>/gi)].flatMap(([tag,type])=>{if(type.toLowerCase()==='link'&&!/rel=["']stylesheet["']/i.test(tag))return [];return [...tag.matchAll(/(?:src|href)=["']([^"']+)["']/gi)].map(x=>x[1]);});
const staticSizes={baselineCommit:baseline,notes:['Uniform gzip simulation; excludes images, external CDN/fonts, lazy assets, service worker, API, prefetch and RSC navigation. Not actual CDN wire bytes.'],old:{files:[],external:[]},next:{}};
staticSizes.old.files.push({path:'app.html',bytes:baselineHtml.length,gzipBytes:gzipSync(baselineHtml).length});
for(const ref of new Set(refs(baselineText))){if(/^https?:|^\/\//.test(ref)){staticSizes.old.external.push(ref);continue;}const p=ref.replace(/^\.\//,'').replace(/^\//,'').split('?')[0];const body=execFileSync('git',['show',baseline+':'+p],{maxBuffer:20*1024*1024});staticSizes.old.files.push({path:p,bytes:body.length,gzipBytes:gzipSync(body).length});}
for(const route of ['/','/members','/activities','/status']){
 const html=await(await fetch('http://127.0.0.1:58434'+route)).text();
 const files=[{path:route,bytes:Buffer.byteLength(html),gzipBytes:gzipSync(html).length}];
 for(const ref of new Set(refs(html))){assert.ok(ref.startsWith('/'),'외부 화면 파일 제외');const r=await fetch('http://127.0.0.1:58434'+ref);assert.equal(r.status,200);const body=Buffer.from(await r.arrayBuffer());files.push({path:ref,bytes:body.length,gzipBytes:gzipSync(body).length});}
 staticSizes.next[route]={files};
}
const totalFiles=files=>files.reduce((s,r)=>({bytes:s.bytes+r.bytes,gzipBytes:s.gzipBytes+r.gzipBytes,requests:s.requests+1}),{bytes:0,gzipBytes:0,requests:0});
staticSizes.old.total=totalFiles(staticSizes.old.files);for(const value of Object.values(staticSizes.next))value.total=totalFiles(value.files);
const baselineLines=baselineText.split('\n').flatMap((line,i)=>/setInterval.*5000|markRead.*chatId|async function fetchMessages/.test(line)?[{line:i+1,text:line.slice(0,500)}]:[]);
writeFileSync(new URL('baseline-source.json',out),JSON.stringify({baseline,baselineLines},null,2));
assert.equal(digest(),before,'측정 도중 업무 표의 값이 바뀌면 실패');
const result={date:'2026-11-13',syntheticOnly:true,productionTouched:false,dbWritesDuringMeasurements:false,tablesUnchanged:tables.length,tableDigest:createHash('sha256').update(before).digest('hex'),fixture:{teachers:2347,activities:Number(sql('select count(*) from activities')),ownActivities:full.value.rows.length,chatMessages:1205},comparisons,originalChat,dbComparisons,cachedDirectory:compact(cachedDirectory),poll,staticSizes,notes:['API comparisons use current Next runtime with preserved full-list contract vs actual new page options. They are not full production sessions.','Original chat executes the stored baseline module; new chat includes the current authorization DB overhead.','DB comparisons execute preserved pre-optimization calculation helpers vs current code, with exact equality assertions.','Bytes are decompressed response-body bytes; gzip is simulated separately. Timings are diagnostic local single reads, not production speed.']};
writeFileSync(new URL('measurements.json',out),JSON.stringify(result,null,2));
console.log(JSON.stringify({fixture:result.fixture,unchangedTables:tables.length,api:comparisons.map(r=>({name:r.name,before:r.before.bytes,after:r.after.bytes})),db:dbComparisons.map(r=>({name:r.name,before:r.before.bytes,after:r.after.bytes,requests:[r.before.requests,r.after.requests]})),staticOld:staticSizes.old.total,staticNext:Object.fromEntries(Object.entries(staticSizes.next).map(([k,v])=>[k,v.total])),poll},null,2));
