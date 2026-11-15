import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {seedAccess} from './helpers/access-fixture.mjs';
import {sql,ids,PIN,jwt} from './helpers/local-db.mjs';
const base='http://127.0.0.1:58434';
async function api(action,body={},token){const r=await fetch(base+'/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...body,...(token?{_tk:token}:{})})});return {status:r.status,body:await r.json()};}
const login=async(id,name)=>(await api('verifyLogin',{memberId:id,name,dept:'청년회',pin:PIN})).body.token;
let admin,coach,member;
beforeEach(async()=>{seedAccess();admin=await login(ids.admin,'테스트교육');coach=await login(ids.coach,'테스트교관');member=await login(ids.member,'테스트교사');assert.ok(admin&&coach&&member);});
const person=async(query='테스트교관')=>(await api('searchRoster',{query},admin)).body.rows[0];
const change=(p,index,on=true,extra={})=>({targetId:p.memberId,assignmentId:index==='new'?'new':p.admins[index].assignmentId,expectedAdmins:p.admins,confirmed:true,on,admin:index==='new'?{name:p.name,dept:'부녀회',region:'3지역',position:'교관',phone:''}:p.admins[index],...extra});
const snapshot=()=>sql(`select jsonb_agg(to_jsonb(a) order by id) from admins a where nid='${ids.coach}'`);
const audit=()=>JSON.parse(sql("select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') from roster_changes r where kind like '관리자%'")||'[]');

test('검색은 모든 겸직을 id 순서로 반환하며 첫 보직 호환 필드와 교사 부서를 구분한다',async()=>{
 const p=await person();assert.equal(p.dept,'청년회');assert.deepEqual(p.admins.map(a=>[a.dept,a.region,a.position]),[['청년회','1지역','복음방교관'],['장년회','2지역','지역장']]);
 const {assignmentId,...first}=p.admins[0];assert.ok(assignmentId);assert.deepEqual(p.admin,first);assert.match(p.memberId,/^r_/);assert.ok(!JSON.stringify(p).includes(ids.coach));
 sql(`delete from teachers where nid='${ids.coach}'`);const adminOnly=await person();assert.equal(adminOnly.inRoster,false);assert.equal(adminOnly.admins.length,2);
});
test('두 번째 보직만 수정하고 첫 보직·교사 부서와 감사 기록의 보직 식별자를 보존한다',async()=>{
 const p=await person(),first=JSON.parse(snapshot())[0];
 const r=await api('setAdminMember',change(p,1,true,{admin:{...p.admins[1],region:'3지역'}}),admin);assert.equal(r.body.ok,true,JSON.stringify(r));
 const after=JSON.parse(snapshot());assert.deepEqual(after[0],first);assert.equal(after[1].dept,'장년회');assert.equal(after[1].region,'3지역');assert.equal(sql(`select dept from teachers where nid='${ids.coach}'`),'청년회');
 const [log]=audit();assert.equal(log.actor_name,'테스트교육');assert.equal(log.before.assignmentId,p.admins[1].assignmentId);assert.equal(log.before.region,'2지역');assert.equal(log.after.region,'3지역');
 const response=(await api('decideCenterReferral',{ids:[1,2,3,4],decision:'승인'},coach)).body;assert.equal(response.done,1);assert.equal(response.skipped,3);
});
test('선택한 겸직만 해제하고 남은 보직의 권한은 유지하며 회수한 범위는 즉시 거절한다',async()=>{
 const p=await person();assert.equal((await api('setAdminMember',change(p,1,false),admin)).body.ok,true);
 assert.equal(JSON.parse(snapshot()).length,1);assert.equal(audit()[0].after,null);assert.equal(audit()[0].before.assignmentId,p.admins[1].assignmentId);
 const response=(await api('decideCenterReferral',{ids:[1,2,3,4],decision:'승인'},coach)).body;assert.equal(response.done,1);assert.equal(response.skipped,3);
 assert.equal(sql('select string_agg(status,\',\' order by id) from center_referrals'),'승인,요청,요청,요청');
});
test('새 겸직 추가와 중복 거절은 기존 보직을 바꾸지 않는다',async()=>{
 let p=await person();const before=JSON.parse(snapshot());let r=await api('setAdminMember',change(p,'new'),admin);assert.equal(r.body.created,true,JSON.stringify(r));
 assert.deepEqual(JSON.parse(snapshot()).slice(0,2),before);p=await person();r=await api('setAdminMember',change(p,'new'),admin);assert.ok(r.body.error);assert.equal(JSON.parse(snapshot()).length,3);assert.equal(audit().length,1);
});
test('구형 요청은 겸직을 임의 변경·전체 해제하지 않고 단일 보직의 기존 호출은 유지한다',async()=>{
 const p=await person(),before=snapshot();for(const on of [true,false])assert.match((await api('setAdminMember',{targetId:p.memberId,on,admin:{...p.admin,region:'9지역'}},admin)).body.error,/겸직/);
 assert.equal(snapshot(),before);assert.equal(audit().length,0);
 sql(`delete from admins where nid='${ids.coach}' and dept='장년회'`);
 assert.equal((await api('setAdminMember',{targetId:p.memberId,on:true,admin:{...p.admin,region:'9지역'}},admin)).body.ok,true);
 assert.equal((await api('setAdminMember',{targetId:p.memberId,on:false},admin)).body.ok,true);assert.equal(JSON.parse(snapshot()||'null'),null);
});
test('미확인·타인 보직 식별자·일반 계정·사칭·권한 회수·오래된 전체 겸직 목록을 거절한다',async()=>{
 const p=await person(),before=snapshot();for(const patch of [{confirmed:false},{assignmentId:999999},{assignmentId:'3'},{assignmentId:(await person('테스트교육')).admins[0].assignmentId}])assert.ok((await api('setAdminMember',change(p,0,true,patch),admin)).body.error);
 assert.equal((await api('setAdminMember',change(p,0),member)).body.error,'명단 관리는 교육부·전도부 담당만 할 수 있어요.');
 assert.equal((await api('setAdminMember',{...change(p,0),memberId:ids.admin},member)).status,403);assert.equal((await api('setAdminMember',change(p,0))).status,401);assert.equal(snapshot(),before);
 sql(`update admins set phone='01000000044' where nid='${ids.coach}' and dept='장년회'`);assert.equal((await api('setAdminMember',change(p,0),admin)).body.stale,true);
 sql(`delete from admins where nid='${ids.admin}'`);assert.ok((await api('setAdminMember',change(p,0),admin)).body.error);
 assert.equal(audit().length,0);
});
test('동시 검토 저장 여덟 건은 한 건만 반영하고 감사 실패는 추가·수정·해제를 모두 취소한다',async()=>{
 let p=await person();const request=change(p,1,true,{admin:{...p.admins[1],region:'4지역'}});
 const rs=await Promise.all(Array.from({length:8},()=>api('setAdminMember',request,admin)));assert.equal(rs.filter(r=>r.body.ok).length,1);assert.equal(rs.filter(r=>r.body.stale).length,7);assert.equal(audit().length,1);
 p=await person();const before=snapshot();sql("alter table roster_changes add constraint local_admin_audit_failure check(kind not like '관리자%') not valid");
 try {for(const request of [change(p,'new'),change(p,1,true,{admin:{...p.admins[1],region:'5지역'}}),change(p,1,false)]){const r=await api('setAdminMember',request,admin);assert.equal(r.status,503,JSON.stringify(r));assert.equal(snapshot(),before);}}
 finally {sql('alter table roster_changes drop constraint local_admin_audit_failure');}
 assert.equal(audit().length,1);
});
test('실제 DB 함수는 invoker·비공개이고 조회 후 담당자 권한이 바뀌면 저장하지 않는다',async()=>{
 assert.equal(sql("select prosecdef::text||'|'||array_to_string(proconfig,',') from pg_proc where proname='admin_assignment_apply'"),'false|search_path="",lock_timeout=3s,statement_timeout=10s');
 for(const role of ['anon','authenticated']){const r=await fetch('http://127.0.0.1:58432/rpc/admin_assignment_apply',{method:'POST',headers:{Authorization:'Bearer '+jwt(role),'content-type':'application/json'},body:JSON.stringify({p:{}})});assert.ok([401,403].includes(r.status));}
 const p=await person(),before=snapshot();
 const actorState=JSON.parse(sql(`select jsonb_build_object('teacher',(select jsonb_build_array(member_id,name,dept,position) from teachers where nid='${ids.admin}'),'admins',(select jsonb_agg(jsonb_build_array(id,member_id,name,dept,position) order by id) from admins where nid='${ids.admin}'))`));
 sql(`update admins set dept='청년회',position='서기' where nid='${ids.admin}'`);
 const r=await fetch('http://127.0.0.1:58432/rpc/admin_assignment_apply',{method:'POST',headers:{Authorization:'Bearer '+jwt('service_role'),'content-type':'application/json'},body:JSON.stringify({p:{nid:ids.coach,memberId:ids.coach,on:false,assignmentId:p.admins[0].assignmentId,expected:p.admins,fields:{},actorId:ids.admin,actorName:'테스트교육',actorNid:ids.admin,actorState}})});
 assert.equal((await r.json()).stale,true);assert.equal(snapshot(),before);assert.equal(audit().length,0);
});
