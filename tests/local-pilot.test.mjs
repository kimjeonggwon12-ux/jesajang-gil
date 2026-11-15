// 고정 새 로컬 DB에서만 실행. seed/reset/운영 접속 없음.
import {test,before} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {emptyActivity,normalizeActivity,activityPayload,editActivity} from '../next-app/lib/activities.ts';
const origin='http://127.0.0.1:58444',ids={operator:'9900000000990',a:'9900000000991',b:'9900000000992'};
const names={operator:'가짜운영자',a:'가짜기존사용자',b:'가짜신규사용자'},tokens={};
function sql(text,db='jesajang_pilot_20261114'){assert.ok(['jesajang_pilot_20261114','jesajang_final_workflows_20261114'].includes(db));return execFileSync('/opt/homebrew/bin/psql',['-h','/tmp/jesajang-auth-pg-socket','-p','58431','-U','postgres','-d',db,'-qAt','-v','ON_ERROR_STOP=1'],{input:text,encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:32*1024*1024}).trim();}
async function api(action,body={},who='operator'){const r=await fetch(origin+'/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...body,...(tokens[who]?{_tk:tokens[who]}:{})})});return {status:r.status,body:await r.json()};}
async function state(){const r=await api('getPilotAdmin',{query:'가짜시범부서'});assert.equal(r.status,200,JSON.stringify(r));assert.ok(r.body.policy);return r.body;}
async function change(operation,targetIds=[],extra={}){const current=await state();return api('savePilotAdmin',{operation,targetIds,expectedVersion:current.policy.version,reason:'가짜 A/B 검증',confirmed:true,...extra});}
async function session(who,extra={}){const r=await fetch(origin+'/api/pilot-session',{method:'POST',headers:{'content-type':'application/json','origin':origin,...extra},body:JSON.stringify({token:tokens[who]||''})});return {status:r.status,body:await r.json(),cookie:(r.headers.get('set-cookie')||'').split(';')[0],rawCookie:r.headers.get('set-cookie')||''};}
async function page(cookie,path='/'){const r=await fetch(origin+path,{headers:{cookie}});return {status:r.status,html:await r.text(),cache:r.headers.get('cache-control')};}
before(async()=>{
 assert.equal(sql("select current_database()"),'jesajang_pilot_20261114');
 for(const key of Object.keys(ids)){const r=await api('verifyLogin',{memberId:ids[key],name:names[key],dept:'장년회',pin:'582946'},'none');assert.equal(r.body.ok,true,JSON.stringify(r));tokens[key]=r.body.token;}
 assert.equal((await change('stop')).body.ok,true);assert.equal((await change('remove',[ids.a,ids.b])).body.ok,true);
});
test('운영자만 배정 관리: 일반·미인증·위조 요청 거절 및 번호 가림',async()=>{
 const s=await state();assert.equal(s.users.total,3);assert.ok(s.users.rows.every(r=>r.memberId.startsWith('r_')||r.memberId===ids.operator));
 for(const who of ['a','b','none'])for(const action of ['getPilotAdmin','savePilotAdmin']){const r=await api(action,{operation:'start',expectedVersion:s.policy.version,targetIds:[],reason:'위조',confirmed:true,operatorIds:[ids.a],_actor:{nid:ids.operator}},who);assert.equal(r.status,who==='none'?401:403,JSON.stringify(r));}
 assert.equal((await state()).policy.version,s.policy.version);
});
test('기본 A, 지정만으로 시작 안 됨, 시작 후 지정 계정만 B 및 다른 로그인도 동일',async()=>{
 assert.equal((await session('a')).body.site,'A');assert.equal((await session('b')).body.site,'A');
 const s=await state(),masked=s.users.rows.find(r=>r.name===names.b).memberId;
 assert.equal((await change('assign',[masked])).body.ok,true);assert.equal((await session('b')).body.site,'A');
 assert.equal((await change('start')).body.ok,true);
 const a=await session('a'),b=await session('b');assert.equal(a.body.site,'A');assert.equal(b.body.site,'B');assert.match(b.rawCookie,/HttpOnly/);assert.match(b.rawCookie,/SameSite=Lax/);
 assert.match((await page(a.cookie)).html,/data-site="A"/);assert.doesNotMatch((await page(b.cookie)).html,/<base href="\/">/);
 assert.match((await page(a.cookie)).cache,/no-store/);assert.match((await page(b.cookie)).cache,/no-store/);
 for(const path of ['/admin/pilot','/admin/reports','/account','/attend'])assert.doesNotMatch((await page(a.cookie,path)).html,/<base href="\/">/,'보안·보고 공통 화면 '+path);
 const login=await api('verifyLogin',{memberId:ids.b,name:names.b,dept:'장년회',pin:'582946'},'none');const old=tokens.b;tokens.b=login.body.token;assert.equal((await session('b')).body.site,'B');tokens.b=old;
});
test('쿠키 위조·타 출처·직접 내부 페이지·URL 강제 배정으로 B 선택 불가',async()=>{
 const a=await session('a');assert.match((await page(a.cookie,'/?variant=B&site=B')).html,/data-site="A"/);
 assert.equal((await session('a',{origin:'https://example.invalid'})).status,403);
 const original=tokens.b;tokens.b=original.slice(0,-2)+'xx';assert.equal((await session('b')).status,401);tokens.b=original;
 assert.equal((await page('','/api/pilot-page?path=/')).status,404);
 assert.equal((await page(a.cookie,'/api/pilot-page?path=../../.env')).status,404);
 const b=await session('b');assert.equal((await page(b.cookie,'/api/pilot-page?path=/')).status,404);
});
test('같은 계정의 A 저장 → B 조회·수정 → A 재조회와 기록 수 보존',async()=>{
 const ctx={name:names.a,memberId:ids.a,dept:'장년회',today:'2026-11-14',targets:[],overview:{people:[]}};
 const f=emptyActivity(ctx);Object.assign(f,{roles:['교사'],items:['만남1'],activityItem:'만남1',targetName:'가짜시범대상',todayWork:'A에서 저장',nextWork:'다음 만남',reaction:'대화',targetStage:'친분'});normalizeActivity(f,ctx);
 const payload=activityPayload(f,ctx),created=await api('submitActivity',payload,'a');assert.equal(created.body.ok,true,JSON.stringify(created));const id=created.body.id;assert.ok(id);
 const count=sql('select count(*) from activities');const first=await api('getMyActivity',{id},'a');assert.equal(first.body.row.todayWork,'A에서 저장');
 assert.equal((await change('assign',[ids.a])).body.ok,true);assert.equal((await session('a')).body.site,'B');assert.deepEqual((await api('getMyActivity',{id},'a')).body,first.body);
 const form=editActivity(first.body.row,ctx);form.todayWork='B에서 수정';const updated=await api('updateActivity',activityPayload(form,ctx),'a');assert.equal(updated.body.ok,true,JSON.stringify(updated));
 assert.equal((await change('remove',[ids.a])).body.ok,true);assert.equal((await session('a')).body.site,'A');assert.equal((await api('getMyActivity',{id},'a')).body.row.todayWork,'B에서 수정');assert.equal(sql('select count(*) from activities'),count);
 assert.equal((await api('getMyActivity',{id},'b')).status,404,'배정은 타인 자료 접근 권한이 아니다');
});
test('동시 배정 충돌 한 번만 저장, 감사 실패면 배정도 취소',async()=>{
 const s=await state(),body={operation:'assign',targetIds:[ids.a],expectedVersion:s.policy.version,reason:'가짜 동시 변경',confirmed:true};
 const results=await Promise.all(Array.from({length:4},()=>api('savePilotAdmin',body)));assert.equal(results.filter(r=>r.body.ok).length,1);assert.equal(results.filter(r=>r.body.stale).length,3);
 const before=sql("select jsonb_build_object('policy',(select to_jsonb(t) from site_pilot_policy t),'members',(select jsonb_agg(to_jsonb(t) order by nid) from site_pilot_members t),'audit',(select count(*) from site_pilot_changes))");
 sql('alter table site_pilot_changes add constraint pilot_test_fail check(false) not valid');
 try{assert.equal((await change('stop')).status,503);}finally{sql('alter table site_pilot_changes drop constraint pilot_test_fail');}
 assert.equal(sql("select jsonb_build_object('policy',(select to_jsonb(t) from site_pilot_policy t),'members',(select jsonb_agg(to_jsonb(t) order by nid) from site_pilot_members t),'audit',(select count(*) from site_pilot_changes))"),before);
});
test('전체 A 복귀는 선택과 기록을 보존, 재개·개별 해제 즉시 다음 조회 반영',async()=>{
 const count=sql('select count(*) from activities'),before=(await state()).selectedCount,bCookie=(await session('b')).cookie;
 assert.equal((await change('stop')).body.ok,true);assert.equal((await session('a')).body.site,'A');assert.equal((await session('b')).body.site,'A');assert.match((await page(bCookie)).html,/data-site="A"/);assert.equal((await state()).selectedCount,before);assert.equal(sql('select count(*) from activities'),count);
 assert.equal((await change('start')).body.ok,true);assert.equal((await session('b')).body.site,'B');
 assert.equal((await change('remove',[ids.b])).body.ok,true);assert.equal((await session('b')).body.site,'A');
});
test('PIN 회수 뒤에는 이전 화면 선택 쿠키로 재진입 불가',async()=>{
 const before=sql(`select ver from member_pins where nid='${ids.a}'`),cookie=(await session('a')).cookie;
 try{sql(`update member_pins set ver='pilot-revoked' where nid='${ids.a}'`);assert.equal((await session('a')).status,401);assert.doesNotMatch((await page(cookie)).html,/<base href="\/">/);}finally{sql(`update member_pins set ver='${before}' where nid='${ids.a}'`);}
});
test('배정 표·RPC 익명/일반 권한 없음 및 기존 검증 DB 전체 보존',async()=>{
 const violations=sql("select count(*) from (select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'site_pilot_%' and c.relkind='r' and (not c.relrowsecurity or has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') or has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) union all select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'site_pilot_%' and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))) q");assert.equal(violations,'0');
 const setup=JSON.parse(readFileSync(new URL('../../artifacts/pilot-20261114/setup.json',import.meta.url),'utf8'));
 for(const [table,hash]of Object.entries(setup.sourceTableHashes))assert.equal(sql(`select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]')::text) from public."${table}" x`,setup.base),hash,table);
 writeFileSync(new URL('../../artifacts/pilot-20261114/preserved.json',import.meta.url),JSON.stringify({originalTables:Object.keys(setup.sourceTableHashes).length,unchanged:true,productionChanged:false}));
});
