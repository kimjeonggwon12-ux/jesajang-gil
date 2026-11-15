import {before,test} from 'node:test';
import assert from 'node:assert/strict';
import {seedHomeActivity} from './helpers/home-activity-fixture.mjs';
import {ids,PIN,sql} from './helpers/local-db.mjs';
import {targetsByActivityRole} from '../next-app/lib/home-activity.ts';
const next='http://127.0.0.1:58434',old='http://127.0.0.1:58433';
async function api(action,body={},token,base=next){const r=await fetch(base+'/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...body,...(token?{_tk:token}:{})})});return {status:r.status,body:await r.json()};}
let token,other;
before(async()=>{seedHomeActivity();token=(await api('verifyLogin',{memberId:ids.member,name:'테스트교사',dept:'청년회',pin:PIN})).body.token;other=(await api('verifyLogin',{memberId:ids.other,name:'테스트대상',dept:'청년회',pin:PIN})).body.token;assert.ok(token&&other);});
test('홈 역할 요약은 전체 누적 이름 역할·올해 협력·서버 담당 범위를 기존 API와 동일하게 읽는다',async()=>{
 const [summary,targets]=await Promise.all([api('getMyActivities',{summary:true,aggregate:true},token),api('getMyTargets',{includeHistory:false},token)]);assert.equal(summary.status,200);assert.ok(summary.body.overview);assert.equal(targets.body.rows.length,4);
 for(const [action,body]of [['getMyActivities',{summary:true,aggregate:true}],['getMyTargets',{includeHistory:false}]])assert.deepEqual(await api(action,body,token),await api(action,body,token,old));
 const roles=targetsByActivityRole(summary.body,targets.body.rows,ids.member);assert.deepEqual(roles.인도자.map(t=>t.targetId),['HOME-A','HOME-B']);assert.deepEqual(roles.교사.map(t=>t.targetId),['HOME-A']);assert.equal(roles.섬김이.length,0);assert.equal(summary.body.overview.coopRecords.length,1);assert.deepEqual(summary.body.overview.coopRecords[0].activities,['동아리','만남 동행']);
 assert.equal((await api('getMyActivities',{memberId:ids.other,summary:true,aggregate:true},token)).status,403);
});
test('이름만 남은 1,013개 활동을 빠짐없이 지우고 타인 동명·본인 다른 이름은 보존한다',async()=>{
 sql(`insert into activities(member_id,name,target_name,activities) select '${ids.member}','테스트교사',case when g%2=0 then ' 가짜대량이름 ' else '가짜대량이름' end,array['만남1'] from generate_series(1,1013)g;
 insert into activities(member_id,name,target_name,activities) values('${ids.other}','테스트대상','가짜대량이름',array['만남1']);`);
 const result=await api('deleteTarget',{targetName:'가짜대량이름'},token);assert.equal(result.body.ok,true);assert.equal(result.body.deletedActivities,1013);assert.equal(result.body.deletedHistory,0);assert.equal(sql(`select count(*) from activities where nid='${ids.member}' and trim(target_name)='가짜대량이름'`),'0');assert.equal(sql(`select count(*) from activities where nid='${ids.other}' and target_name='가짜대량이름'`),'1');assert.equal(sql(`select count(*) from activities where nid='${ids.member}' and target_name='가짜진행대상'`),'1');
 assert.equal((await api('deleteTarget',{targetName:'가짜대량이름'},token)).body.deletedActivities,0);
});
test('1,000번째 뒤의 담당 대상자도 이름으로 찾아 연결 이력까지 기존 범위대로 정리한다',async()=>{
 sql(`insert into targets(target_id,creator_id,target_name,stage) select 'HOME-PAD-'||g,'${ids.member}','가짜패딩'||g,'친분' from generate_series(1,1003)g;
 insert into targets(target_id,creator_id,leader_id,target_name,stage) values('HOME-LAST','${ids.member}','${ids.other}',' 늦은대상 ','친분');
 insert into target_history(target_id,member_id,to_stage) values('HOME-LAST','${ids.member}','친분');
 insert into activities(member_id,name,target_name,activities) values('${ids.member}','테스트교사','늦은대상',array['만남1']),('${ids.other}','테스트대상',' 늦은대상 ',array['만남1']),('${ids.admin}','테스트교육','늦은대상',array['만남1']);`);
 const result=await api('deleteTarget',{targetName:'늦은대상'},token);assert.equal(result.body.ok,true);assert.equal(result.body.deletedActivities,2);assert.equal(result.body.deletedHistory,1);assert.equal(sql("select count(*) from targets where target_id='HOME-LAST'"),'0');assert.equal(sql(`select count(*) from activities where nid='${ids.admin}' and target_name='늦은대상'`),'1');
});
test('이름 삭제도 인증/본인 번호/타인 대상자 경계를 넘지 못한다',async()=>{
 for(const body of [{targetName:'가짜이름기록'},{targetId:'HOME-A'}])assert.equal((await api('deleteTarget',body)).status,401);
 assert.equal((await api('deleteTarget',{memberId:ids.other,targetName:'가짜이름기록'},token)).status,403);
 assert.ok((await api('deleteTarget',{targetId:'HOME-D'},other)).body.error);
 assert.equal(sql("select count(*) from targets where target_id='HOME-D'"),'1');
 const result=await api('deleteTarget',{targetName:'가짜이름기록'},token);assert.equal(result.body.deletedActivities,1);assert.equal(sql(`select count(*) from activities where nid='${ids.other}' and target_name='가짜이름기록'`),'1');
});
