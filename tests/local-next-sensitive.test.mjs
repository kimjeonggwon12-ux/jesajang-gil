// 고정 격리 DB만 사용. 운영 자료·외부 발송은 사용하지 않는다.
import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import {seed,sql,api,login,ids,jwt,quote} from './helpers/local-db.mjs';
let evangel,education,member;
const items=()=>[{memberId:ids.other,prevTier:'활동교사',newTier:'정교사',reason:'가짜 검토'}];
const snapshot=()=>sql("select jsonb_build_object('teachers',(select jsonb_agg(to_jsonb(t) order by member_id) from teachers t),'history',(select jsonb_agg(to_jsonb(h) order by id) from tier_history h),'audit',(select jsonb_agg(to_jsonb(r) order by id) from roster_changes r))");
const preview=async(list=items())=>(await api('previewTierChange',{items:list},evangel)).body;
const save=async(list=items(),review)=>(await api('bulkChangeTier',{items:list,review:review||(await preview(list)).review,confirmed:true},evangel));
const rpc=async(name,p)=>{const r=await fetch('http://127.0.0.1:58432/rpc/'+name,{method:'POST',headers:{authorization:'Bearer '+jwt('service_role'),'content-type':'application/json'},body:JSON.stringify({p})});return {status:r.status,body:await r.json()};};
const identity=()=>JSON.parse(sql(`select jsonb_build_object('actorId','${ids.admin}','actorNid','${ids.admin}','actorName','테스트교육','actorVer',(select ver from member_pins where nid='${ids.admin}'),'actorState',jsonb_build_object('teacher',(select jsonb_build_array(member_id,name,dept,position) from teachers where nid='${ids.admin}'),'admins',(select jsonb_agg(jsonb_build_array(id,member_id,name,dept,position) order by id) from admins where nid='${ids.admin}'))) `));
beforeEach(async()=>{seed();sql('truncate tier_history,alert_log restart identity');[evangel,education,member]=await Promise.all([[ids.evangel,'테스트전도','전도부'],[ids.admin,'테스트교육','청년회'],[ids.member,'테스트교사','청년회']].map(async([id,name,dept])=>(await login(id,name,'582946',dept)).body.token));assert.ok(evangel&&education&&member);});
test('검토는 읽기만 하고 실제 이름·전후 등급·제외 대상을 보여준다',async()=>{
 const before=snapshot(),p=await preview([...items(),{memberId:ids.member,prevTier:'기타',newTier:'정교사'}]);
 assert.equal(p.changed.length,1);assert.equal(p.changed[0].name,'테스트대상');assert.equal(p.changed[0].prevTier,'활동교사');assert.equal(p.failed.length,1);assert.equal(snapshot(),before);
});
test('전도만 검토·저장 가능하며 미인증·교육·일반·요청자 사칭은 거절한다',async()=>{
 const before=snapshot();for(const action of ['previewTierChange','bulkChangeTier']){
  assert.equal((await api(action,{items:items()})).status,401);
  for(const token of [education,member])assert.equal((await api(action,{items:items()},token)).status,403);
  assert.equal((await api(action,{items:items(),memberId:ids.evangel},member)).status,403);
 }assert.equal(snapshot(),before);
});
test('검토·명시 확인·같은 대상/사유가 필요하며 이력의 승인자는 서버가 정한다',async()=>{
 const list=items(),p=await preview(list),before=snapshot();
 for(const data of [{items:list},{items:list,review:p.review},{items:list,confirmed:true},{items:[{...list[0],reason:'교체'}],review:p.review,confirmed:true}])assert.ok((await api('bulkChangeTier',data,evangel)).body.error);
 assert.equal(snapshot(),before);
 const r=await api('bulkChangeTier',{items:list,review:p.review,confirmed:true,approverName:'위조'},evangel);assert.equal(r.body.ok,true,JSON.stringify(r));
 assert.equal(sql('select approver1 from tier_history'),'전도부 테스트전도');assert.equal(sql("select kind from roster_changes"),'등급 일괄 변경');
 const log=(await api('getRosterLog',{},education)).body;assert.ok(log.rows.length);assert.ok(!JSON.stringify(log).includes(ids.other),'감사 화면도 남의 고유번호를 가린다');
 assert.ok(!JSON.stringify(log).includes('historyId'));assert.ok(!JSON.stringify(log).includes('revision'));
 assert.equal((await save(list,p.review)).body.stale,true);assert.equal(sql('select count(*) from tier_history'),'1');
});
test('등급/이름/이력 변경 후 오래 열린 검토는 거절하고 아직 바뀌지 않은 항목만 재검토한다',async()=>{
 const list=[...items(),{memberId:ids.member,prevTier:'활동교사',newTier:'우수교사'}],p=await preview(list);
 sql(`update teachers set tier='휴교사' where nid='${ids.other}'`);assert.equal((await save(list,p.review)).body.stale,true);
 const fresh=await preview(list);assert.equal(fresh.changed.length,1);assert.equal(fresh.failed.length,1);
 assert.equal((await save(list,fresh.review)).body.changed.length,1);assert.equal(sql(`select tier from teachers where nid='${ids.other}'`),'휴교사');
 const list2=[{memberId:ids.other,prevTier:'휴교사',newTier:'정교사'}],p2=await preview(list2);
 sql(`insert into tier_history(member_id,prev_tier,new_tier)values('${ids.other}','휴교사','휴교사')`);assert.equal((await save(list2,p2.review)).body.stale,true);
 const p3=await preview(list2);sql(`update teachers set name='가짜 이름 변경' where nid='${ids.other}'`);assert.equal((await save(list2,p3.review)).body.stale,true);
});
test('중복 선택·중복 정규화 명단·빈 입력·500명 초과를 처리하고 선택하지 않은 대상은 바꾸지 않는다',async()=>{
 for(const list of [[],null,[...items(),...items()],Array.from({length:501},()=>items()[0])])assert.ok((await preview(list)).error);
 sql(`insert into teachers(member_id,name,tier) values('0${ids.other}','가짜 중복','활동교사')`);
 const p=await preview();assert.equal(p.changed.length,0);assert.match(p.failed[0].error,/중복/);assert.ok((await save(items(),p.review)).body.error);
});
test('8개 동시 확정은 한 번만 반영하고 등급·개별 이력·작업 이력을 모두 남긴다',async()=>{
 const p=await preview();const rs=await Promise.all(Array.from({length:8},()=>save(items(),p.review)));
 assert.equal(rs.filter(r=>r.body.ok).length,1,JSON.stringify(rs));assert.equal(rs.filter(r=>r.body.stale).length,7);assert.equal(sql('select count(*) from tier_history'),'1');assert.equal(sql('select count(*) from roster_changes'),'1');
});
test('두 종류 감사 저장 실패에서 여러 대상 등급과 이력이 전부 원상 유지된다',async()=>{
 const list=[...items(),{memberId:ids.member,prevTier:'활동교사',newTier:'우수교사'}];
 for(const table of ['tier_history','roster_changes']){
  const p=await preview(list),before=snapshot();sql(`alter table ${table} add constraint local_sensitive_fail check(false) not valid`);
  try{const r=await save(list,p.review);assert.equal(r.status,503,JSON.stringify(r));assert.equal(snapshot(),before);}
  finally{sql(`alter table ${table} drop constraint local_sensitive_fail`);}
 }
});
test('검토 후 전도 권한 또는 PIN 회수는 기존 로그인으로 저장할 수 없다',async()=>{
 const p=await preview();sql(`update teachers set dept='청년회' where nid='${ids.evangel}';delete from admins where nid='${ids.evangel}'`);assert.equal((await save(items(),p.review)).status,403);
 sql(`update teachers set dept='전도부' where nid='${ids.evangel}';update member_pins set ver='changed' where nid='${ids.evangel}'`);assert.equal((await save(items(),p.review)).status,401);assert.equal(sql('select count(*) from tier_history'),'0');
});
test('교육·전도 다운로드는 전체 원본 7명을 유지하고 일반 회원은 비밀번호를 알아도 거절한다',async()=>{
 assert.equal((await api('exportRosterSheet',{password:'local-only-export-password'},member)).status,403);
 for(const token of [education,evangel]){
  const r=(await api('exportRosterSheet',{password:'local-only-export-password',query:'없는 이름',limit:1},token)).body;assert.equal(r.ok,true,JSON.stringify(r));
  const book=XLSX.read(Buffer.from(r.base64,'base64'),{type:'buffer'});assert.equal(XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1}).length,8);
 }
 const logs=JSON.parse(sql('select jsonb_agg(to_jsonb(a)) from alert_log a'));assert.equal(logs.length,2);assert.ok(logs.every(l=>l.ok&&l.summary.includes('파일 준비')&&l.summary.includes('"people":7')));assert.ok(logs.every(l=>!l.summary.includes('password')));
});
test('한 담당자의 5번 실패와 과거 공용 잠금은 다른 담당자의 다운로드를 막지 않는다',async()=>{
 sql("insert into alert_log(dedup_key,kind,ok)select 'exportFail:'||timezone('Asia/Seoul',now())::date::text,'명단엑셀',false from generate_series(1,5)");
 for(let n=0;n<5;n++)assert.match((await api('exportRosterSheet',{password:'wrong'},evangel)).body.error,/비밀번호/);
 assert.match((await api('exportRosterSheet',{password:'local-only-export-password'},evangel)).body.error,/잠겼/);
 assert.equal((await api('exportRosterSheet',{password:'local-only-export-password'},education)).body.ok,true);
 assert.equal(sql("select count(*) from alert_log where dedup_key like 'exportFail:v2:%'"),'5');
});
test('동시 12번 오입력도 실패 한도를 넘기지 않으며 네 다운로드 경로가 한 계정의 한도를 공유한다',async()=>{
 const actions=['exportRosterSheet','exportTeacherList','exportNonParticipants','exportCalendarAttendees'];
 const rs=await Promise.all(Array.from({length:12},(_,i)=>api(actions[i%4],{password:'wrong'},education)));
 assert.ok(rs.every(r=>r.body.error),JSON.stringify(rs));assert.equal(sql("select count(*) from alert_log where dedup_key like 'exportFail:v2:%'"),'5');
 for(const action of actions)assert.match((await api(action,{password:'local-only-export-password'},education)).body.error,/잠겼/);
});
test('파일 감사 실패는 파일 본문을 반환하지 않는다',async()=>{
 sql('alter table alert_log add constraint local_export_fail check(not ok) not valid');
 try{const r=await api('exportRosterSheet',{password:'local-only-export-password'},education);assert.equal(r.status,503,JSON.stringify(r));assert.equal(r.body.base64,undefined);assert.equal(sql('select count(*) from alert_log'),'0');}
 finally{sql('alter table alert_log drop constraint local_export_fail');}
});
test('파일 준비 직전 실제 DB 검증은 역할/PIN 변경을 모두 거절한다',async()=>{
 for(const kind of ['role','pin']){
  const p={...identity(),stage:'ready',action:'exportRosterSheet',passwordOk:true,summary:'가짜 파일'};
  if(kind==='role')sql(`update admins set position='다른 직책' where nid='${ids.admin}'`);else sql(`update member_pins set ver='changed' where nid='${ids.admin}'`);
  const r=await rpc('teacher_export_guard',p);assert.equal(r.body.stale,true,JSON.stringify(r));assert.equal(sql('select count(*) from alert_log'),'0');
 }
});
test('새 함수는 서비스 전용 invoker이며 일반 DB 역할의 직접 호출은 거절한다',async()=>{
 for(const name of ['sensitive_actor_valid','tier_change_state','tier_change_apply','teacher_export_guard']){
  assert.equal(sql(`select prosecdef from pg_proc where proname=${quote(name)}`),'f');
  for(const role of ['anon','authenticated']){
   const r=await fetch('http://127.0.0.1:58432/rpc/'+name,{method:'POST',headers:{authorization:'Bearer '+jwt(role),'content-type':'application/json'},body:JSON.stringify(name==='tier_change_state'?{p_nids:[ids.other]}:{p:{}})});assert.ok([401,403].includes(r.status),name+' '+r.status);
  }
 }
});
