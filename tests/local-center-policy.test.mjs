import {test,beforeEach} from 'node:test';import assert from 'node:assert/strict';
import {seedCenters} from './helpers/center-fixture.mjs';import {ids,sql,api,login,quote,jwt} from './helpers/local-db.mjs';import {OWNER} from './helpers/education-fixture.mjs';
let owner,education,coach,member,staff;
const ok=async(action,body={},token=owner)=>{const r=await api(action,body,token);assert.equal(r.status,200,action);assert.ok(!r.body.error,action+': '+r.body.error);return r.body;};
const denied=async(action,body={},token=owner)=>{const r=await api(action,body,token);assert.ok(r.status>=400||r.body.error,action);return r;};
const policy=()=>JSON.parse(sql('select to_jsonb(p) from center_approval_policy p where id=1'));
async function prepare(mode='role_scoped'){const p=await ok('getCenterPolicy'),body={mode,reason:'가짜 담당자 검토 확인',expectedVersion:p.policy.version},r=await ok('previewCenterPolicy',body);return {...body,review:r.review,confirmed:true};}
const change=async(mode='role_scoped')=>ok('saveCenterPolicy',await prepare(mode));
const desk=token=>ok('getCenterDesk',{},token);
const state=()=>sql("select jsonb_build_array((select to_jsonb(p) from center_approval_policy p),(select coalesce(jsonb_agg(to_jsonb(c) order by id),'[]') from center_policy_changes c))");
beforeEach(async()=>{seedCenters();sql(`insert into teachers(member_id,name,dept,region)values('${OWNER}','테스트앱관리','청년회','1지역');insert into member_pins(nid,pin_hash,salt,ver)select '${OWNER}',pin_hash,salt,'policy-owner' from member_pins where nid='${ids.member}';update center_referrals set request_note='비공개요청',hope_center='비공개희망',decide_note='비공개판단',send_note='비공개전달';`);[owner,education,coach,member,staff]=await Promise.all([[OWNER,'테스트앱관리'],[ids.admin,'테스트교육'],[ids.coach,'테스트교관'],[ids.member,'테스트교사'],[ids.other,'테스트대상']].map(async([id,name])=>(await login(id,name)).body.token));assert.ok(owner&&education&&coach&&member&&staff);});

