import {test,beforeEach} from 'node:test';import assert from 'node:assert/strict';
import {seed,ids,sql,api,login,jwt,quote} from './helpers/local-db.mjs';
let education,member,evangel;
const newId='9900000000999',fields={memberId:newId,name:'가짜새교사',dept:'청년회',region:'2지역',affiliation:'구역',position:'교사',note:'검증',isNew:true};
const rows=table=>sql(`select coalesce(jsonb_agg(to_jsonb(t) order by ${table==='teachers'?'member_id':'id'}),'[]') from ${table} t`);
const snapshot=()=>JSON.stringify([rows('teachers'),rows('roster_changes')]);
const person=async(id=ids.other,token=education)=>(await api('searchRoster',{query:id},token)).body.rows[0];
async function prepare(mode='update',id=ids.other,patch={},token=education){
 const p=mode==='create'?null:await person(id,token);
 const body=mode==='remove'?{targetId:id,expectedRevision:p?.rosterRevision}:{member:{...(mode==='create'?fields:p),memberId:id,isNew:mode==='create',...patch},expectedRevision:p?.rosterRevision};
 const r=await api('previewRosterChange',{...body,mode},token);assert.equal(r.body.ok,true,JSON.stringify(r));
 return {action:mode==='remove'?'removeRosterMember':'saveRosterMember',body:{...body,review:r.body.review,confirmed:true},preview:r.body};
}
const apply=(request,token=education)=>api(request.action,request.body,token);
beforeEach(async()=>{seed();sql('truncate activities,attend_records,tier_history restart identity');education=(await login(ids.admin,'테스트교육')).body.token;member=(await login()).body.token;evangel=(await login(ids.evangel,'테스트전도',undefined,'전도부')).body.token;assert.ok(education&&member&&evangel);});

