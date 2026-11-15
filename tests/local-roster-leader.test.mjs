import {test,beforeEach} from 'node:test';import assert from 'node:assert/strict';
import {seed,ids,sql,api,login,jwt,quote} from './helpers/local-db.mjs';
let education,member,evangel;
const target=()=>JSON.parse(sql(`select jsonb_build_object('name',name,'dept',dept,'region',region,'position',position) from teachers where nid='${ids.other}'`));
const snapshot=()=>sql("select jsonb_build_array((select jsonb_agg(to_jsonb(t) order by member_id) from teachers t),(select jsonb_agg(to_jsonb(t) order by id) from roster_changes t))");
async function prepare(patch={},token=education){const expected=target(),body={memberId:ids.other,...expected,position:'지역장',expected,...patch};const r=await api('previewRosterLeader',body,token);assert.equal(r.body.ok,true,JSON.stringify(r));return {body:{...body,review:r.body.review,confirmed:true},preview:r.body};}
const apply=(r,token=education)=>api('upsertRosterLeader',r.body,token);
beforeEach(async()=>{seed();education=(await login(ids.admin,'테스트교육')).body.token;member=(await login()).body.token;evangel=(await login(ids.evangel,'테스트전도',undefined,'전도부')).body.token;assert.ok(education&&member&&evangel);});
test('직책 검토는 읽기 전용이며 담당자와 대상은 분리하고 원본 번호/내부 상태는 숨긴다',async()=>{
 const before=snapshot(),r=await prepare();assert.equal(snapshot(),before);assert.equal(r.preview.before.position,'');assert.equal(r.preview.after.position,'지역장');assert.doesNotMatch(JSON.stringify(r.preview),/9900000|actorVer|expected|nid/);
 const saved=await apply(r);assert.equal(saved.body.ok,true);assert.match(saved.body.memberId,/^r_/);assert.equal(sql(`select position from teachers where nid='${ids.other}'`),'지역장');assert.equal(sql('select actor_name from roster_changes'),'테스트교육');
 assert.equal((await api('checkAdmin',{},(await login(ids.other,'테스트대상')).body.token)).body.isAdmin,true);
 assert.equal((await apply(await prepare({position:''},evangel),evangel)).body.ok,true);assert.equal(sql('select count(*) from roster_changes'),'2');
});
test('직책 외 실적·등급·보직은 보존하고 빈 부서/지역은 기존 값을 유지한다',async()=>{
 sql(`update teachers set tier='정교사',reg_leads=9,note='보존',affiliation='소속' where nid='${ids.other}'`);
 const protectedBefore=sql("select jsonb_build_array((select jsonb_agg(to_jsonb(a) order by id) from admins a),(select jsonb_agg(to_jsonb(p) order by nid) from member_pins p))");
 assert.equal((await apply(await prepare({dept:'',region:'',tier:'우수교사',reg_leads:100}))).body.ok,true);
 assert.equal(sql(`select tier||':'||reg_leads||':'||dept||':'||region||':'||note||':'||affiliation from teachers where nid='${ids.other}'`),'정교사:9:청년회:1지역:보존:소속');
 assert.equal(sql("select jsonb_build_array((select jsonb_agg(to_jsonb(a) order by id) from admins a),(select jsonb_agg(to_jsonb(p) order by nid) from member_pins p))"),protectedBefore);
 assert.equal((await apply(await prepare())).body.unchanged,true);assert.equal(sql('select count(*) from roster_changes'),'1');
});
test('일반/미인증·확인 없는 구형 요청·변조·다른 담당자의 검토 재사용은 거절한다',async()=>{
 const r=await prepare(),before=snapshot();for(const action of ['previewRosterLeader','upsertRosterLeader']){assert.equal((await api(action,r.body)).status,401);assert.equal((await api(action,r.body,member)).status,403);}
 for(const patch of [{review:''},{confirmed:false},{review:'bad'},{position:'회장'}])assert.ok((await api('upsertRosterLeader',{...r.body,...patch},education)).body.error);
 assert.ok((await apply(r,evangel)).body.error);assert.ok((await api('previewRosterLeader',{...r.body,expected:undefined},education)).body.error);assert.ok((await api('previewRosterLeader',{...r.body,position:'임의직책'},education)).body.error);assert.equal(snapshot(),before);
});
test('화면 이후 직책/지역 변경·검토 뒤 숨은 실적 변경·삭제를 덮어쓰거나 재생성하지 않는다',async()=>{
 const r=await prepare();sql(`update teachers set region='2지역' where nid='${ids.other}'`);assert.equal((await apply(r)).body.stale,true);assert.equal((await api('previewRosterLeader',r.body,education)).body.stale,true);
 const next=await prepare();sql(`update teachers set reg_leads=3 where nid='${ids.other}'`);assert.equal((await apply(next)).body.stale,true);
 const last=await prepare();sql(`delete from teachers where nid='${ids.other}'`);assert.equal((await apply(last)).body.stale,true);assert.equal(sql(`select count(*) from teachers where nid='${ids.other}'`),'0');assert.equal(sql('select count(*) from roster_changes'),'0');
});
test('감사 실패 시 직책과 이력 모두 롤백하고 복구 뒤 재검토하여 저장한다',async()=>{
 const r=await prepare(),before=snapshot();sql('alter table roster_changes add constraint local_leader_failure check(false) not valid');
 try{assert.equal((await apply(r)).status,503);assert.equal(snapshot(),before);}finally{sql('alter table roster_changes drop constraint local_leader_failure');}
 assert.equal((await apply(await prepare())).body.ok,true);
});
test('동시 지정 8건은 하나만 반영하고 나머지는 오래된 검토로 거절한다',async()=>{
 const r=await prepare(),results=await Promise.all(Array.from({length:8},()=>apply(r)));assert.equal(results.filter(r=>r.body.ok).length,1);assert.equal(results.filter(r=>r.body.stale).length,7);assert.equal(sql('select count(*) from roster_changes'),'1');
});
test('새로 추가하려면 명시적 검토가 필요하고 번호 표기가 달라도 중복 추가하지 않는다',async()=>{
 const id='9900000000999',body={memberId:id,name:'가짜직책자',dept:'청년회',region:'2지역',position:'교관'};
 assert.equal((await api('previewRosterLeader',body,education)).body.stale,true);
 const plans=await Promise.all([id,'00'+id.slice(0,6)+'-'+id.slice(6)].map(async memberId=>{const data={...body,memberId,create:true},r=await api('previewRosterLeader',data,education);assert.equal(r.body.ok,true);return {body:{...data,review:r.body.review,confirmed:true}};}));
 const results=await Promise.all(plans.map(r=>apply(r)));assert.equal(results.filter(r=>r.body.ok).length,1);assert.equal(sql(`select count(*)||':'||min(tier) from teachers where nid='${id}'`),'1:활동교사');
});
test('이미 중복된 명단은 임의 첫 행을 수정하지 않는다',async()=>{
 const r=await prepare();sql(`insert into teachers(member_id,name,dept)values('00${ids.other}','중복','청년회')`);const before=snapshot();assert.match((await apply(r)).body.error,/중복/);assert.equal(snapshot(),before);
});
test('담당자 역할/PIN 회수와 본인 직책 해제 뒤 다음 요청부터 즉시 거절한다',async()=>{
 const r=await prepare();sql(`delete from admins where nid='${ids.admin}'`);assert.equal((await apply(r)).status,403);
 sql(`update teachers set position='교육부장' where nid='${ids.admin}'`);const own={memberId:ids.admin,name:'테스트교육',dept:'청년회',region:'1지역',position:'',expected:{name:'테스트교육',dept:'청년회',region:'1지역',position:'교육부장'}};
 const review=(await api('previewRosterLeader',own,education)).body.review;assert.ok(review);assert.equal((await api('upsertRosterLeader',{...own,review,confirmed:true},education)).body.ok,true);assert.equal((await api('checkAdmin',{},education)).body.permissions.canManageRoster,false);assert.equal((await apply(r)).status,403);
 sql(`update teachers set position='교육부장' where nid='${ids.admin}'`);const next=await prepare();sql(`update member_pins set ver='changed' where nid='${ids.admin}'`);assert.equal((await apply(next)).status,401);
});
test('API 검토 이후 DB 도착 전 변경도 재검사하며 공개 DB 역할로는 직접 실행할 수 없다',async()=>{
 const payload=()=>JSON.parse(sql(`select jsonb_build_object('create',false,'nid','${ids.other}','memberId','${ids.other}',
 'fields',jsonb_build_object('name','테스트대상','dept','청년회','region','1지역','position','지역장'),'expected',roster_member_state(array['${ids.other}']),
 'actorId','${ids.admin}','actorNid','${ids.admin}','actorName','테스트교육','actorVer',(select ver from member_pins where nid='${ids.admin}'),
 'actorState',jsonb_build_object('teacher',(select jsonb_build_array(member_id,name,dept,position) from teachers where nid='${ids.admin}'),
 'admins',(select jsonb_agg(jsonb_build_array(id,member_id,name,dept,position) order by id) from admins where nid='${ids.admin}'))) `));
 for(const change of [`update teachers set note='경합' where nid='${ids.other}'`,`update admins set position='교관' where nid='${ids.admin}'`,`update member_pins set ver='changed' where nid='${ids.admin}'`]){const p=payload();sql(change);assert.equal(JSON.parse(sql(`select roster_leader_apply(${quote(JSON.stringify(p))}::jsonb)`)).stale,true);}
 for(const role of ['anon','authenticated']){const res=await fetch('http://127.0.0.1:58432/rpc/roster_leader_apply',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+jwt(role)},body:JSON.stringify({p:{}})});assert.equal(res.status,role==='anon'?401:403);assert.equal((await res.json()).code,'42501');}
 assert.equal(sql("select prosecdef::text||':'||coalesce(array_to_string(proconfig,','),'') from pg_proc where oid='public.roster_leader_apply(jsonb)'::regprocedure"),'false:search_path="",lock_timeout=3s,statement_timeout=10s');assert.equal(sql('select count(*) from roster_changes'),'0');
});
