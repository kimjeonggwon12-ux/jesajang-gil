import {before,test} from 'node:test';
import assert from 'node:assert/strict';
import {seed,ids,PIN,sql} from './helpers/local-db.mjs';
const base='http://127.0.0.1:58434';
async function api(action,body={},token){const r=await fetch(base+'/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...body,...(token?{_tk:token}:{})})});return {status:r.status,body:await r.json()};}
async function reviewed(action,body,token){
 const mode=action==='removeRosterMember'?'remove':body.member.isNew?'create':'update',id=body.targetId||body.member.memberId;
 const found=mode==='create'?null:(await api('searchRoster',{query:id},token)).body.rows[0];
 const input={...body,expectedRevision:found?.rosterRevision};
 const preview=await api('previewRosterChange',{...input,mode},token);if(preview.body.error)return preview;
 return api(action,{...input,review:preview.body.review,confirmed:true},token);
}
const login=(id,name,dept='청년회')=>api('verifyLogin',{memberId:id,name,dept,pin:PIN});
let member,education;
const target='9900000000999',fields={memberId:target,name:'가짜이관검증',dept:'청년회',region:'01지역',affiliation:'가짜구역',position:'교사',note:'로컬 검증'};
before(async()=>{seed();member=(await login(ids.member,'테스트교사')).body.token;education=(await login(ids.admin,'테스트교육')).body.token;assert.ok(member&&education);});
test('명단 관리의 정적 페이지는 개인 정보나 관리 자료를 포함하지 않는다',async()=>{
 const response=await fetch(base+'/admin/roster');assert.equal(response.status,200);assert.doesNotMatch(await response.text(),/테스트교사|9900000000001|010-0000/);
});
test('일반 계정의 명단·기록·복구 접근과 실행자 사칭 요청은 거절한다',async()=>{
 for(const [action,body] of [['searchRoster',{query:'테스트'}],['getRosterLog',{}],['getPinRecoveryContact',{targetId:ids.member}],['saveRosterMember',{member:{...fields,isNew:true}}],['setAdminMember',{targetId:ids.other,on:true,admin:{position:'전도부장'}}],['removeRosterMember',{targetId:ids.other}],['resetPin',{targetId:ids.other,adminPin:PIN,identityConfirmed:true,reason:'PIN 분실'}]]){
  const result=await api(action,{...body,memberId:ids.admin,name:'테스트교육'},member);assert.equal(result.status,403,action);
 }
});
test('교사 추가·수정·검색·변경 기록에서 등급과 서버 실행자를 보존한다',async()=>{
 const created=await reviewed('saveRosterMember',{member:{...fields,isNew:true,tier:'우수교사'},name:'위조실행자'},education);assert.equal(created.body.created,true);assert.equal(created.body.member.tier,'활동교사');
 const duplicate=await api('saveRosterMember',{member:{...fields,isNew:true}},education);assert.match(duplicate.body.error,/이미/);
 const rows=(await api('searchRoster',{query:fields.name},education)).body.rows;assert.equal(rows.length,1);assert.equal(rows[0].inRoster,true);
 const saved=await reviewed('saveRosterMember',{member:{...fields,name:'가짜이관수정',region:'02지역',isNew:false,tier:'우수교사'}},education);assert.equal(saved.body.ok,true);assert.equal(saved.body.member.tier,'활동교사');
 const logs=(await api('getRosterLog',{},education)).body.rows;const change=logs.find(row=>row.kind==='교사 수정'&&row.targetName==='가짜이관수정');assert.equal(change.actor,'테스트교육');assert.equal(change.before.region,'01지역');assert.equal(change.after.region,'02지역');
});
test('관리자 지정·해제는 담당 범위를 그대로 저장하며 자기 권한 해제는 막는다',async()=>{
 const assignment={targetId:target,on:true,admin:{name:'가짜이관수정',dept:'청년회',region:'02지역',position:'복음방교관',phone:'01000000999'}};
 assert.equal((await api('setAdminMember',assignment,education)).body.ok,true);
 const person=(await api('searchRoster',{query:'가짜이관수정'},education)).body.rows[0];assert.deepEqual(person.admin,assignment.admin);
 assert.equal((await api('setAdminMember',{targetId:ids.admin,on:false},education)).body.error,'내 관리자 권한은 스스로 해제할 수 없어요.');
 assert.equal((await api('setAdminMember',{targetId:target,on:false},education)).body.ok,true);
 assert.equal((await api('searchRoster',{query:'가짜이관수정'},education)).body.rows[0].admin,null);
});
test('PIN 복구는 연락처 조회·담당자 본인 확인·PIN 재확인 후 단회 코드와 세션 폐기를 유지한다',async()=>{
 const contact=await api('getPinRecoveryContact',{targetId:ids.member},education);assert.equal(contact.body.name,'테스트교사');assert.equal(contact.body.contacts[0].source,'teacher_profile');
 const request={targetId:ids.member,adminPin:PIN,identityConfirmed:true,reason:'선등록 신고'};
 assert.match((await api('resetPin',{...request,identityConfirmed:false},education)).body.error,/본인 확인/);
 assert.match((await api('resetPin',{...request,adminPin:'000000'},education)).body.error,/핀번호/);
 const issued=await api('resetPin',request,education);assert.equal(issued.body.ok,true);assert.match(issued.body.recoveryCode,/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
 assert.equal((await api('getMyTierStatus',{},member)).status,401);
 const recovered=await api('recoverPin',{memberId:ids.member,name:'테스트교사',dept:'청년회',code:issued.body.recoveryCode,pin:'693857'});assert.equal(recovered.body.ok,true);
 const duplicate=await api('recoverPin',{memberId:ids.member,name:'테스트교사',dept:'청년회',code:issued.body.recoveryCode,pin:'693857'});assert.ok(duplicate.body.error);
 assert.equal(Number(sql(`select count(*) from pin_recovery_challenges where nid='${ids.member}' and consumed_at is not null`)),1);
});
test('교사 명단 삭제는 교사 행만 제거하고 별도 관리자·활동 기록을 보존한다',async()=>{
 await api('setAdminMember',{targetId:target,on:true,admin:{name:'가짜이관수정',dept:'청년회',region:'02지역',position:'교관'}},education);
 const activitiesBefore=Number(sql('select count(*) from activities'));
 assert.equal((await reviewed('removeRosterMember',{targetId:target},education)).body.ok,true);
 const row=(await api('searchRoster',{query:'가짜이관수정'},education)).body.rows[0];assert.equal(row.inRoster,false);assert.equal(row.admin.position,'교관');
 assert.equal(Number(sql('select count(*) from activities')),activitiesBefore);
 const log=(await api('getRosterLog',{},education)).body.rows.find(row=>row.kind==='교사 삭제'&&row.targetName==='가짜이관수정');assert.equal(log.actor,'테스트교육');assert.equal(log.after,null);
});
