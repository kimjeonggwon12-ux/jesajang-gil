import {before,test} from 'node:test';
import assert from 'node:assert/strict';
import {ids,PIN,sql} from './helpers/local-db.mjs';
import {seedInsights} from './helpers/target-insights-fixture.mjs';
const base='http://127.0.0.1:58434',old='http://127.0.0.1:58433';
async function api(action,body={},token,origin=base){const r=await fetch(origin+'/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...body,...(token?{_tk:token}:{})})});return {status:r.status,body:await r.json()};}
const login=async(id,name,dept='청년회')=>(await api('verifyLogin',{memberId:id,name,dept,pin:PIN})).body.token;
const count=kind=>Number(sql(`select count(*) from target_ai_notes where target_id='LIST-1'${kind?` and kind='${kind}'`:''}`));
let token,other,admin,leader,helper,guest;
before(async()=>{
  seedInsights();token=await login(ids.member,'테스트교사');other=await login(ids.other,'테스트대상');admin=await login(ids.admin,'테스트교육');leader=await login(ids.coach,'테스트교관');helper=await login(ids.evangel,'테스트전도','전도부');
  guest=(await api('guestLogin',{memberId:'99000999',name:'가짜손님',dept:'청년회',code:'INSIGHTG'})).body.token;
  assert.ok(token&&other&&admin&&leader&&helper&&guest);
});
test('누적 정보·계획·교관 답변은 기존 API와 같고 전체 활동 집계를 보존한다',async()=>{
  for(const action of ['getTargetInfo','getTargetFile'])assert.deepEqual(await api(action,{targetId:'LIST-1'},token),await api(action,{targetId:'LIST-1'},token,old));
  const info=(await api('getTargetInfo',{targetId:'LIST-1'},token)).body;assert.equal(info.items.length,42);assert.equal(info.items[0].text,'가짜 파악 기록 42');assert.equal(info.master.text,'보존할 종합 피드백');assert.doesNotMatch(JSON.stringify(info),/타인비공개/);
  const file=(await api('getTargetFile',{targetId:'LIST-1'},token)).body;assert.equal(file.plans.length,25);assert.equal(file.hearts.length,25);assert.equal(file.hearts[0].answer,'가짜 교관 답변 25');
  assert.equal((await api('getMyActivities',{summary:true,aggregate:true},token)).body.overview.total,1205);
});
test('등록·인도·섬김 담당자는 허용하고 비로그인·사칭·다른 계정·일반 관리자·손님은 거절한다',async()=>{
  for(const owner of [token,leader,helper])assert.equal((await api('getTargetInfo',{targetId:'LIST-1'},owner)).body.items.length,42);
  for(const action of ['getTargetInfo','getTargetFile','addTargetInfo','deleteTargetInfo','targetInfoFeedback','targetMasterFeedback','planCohortLead']){
    const body={targetId:'LIST-1',text:'금지된 변경',id:1};
    assert.equal((await api(action,body)).status,401,action);
    assert.equal((await api(action,{...body,memberId:ids.other},token)).status,403,action);
    for(const unauthorized of [other,admin,guest])assert.ok((await api(action,body,unauthorized)).body.error,action);
  }
  assert.equal(count('파악정보'),42);
});
test('복수 분류 저장·담당자 간 삭제는 범위를 지키며 다른 대상자와 AI 결과를 지우지 않는다',async()=>{
  const result=(await api('addTargetInfo',{targetId:'LIST-1',cats:['가족','관심사·취미','가족','없는분류'],text:'  가짜 새 파악 정보  '},helper)).body;
  assert.deepEqual(result.item.cats,['가족','관심사·취미']);assert.equal(result.item.text,'가짜 새 파악 정보');assert.equal(count('파악정보'),43);
  assert.ok((await api('addTargetInfo',{targetId:'LIST-1',text:'   '},token)).body.error);
  const otherId=sql("select id from target_ai_notes where target_id='LIST-2' limit 1"),aiId=sql("select id from target_ai_notes where target_id='LIST-1' and kind='AI 종합 피드백' limit 1");
  for(const id of [otherId,aiId])await api('deleteTargetInfo',{targetId:'LIST-1',id},token);
  assert.equal(sql(`select count(*) from target_ai_notes where id in (${otherId},${aiId})`),'2');
  assert.equal((await api('deleteTargetInfo',{targetId:'LIST-1',id:result.item.id},leader)).body.ok,true);assert.equal(count('파악정보'),42);
});
test('AI 파악·종합·개강 결과는 한 번씩 누적 저장하고 기존 계획 이력과 원문을 보존한다',async()=>{
  for(const [action,kind]of [['targetInfoFeedback','AI 파악정보 피드백'],['targetMasterFeedback','AI 종합 피드백'],['planCohortLead','개강 인도 계획']]){
    const n=count(kind),res=(await api(action,{targetId:'LIST-1'},token)).body;assert.equal(res.error,undefined);assert.match(res.text,/로컬 검증용 가짜/);assert.equal(count(kind),n+1);assert.ok(res.basis);
  }
  const info=(await api('getTargetInfo',{targetId:'LIST-1'},token)).body;assert.match(info.feedback.text,/파악 정보 피드백/);assert.match(info.master.text,/종합 피드백/);
  assert.match(sql("select goal_plan from targets where target_id='LIST-1'"),/개강 계획/);assert.equal((await api('getTargetFile',{targetId:'LIST-1'},token)).body.plans.length,26);
  assert.equal(sql("select count(*) from target_ai_notes where text='가짜 과거 계획 1'"),'1');assert.equal(sql('select count(*) from activities'),'1206');
});
test('활동 AI는 자기 활동에만 저장하고 타인 대상자 자료·활동을 바꾸지 않는다',async()=>{
  const n=count('AI 단계향상 피드백');const res=(await api('getActivityFeedback',{targetId:'LIST-1',activityId:1,targetName:'가**상',stage:'센터수강',todayWork:'가짜 활동',nextWork:'가짜 다음'},token)).body;
  assert.match(res.text,/단계 향상 피드백/);assert.equal(count('AI 단계향상 피드백'),n+1);assert.equal(sql('select ai_feedback from activities where id=1'),res.text);
  const notes=count();await api('getActivityFeedback',{targetId:'LIST-1',activityId:1,targetName:'가짜',todayWork:'권한 없는 요청'},other);
  assert.equal(count(),notes);assert.equal(sql('select ai_feedback from activities where id=1'),res.text);
});
test('AI 경고·실패는 기존 결과를 보존하고 새 이력을 만들지 않는다',async()=>{
  const n=count(),plan=sql("select goal_plan from targets where target_id='LIST-1'"),saved=sql('select ai_feedback from activities where id=1');
  // 기존 실제 프롬프트에 포함되는 가짜 입력만 사용한다. 업무 API에 시험 옵션을 추가하지 않는다.
  const marker=(await api('addTargetInfo',{targetId:'LIST-1',text:'__LOCAL_AI_WARNING__'},token)).body.item.id;
  for(const action of ['targetInfoFeedback','targetMasterFeedback','planCohortLead','getActivityFeedback']){
    const res=(await api(action,{targetId:'LIST-1',activityId:1},token)).body;assert.match(res.error||res.text,/격리 시험용 AI 응답 실패/);
  }
  assert.equal(count(),n+1);assert.equal(sql("select goal_plan from targets where target_id='LIST-1'"),plan);assert.equal(sql('select ai_feedback from activities where id=1'),saved);
  await api('deleteTargetInfo',{targetId:'LIST-1',id:marker},token);
  const fail=(await api('addTargetInfo',{targetId:'LIST-1',text:'__LOCAL_AI_ERROR__'},token)).body.item.id;
  assert.ok((await api('targetInfoFeedback',{targetId:'LIST-1'},token)).body.error);assert.equal(count(),n+1);
  await api('deleteTargetInfo',{targetId:'LIST-1',id:fail},token);assert.equal(count(),n);
});
test('목표 월 변경은 현재 계획만 비우고 과거 계획과 활동 결과는 보존한다',async()=>{
  const n=count('개강 인도 계획');assert.equal((await api('updateTarget',{targetId:'LIST-1',goalCohort:'2027-02'},token)).body.ok,true);
  assert.equal(sql("select goal_plan from targets where target_id='LIST-1'"),'');assert.equal(count('개강 인도 계획'),n);
  assert.equal((await api('getMyActivities',{summary:true,aggregate:true},token)).body.overview.total,1205);
});