test('기존 방식은 전체 승인을 유지하지만 담당 밖 서류·메모를 목록이나 상세로 받지 않는다',async()=>{
 const d=await desk(education);assert.equal(d.policy.mode,'legacy_global');assert.equal(d.me.approvalGlobal,true);assert.equal(d.rows.length,6);assert.equal(d.inbox.length,1);assert.ok(d.rows.every(r=>r.canReadDocument===false));assert.doesNotMatch(JSON.stringify(d),/비공개|가짜 상담|snapshot|9900000000/);
 await denied('getCenterReferral',{id:1},education);await denied('getCenterReferral',{id:5},education);assert.equal(sql('select center_read_at is null from center_referrals where id=5'),'t');
 assert.equal((await ok('decideCenterReferral',{ids:[1,2,3],decision:'반려',note:'가짜 반려'},education)).done,3);
 const after=await desk(education);assert.ok(after.rows.every(r=>r.decideNote===''));
});
test('직책별 방식의 다섯 부서 직책은 자기 부서만 승인하며 교사 직책/별도 보직을 모두 반영한다',async()=>{
 await change();sql(`delete from admins where nid='${ids.coach}'`);
 for(const position of ['회장','총무','총교관','서기','전도부장'])for(const source of ['teachers','admins']){
  sql(`update teachers set position='' where nid='${ids.coach}';delete from admins where nid='${ids.coach}';`);
  if(source==='teachers')sql(`update teachers set position=${quote(position)} where nid='${ids.coach}'`);else sql(`insert into admins(member_id,name,dept,region,position)values('${ids.coach}','테스트교관','청년회','',${quote(position)})`);
  const d=await desk(coach);assert.deepEqual(d.rows.map(r=>r.id),[6,5,4,1],position+' '+source);assert.equal(d.me.approvalGlobal,false);assert.equal(d.me.canDecide,true);
  sql("update center_referrals set status='요청' where id in (1,2,3)");assert.equal((await ok('decideCenterReferral',{ids:[1,2,3],decision:'승인'},coach)).done,1);
 }
});
test('지역 보직·겸직을 부서와 묶고 빈 지역·일반 교관·추가 전도 직책을 자동 승격하지 않는다',async()=>{
 await change();let d=await desk(coach);assert.deepEqual(d.rows.map(r=>r.id),[6,5,4,2,1]);assert.ok(!d.rows.some(r=>r.id===3));
 sql(`update admins set region='' where nid='${ids.coach}' and dept='청년회'`);d=await desk(coach);assert.deepEqual(d.rows.map(r=>r.id),[2]);await denied('getCenterReferral',{id:1},coach);
 sql(`delete from admins where nid='${ids.coach}';update teachers set position='교관' where nid='${ids.coach}'`);assert.equal((await desk(coach)).me.canDecide,false);
 sql(`update teachers set position='전도과장' where nid='${ids.coach}'`);assert.equal((await desk(coach)).me.canDecide,false);
 await change('legacy_global');assert.equal((await desk(coach)).me.approvalGlobal,true);
 assert.equal((await desk(owner)).me.canConfigure,true);await change();assert.equal((await desk(owner)).me.canDecide,false);
});
test('서류 담당은 승인 모드와 별개로 본인·확인된 부서/지역·전달받은 기수만 읽는다',async()=>{
 for(const mode of ['legacy_global','role_scoped']){
  if(policy().mode!==mode)await change(mode);
  assert.match(JSON.stringify(await ok('getCenterReferral',{id:1},member)),/가짜 상담/);
  assert.match(JSON.stringify(await ok('getCenterReferral',{id:1},coach)),/가짜 상담/);
  await denied('getCenterReferral',{id:3},coach);await denied('getCenterReferral',{id:1},staff);
  const r=await ok('getCenterReferral',{id:5},staff);assert.ok(r.row.centerReadAt);assert.equal((await ok('getCenterReferral',{id:5},staff)).row.centerReadAt,r.row.centerReadAt);
  await denied('getCenterReferral',{id:5},education);
 }
 sql("update centers set staff='[]' where id=1");await denied('getCenterReferral',{id:5},staff);
});
test('승인 기준 검토는 앱 관리자만 가능하고 읽기 전용이며 확인·근거·이력을 유지한다',async()=>{
 const before=state(),request=await prepare();assert.equal(state(),before);
 for(const token of [education,coach,member])for(const action of ['getCenterPolicy','previewCenterPolicy','saveCenterPolicy'])assert.equal((await api(action,request,token)).status,403);
 assert.equal((await api('saveCenterPolicy',request)).status,401);await denied('saveCenterPolicy',{...request,memberId:OWNER},education);
 for(const patch of [{confirmed:false},{review:''},{mode:'bad'},{reason:''},{reason:'다른 근거'}])await denied('saveCenterPolicy',{...request,...patch});assert.equal(state(),before);
 const saved=await ok('saveCenterPolicy',request);assert.equal(saved.version,2);assert.equal(policy().mode,'role_scoped');const d=await ok('getCenterPolicy');assert.equal(d.history.length,1);assert.equal(d.history[0].actor_name,'테스트앱관리');assert.doesNotMatch(JSON.stringify(d),/actor_id|actorVer|member_id/);
 assert.equal((await ok('saveCenterPolicy',await prepare())).unchanged,true);assert.equal(sql('select count(*) from center_policy_changes'),'1');
});
test('설정 감사 실패는 설정도 취소하고 오래된 확인·PIN 변경·동시 저장을 거절한다',async()=>{
 const request=await prepare(),before=state();sql('alter table center_policy_changes add constraint local_policy_failure check(false) not valid');
 try{assert.equal((await api('saveCenterPolicy',request,owner)).status,503);assert.equal(state(),before);}finally{sql('alter table center_policy_changes drop constraint local_policy_failure');}
 const results=await Promise.all(Array.from({length:8},()=>api('saveCenterPolicy',request,owner)));assert.equal(results.filter(r=>r.body.ok).length,1);assert.equal(results.filter(r=>r.body.stale).length,7);assert.equal(sql('select count(*) from center_policy_changes'),'1');
 const next=await prepare('legacy_global');sql(`update member_pins set ver='revoked' where nid='${OWNER}'`);assert.equal((await api('saveCenterPolicy',next,owner)).status,401);assert.equal(policy().mode,'role_scoped');
});
test('설정 전환 직후 전체 담당자의 새 요청을 막고 부서 범위 요청은 계속 처리한다',async()=>{
 assert.equal((await desk(education)).rows.length,6);await change();assert.equal((await desk(education)).rows.length,0);
 for(const [action,body]of [['decideCenterReferral',{ids:[1],decision:'승인'}],['sendToCenter',{ids:[4],centerId:1,cardDone:true}],['approveAndSend',{ids:[1],centerId:1,cardDone:true}],['reopenCenterReferral',{id:5}]])await denied(action,body,education);
 assert.equal((await ok('approveAndSend',{ids:[1,2,3],centerId:1,cardDone:true},coach)).done,2);
 await change('legacy_global');assert.equal((await ok('approveAndSend',{ids:[3],centerId:1,cardDone:true},education)).done,1);
});
test('DB 직전 정책·보직·기수 담당·PIN 변화도 이전 판정으로 저장/원문 열람하지 않는다',async()=>{
 const payload=()=>JSON.parse(sql(`select jsonb_build_object('operation','write','expected',(select jsonb_build_object('id',id,'status',status,'dept',dept,'region',region,'center_id',center_id,'teacher_nid',teacher_nid) from center_referrals where id=1),
 'patch',jsonb_build_object('status','승인'),'scopeState',center_scope_state('${ids.coach}'),'actorId','${ids.coach}','actorNid','${ids.coach}','actorName','테스트교관','actorVer',(select ver from member_pins where nid='${ids.coach}'),
 'actorState',jsonb_build_object('teacher',(select jsonb_build_array(member_id,name,dept,position) from teachers where nid='${ids.coach}'),
 'admins',(select jsonb_agg(jsonb_build_array(id,member_id,name,dept,position) order by id) from admins where nid='${ids.coach}'))) `));
 for(const statement of ["update center_approval_policy set mode='role_scoped',version=version+1",`update admins set region='3지역' where nid='${ids.coach}'`,"update centers set staff='[]' where id=1",`update member_pins set ver='revoked' where nid='${ids.coach}'`]){
  const p=payload();sql(statement);for(const operation of ['read','write']){const r=JSON.parse(sql(`select center_referral_apply(${quote(JSON.stringify({...p,operation}))}::jsonb)`));assert.equal(r.stale,true);assert.equal(r.row,undefined);}
 }
 assert.equal(sql("select status from center_referrals where id=1"),'요청');
});
test('상담 전체 원문 API는 본인과 담당 교관에게 전달된 요청만 반환한다',async()=>{
 sql(`insert into feedbacks(receipt_no,member_id,name,source,situation,ai_coach_text,status) values
 ('POL-SELF','${ids.admin}','테스트교육','AI셀프코칭','본인비공개','본인AI','완료'),
 ('POL-AI','${ids.member}','테스트교사','AI셀프코칭','전달안한비공개','비공개AI','완료'),
 ('POL-REQ','${ids.member}','테스트교사','교관요청','담당자비공개','','접수'),
 ('POL-ESC','${ids.member}','테스트교사','사람에스컬레이션','전달비공개','전달AI','접수');
 update teachers set dept='장년회',region='1지역' where nid='${ids.other}';
 insert into feedbacks(receipt_no,member_id,name,source,situation)values('POL-OTHER','${ids.other}','테스트대상','교관요청','다른부서비공개');`);
 assert.deepEqual((await ok('getAllFeedback',{},education)).rows.map(r=>r.receiptNo),['POL-SELF']);assert.deepEqual((await ok('getAllFeedback',{},coach)).rows.map(r=>r.receiptNo),['POL-REQ','POL-ESC']);
 const index=await ok('getFeedbackIndex',{},education);assert.equal(index.rows.length,5);assert.doesNotMatch(JSON.stringify(index),/비공개|situation|receiptNo|aiCoachText|handlerAnswer|name/);
 const snapshot=JSON.stringify(await ok('getOrgAiSnapshot',{},education));assert.doesNotMatch(snapshot,/비공개|본인AI|전달AI|비공개AI/);
 sql(`delete from admins where nid='${ids.coach}'`);await denied('getAllFeedback',{},coach);assert.ok((await ok('getHistory',{},member)).rows.some(r=>r.receiptNo==='POL-AI'));
});
test('일반 교사의 전체 명단/지역 통계와 교육 담당자의 기수 운영 권한은 승인 설정과 무관하다',async()=>{
 const roster=await ok('getRoster',{indexOnly:true},member),report=await ok('getDistrictReport',{dept:'장년회'},member);
 await change();assert.deepEqual(await ok('getRoster',{indexOnly:true},member),roster);assert.deepEqual(await ok('getDistrictReport',{dept:'장년회'},member),report);
 assert.equal((await desk(education)).me.hq,true);assert.equal((await ok('saveCenter',{centerName:'가짜 새 기수',openMonth:'2026-12'},education)).ok,true);
});
test('새 표/함수는 비공개이며 설정이 없으면 전체 허용으로 조용히 우회하지 않는다',async()=>{
 for(const fn of ['center_scope_state','center_policy_apply','center_referral_apply']){assert.equal(sql(`select prosecdef from pg_proc where proname=${quote(fn)}`),'f');for(const role of ['anon','authenticated']){const r=await fetch('http://127.0.0.1:58432/rpc/'+fn,{method:'POST',headers:{authorization:'Bearer '+jwt(role),'content-type':'application/json'},body:JSON.stringify(fn==='center_scope_state'?{p_nid:ids.admin}:{p:{}})});assert.equal((await r.json()).code,'42501');}}
 for(const table of ['center_approval_policy','center_policy_changes'])assert.equal(sql(`select rowsecurity from pg_tables where tablename=${quote(table)}`),'t');
 sql('delete from center_approval_policy');try{assert.equal((await api('getCenterDesk',{},education)).status,503);}finally{sql("insert into center_approval_policy(id,mode)values(1,'legacy_global')");}
});
