// 가짜 명단이 있는 전용 로컬 DB만 사용한다. 다른 로컬 DB 테스트와 동시 실행하지 않는다.
import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {seed,sql,quote,ids,api,login} from './helpers/local-db.mjs';

function seedWorkflows() {
  seed();
  sql(`truncate public.center_referrals,public.centers,public.encouragements restart identity;
    insert into public.admins(member_id,name,dept,region,position) values('${ids.coach}','테스트교관','청년회','1지역','복음방교관');
    insert into public.centers(name,open_month,staff) values('격리센터','2026-11','[{"memberId":"${ids.member}","name":"테스트교사","role":"담당"},{"memberId":"${ids.coach}","name":"테스트교관","role":"전도사"}]');
    insert into public.center_referrals(target_id,target_name,teacher_id,teacher_name,dept,region,stage,status,snapshot) values
      ('ISOLATED-1','가짜대상1','${ids.other}','테스트대상','청년회','1지역','복음방','요청','{}'),
      ('ISOLATED-2','가짜대상2','${ids.other}','테스트대상','장년회','1지역','복음방','요청','{}'),
      ('ISOLATED-3','가짜대상3','${ids.other}','테스트대상','청년회','2지역','복음방','요청','{}'),
      ('ISOLATED-4','가짜대상4','${ids.other}','테스트대상','장년회','2지역','복음방','요청','{}');`);
}
beforeEach(seedWorkflows);
const coach=()=>login(ids.coach,'테스트교관');
const states=()=>sql('select string_agg(status,\',\' order by id) from center_referrals');

test('격려 메시지의 타인 읽음 변경 거절과 본인 처리',async()=>{
  const at='2026-11-12 01:00:00';
  sql(`insert into encouragements(to_id,message,sent_at) values('${ids.other}','가짜 격려','${at}'),('${ids.member}','내 가짜 격려','${at}')`);
  const m=await login();
  assert.equal((await api('markEncouragementRead',{messageId:ids.other+'::'+at},m.body.token)).status,403);
  assert.equal(sql('select count(*) from encouragements where is_read'),'0');
  assert.equal((await api('markEncouragementRead',{messageId:ids.member+'::'+at},m.body.token)).body.ok,true);
  assert.equal(sql(`select is_read from encouragements where to_nid='${ids.member}'`),'t');
});
test('센터 승인에서 부서·지역 겸직을 합치고 교차 범위는 거절',async()=>{
  sql(`insert into admins(member_id,name,dept,region,position) values('${ids.coach}','테스트교관','장년회','2지역','지역장')`);
  const c=await coach();
  const r=await api('decideCenterReferral',{ids:[1,2,3,4],decision:'승인'},c.body.token);
  assert.equal(r.body.done,2,JSON.stringify(r));assert.equal(r.body.skipped,2);
  assert.equal(states(),'승인,요청,요청,승인');
});
test('교관 지역 공란과 권한 회수는 승인하지 않으며 교사 본인 요청만 취소',async()=>{
  const c=await coach(),m=await login();
  sql(`update admins set region='' where nid='${ids.coach}'`);
  assert.ok((await api('decideCenterReferral',{ids:[1],decision:'승인'},c.body.token)).body.error);
  sql(`delete from admins where nid='${ids.coach}'`);
  assert.ok((await api('decideCenterReferral',{ids:[1],decision:'승인'},c.body.token)).body.error);
  assert.ok((await api('cancelCenterRequest',{id:1},m.body.token)).body.error);
  const owner=await login(ids.other,'테스트대상');
  assert.equal((await api('cancelCenterRequest',{id:1},owner.body.token)).body.ok,true);
  assert.equal(states(),'취소,요청,요청,요청');
});
test('센터 승인·전달·동시 승인전달 각각 12건 요청에 실제 성공 한 건만 보고',async()=>{
  for(const [action,status,body] of [
    ['decideCenterReferral','요청',{decision:'승인'}],
    ['sendToCenter','승인',{centerId:1,cardDone:true}],
    ['approveAndSend','요청',{centerId:1,cardDone:true}],
  ]) {
    seedWorkflows();sql(`update center_referrals set status=${quote(status)} where id=1`);
    const c=await coach();
    const rs=await Promise.all(Array.from({length:12},()=>api(action,{ids:[1],...body},c.body.token)));
    assert.ok(rs.every(r=>r.status===200 && r.body.ok),JSON.stringify(rs));
    assert.equal(rs.reduce((sum,r)=>sum+r.body.done,0),1,action);
    assert.equal(rs.reduce((sum,r)=>sum+r.body.skipped,0),11,action);
    assert.equal(sql('select status from center_referrals where id=1'),action==='decideCenterReferral'?'승인':'전달');
  }
});
test('취소 12건 경합은 한 번만 성공하며 다른 부서의 요청은 유지',async()=>{
  const owner=await login(ids.other,'테스트대상');
  const rs=await Promise.all(Array.from({length:12},()=>api('cancelCenterRequest',{id:1},owner.body.token)));
  assert.equal(rs.filter(r=>r.body.ok).length,1,JSON.stringify(rs));
  assert.equal(states(),'취소,요청,요청,요청');
});
test('수강 동의 없는 전달·다른 기수 배정 거절과 정상 처리',async()=>{
  const c=await coach(),m=await login();
  sql("update center_referrals set status='승인' where id=1");
  assert.ok((await api('sendToCenter',{ids:[1],centerId:1},c.body.token)).body.error);
  const sent=await api('sendToCenter',{ids:[1],centerId:1,cardDone:true},c.body.token);assert.equal(sent.body.done,1);
  assert.equal((await api('assignCenterReferral',{id:1,assignee:ids.coach},m.body.token)).body.ok,true);
  assert.equal(sql('select assignee_id from center_referrals where id=1'),ids.coach);
  sql("insert into centers(name) values('다른 격리센터'); update center_referrals set center_id=2 where id=1");
  assert.ok((await api('assignCenterReferral',{id:1,assignee:''},m.body.token)).body.error);
  assert.equal(sql('select assignee_id from center_referrals where id=1'),ids.coach);
});