test('서버 검토는 읽기 전용이며 표시값과 버전을 함께 읽고 내부 행/번호를 노출하지 않는다',async()=>{
 const before=snapshot(),p=await person(),request=await prepare('update',ids.other,{region:'3지역'});
 assert.match(p.rosterRevision,/^[a-f0-9]{32}$/);assert.equal(request.preview.before.region,'1지역');assert.equal(request.preview.after.region,'3지역');assert.equal(snapshot(),before);
 assert.doesNotMatch(JSON.stringify(request.preview),/"nid"|"expected"|"actorVer"|"request"|9900000000/);
 assert.doesNotMatch(JSON.stringify(p),/"nid"|"member_id"|9900000000005/);
});
test('교육과 전도 담당은 확인한 추가·수정을 저장하고 임의 등급·실적 입력은 적용하지 않는다',async()=>{
 const created=await apply(await prepare('create',newId,{tier:'우수교사',reg_leads:999}));assert.equal(created.body.created,true);assert.equal(created.body.member.tier,'활동교사');
 const saved=await apply(await prepare('update',newId,{region:'3지역',tier:'우수교사',reg_leads:888},evangel),evangel);assert.equal(saved.body.ok,true);
 assert.equal(sql(`select tier||':'||reg_leads||':'||region from teachers where nid='${newId}'`),'활동교사:0:3지역');
 assert.equal(sql("select string_agg(actor_name,',' order by id) from roster_changes"),'테스트교육,테스트전도');
 const logs=(await api('getRosterLog',{},education)).body.rows;assert.ok(logs.every(row=>row.targetId.startsWith('r_')));assert.doesNotMatch(JSON.stringify(logs),/9900000000999/);
 const unchanged=await apply(await prepare('update',newId));assert.equal(unchanged.body.unchanged,true);assert.equal(sql('select count(*) from roster_changes'),'2');
});
test('확인 없는 구형 요청·검토값 변조·다른 담당자의 검토 재사용·일반 계정은 거절한다',async()=>{
 const p=await person(),r=await prepare('update',ids.other,{note:'수정'}),before=snapshot();
 for(const patch of [{review:''},{confirmed:false},{review:'wrong'},{member:{...r.body.member,note:'다른 변경'}}])assert.ok((await api(r.action,{...r.body,...patch},education)).body.error);
 assert.ok((await apply(r,evangel)).body.error);assert.ok((await api('removeRosterMember',{targetId:ids.other},education)).body.error);
 for(const action of ['previewRosterChange','saveRosterMember','removeRosterMember']){
  assert.equal((await api(action,{...r.body,mode:'update'},member)).body.error,'명단 관리는 교육부·전도부 담당만 할 수 있어요.');
  assert.equal((await api(action,{...r.body,mode:'update'})).status,401);
  assert.equal((await api(action,{...r.body,mode:'update',memberId:ids.admin},member)).status,403);
 }
 assert.equal(snapshot(),before);assert.equal(p.inRoster,true);
});
test('검색 뒤 바뀐 값과 검토 뒤 바뀐 등급·숨은 실적을 덮어쓰지 않는다',async()=>{
 const r=await prepare('update',ids.other,{region:'3지역'});
 sql(`update teachers set region='4지역' where nid='${ids.other}'`);
 assert.equal((await apply(r)).body.stale,true);
 assert.equal((await api('previewRosterChange',{...r.body,mode:'update'},education)).body.stale,true);
 for(const expression of ["tier='정교사'",'reg_leads=7']){
  const next=await prepare('update',ids.other,{note:'새 변경'});sql(`update teachers set ${expression} where nid='${ids.other}'`);assert.equal((await apply(next)).body.stale,true);
 }
 assert.equal(sql(`select region||':'||tier||':'||reg_leads from teachers where nid='${ids.other}'`),'4지역:정교사:7');assert.equal(sql('select count(*) from roster_changes'),'0');
});
test('추가·수정·삭제의 감사 실패는 명단과 감사 내용을 모두 되돌린다',async()=>{
 for(const [mode,id,patch] of [['create',newId,{}],['update',ids.other,{note:'바뀌면 안 됨'}],['remove',ids.other,{}]]){
  const request=await prepare(mode,id,patch),before=snapshot();sql('alter table roster_changes add constraint local_roster_failure check(false) not valid');
  try{const r=await apply(request);assert.equal(r.status,503);assert.equal(snapshot(),before);}finally{sql('alter table roster_changes drop constraint local_roster_failure');}
 }
 assert.equal((await apply(await prepare('update',ids.other,{note:'복구 확인'}))).body.ok,true);assert.equal(sql('select count(*) from roster_changes'),'1');
});
test('동시 수정 8건은 한 번만 저장되고 나머지는 오래된 확인으로 거절한다',async()=>{
 const r=await prepare('update',ids.other,{region:'3지역'}),results=await Promise.all(Array.from({length:8},()=>apply(r)));
 assert.equal(results.filter(r=>r.body.ok).length,1);assert.equal(results.filter(r=>r.body.stale).length,7);assert.equal(sql('select count(*) from roster_changes'),'1');
});
test('다른 번호 표기로 같은 사람을 동시에 추가해도 명단은 하나이며 서로 다른 신규 번호는 순서가 겹치지 않는다',async()=>{
 const a=await prepare('create',newId),b=await prepare('create','00'+newId.slice(0,6)+'-'+newId.slice(6));
 const results=await Promise.all([apply(a),apply(b)]);assert.equal(results.filter(r=>r.body.ok).length,1);assert.equal(sql(`select count(*) from teachers where nid='${newId}'`),'1');
 const c=await prepare('create','9900000000998'),d=await prepare('create','9900000000997');
 assert.ok((await Promise.all([apply(c),apply(d)])).every(r=>r.body.ok));assert.equal(sql("select count(distinct sort_order) from teachers where nid in ('9900000000999','9900000000998','9900000000997')"),'3');
});
test('이미 중복된 정규화 명단은 임의 수정·삭제하지 않는다',async()=>{
 const old=await prepare('update',ids.other,{note:'중복 변경'});sql(`insert into teachers(member_id,name,dept)values('00${ids.other}','중복','청년회')`);const before=snapshot();
 assert.match((await apply(old)).body.error,/중복/);for(const mode of ['update','remove'])assert.match((await api('previewRosterChange',{...old.body,mode,targetId:ids.other},education)).body.error,/중복/);assert.equal(snapshot(),before);
});
test('명단 삭제는 활동·출석·PIN·프로필·별도 관리자 보직을 그대로 두며 관리자 로그인은 유지된다',async()=>{
 sql(`insert into admins(member_id,name,dept,position)values('${ids.member}','테스트교사','청년회','교관');insert into activities(member_id,name,submitted_at)values('${ids.member}','테스트교사','2026-11-14');insert into attend_records(record_id,meeting_id,member_id,at)values('PRESERVE','MT390090','${ids.member}','2026-11-14')`);
 const protectedTables=['admins','activities','attend_records','member_pins','teacher_profiles'];
 const values=()=>protectedTables.map(table=>sql(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from ${table} t`));const before=values();
 const r=await prepare('remove',ids.member);assert.equal(r.preview.after,null);assert.equal((await apply(r)).body.ok,true);assert.deepEqual(values(),before);
 const found=await person(ids.member);assert.equal(found.inRoster,false);assert.equal(found.admin.position,'교관');assert.equal((await api('checkAdmin',{},member)).status,200);
 assert.equal(sql("select count(*) from roster_changes where kind='교사 삭제' and after is null"),'1');
});
test('별도 보직이 없는 교사를 삭제하면 기존 세션의 다음 인증 요청은 거절된다',async()=>{
 const targetToken=(await login(ids.other,'테스트대상')).body.token;
 assert.equal((await apply(await prepare('remove'))).body.ok,true);assert.equal((await api('getMyTierStatus',{},targetToken)).status,401);
 assert.equal(sql(`select count(*) from member_pins where nid='${ids.other}'`),'1');
});
test('확인 뒤 담당자 권한·PIN 회수는 저장하지 못한다',async()=>{
 const r=await prepare('update',ids.other,{region:'3지역'});sql(`delete from admins where nid='${ids.admin}'`);assert.ok((await apply(r)).body.error);
 sql(`insert into admins(member_id,name,dept,position)values('${ids.admin}','테스트교육','교육부','교육부장')`);
 const next=await prepare('update',ids.other,{region:'3지역'});sql(`update member_pins set ver='changed' where nid='${ids.admin}'`);assert.equal((await apply(next)).status,401);
 assert.equal(sql(`select region from teachers where nid='${ids.other}'`),'1지역');assert.equal(sql('select count(*) from roster_changes'),'0');
});
test('서버가 대조한 뒤 DB 함수에 도착하기 전의 상태·권한·PIN 변경도 거절한다',async()=>{
 const payload=()=>JSON.parse(sql(`select jsonb_build_object('mode','update','nid','${ids.other}','memberId','${ids.other}',
 'fields',jsonb_build_object('name','테스트대상','dept','청년회','region','3지역','affiliation','','position','','note',''),
 'expected',roster_member_state(array['${ids.other}']),'actorId','${ids.admin}','actorNid','${ids.admin}','actorName','테스트교육',
 'actorVer',(select ver from member_pins where nid='${ids.admin}'),'actorState',jsonb_build_object(
 'teacher',(select jsonb_build_array(member_id,name,dept,position) from teachers where nid='${ids.admin}'),
 'admins',(select jsonb_agg(jsonb_build_array(id,member_id,name,dept,position) order by id) from admins where nid='${ids.admin}'))) `));
 for(const change of [`update teachers set note='경합' where nid='${ids.other}'`,`update admins set position='교관' where nid='${ids.admin}'`,`update member_pins set ver='changed' where nid='${ids.admin}'`]){
  const p=payload();sql(change);const r=JSON.parse(sql(`select roster_member_apply(${quote(JSON.stringify(p))}::jsonb)`));assert.equal(r.stale,true);
 }
 assert.equal(sql(`select region from teachers where nid='${ids.other}'`),'1지역');assert.equal(sql('select count(*) from roster_changes'),'0');
});
test('조회/쓰기 함수는 비공개 invoker이고 일반 두 역할의 직접 호출을 거절한다',async()=>{
 for(const name of ['roster_member_state','roster_member_apply']){
  assert.equal(sql(`select prosecdef from pg_proc where proname=${quote(name)}`),'f');
  for(const role of ['anon','authenticated']){const r=await fetch('http://127.0.0.1:58432/rpc/'+name,{method:'POST',headers:{authorization:'Bearer '+jwt(role),'content-type':'application/json'},body:JSON.stringify(name==='roster_member_state'?{p_nids:[ids.other]}:{p:{}})});assert.ok([401,403].includes(r.status));}
 }
});
