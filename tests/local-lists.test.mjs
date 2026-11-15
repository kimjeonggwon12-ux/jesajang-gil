import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { seedLists } from './helpers/lists-fixture.mjs';
import { api, sql, login, ids, jwt } from './helpers/local-db.mjs';
import { metrics } from './helpers/traffic-fixture.mjs';
let token, roster, report, directory;
const directoryGet = body => api('getTeacherDirectory',body,token);
const pageGet = body => api('getMyActivityPage',body,token);
const bytes = v => Buffer.byteLength(JSON.stringify(v));
before(async()=>{
  seedLists(); token=(await login()).body.token; assert.ok(token);
  roster=(await api('getRoster',{},token)).body;
  report=(await api('getTeacherListReport',{},token)).body;
  directory=(await directoryGet({all:true,refresh:true})).body;
  assert.equal(directory.total,2347);
});
test('명단 2,347명은 50명씩 끝까지 중복·누락 없이 조회되고 기존 전체 응답은 유지된다',async()=>{
  let found=[];
  for(let page=1;page<=Math.ceil(2347/50);page++){
    const r=await directoryGet({page,limit:50});assert.equal(r.status,200);found.push(...r.body.rows.map(x=>x.memberId));
  }
  const compact=(await api('getRoster',{indexOnly:true},token)).body;assert.equal(compact.rows.length,2347);assert.deepEqual(Object.keys(compact.rows[0]).sort(),['dept','memberId','name','region','tier']);
  assert.equal(found.length,2347);assert.equal(new Set(found).size,2347);
  assert.deepEqual(found,directory.rows.map(x=>x.memberId));assert.equal(roster.rows.length,2347);
  const oldReport=new Map(report.rows.map(x=>[x.memberId,x]));
  for(const row of directory.rows)for(const [k,v] of Object.entries(oldReport.get(row.memberId)))assert.deepEqual(row[k],v);
});
test('검색·부서·지역·직책·등급·신청·등급제안·실적 필터는 전체 계산 결과와 일치한다',async()=>{
  const filters=[{query:'가짜교사010'},{query:'%_(),'},{query:'아무도없음'},{query:'9700000000002'},
    {dept:'청년회',region:'3지역'}, {dept:'기타'}, {adminOnly:true,tier:'활동교사'}, {apply:'yes'}, {apply:'no'}, {pendingOnly:true},{minLeads:1}];
  const main=['교역자','자문회','장년회','부녀회','청년회'];
  for(const f of filters){
    const expected=directory.rows.filter(t=>(!f.query||[t.name,t.memberId,t.region,t.dept,t.position,t.tier].some(v=>String(v||'').includes(f.query)))
      &&(!f.dept||(main.includes(t.dept)?t.dept:'기타')===f.dept)&&(!f.region||t.region===f.region)
      &&(!f.adminOnly||t.position==='지역장')&&(!f.tier||t.tier===f.tier)&&(!f.apply||(f.apply==='yes'?!!t.apply:!t.apply))
      &&(!f.pendingOnly||!!t.suggestion)&&(!f.minLeads||t.leads1y>=f.minLeads));
    const r=await directoryGet({...f,all:true});assert.equal(r.status,200);
    // 남의 번호는 응답에서 암호화된다. 원번호 검색은 고정된 가짜 대상 1명으로 별도 확인.
    if(f.query==='9700000000002'){assert.equal(r.body.total,1);assert.equal(r.body.rows[0].name,'가짜교사0002');}
    else assert.deepEqual(r.body.rows.map(x=>x.memberId),expected.map(x=>x.memberId),JSON.stringify(f));
  }
});
test('활동 1,205건의 같은 시각·빈 날짜도 안정된 순서로 페이지를 모두 조회한다',async()=>{
  let rows=[],through;
  for(let page=1;page<=25;page++){
    const r=await pageGet({page,limit:50,through});assert.equal(r.status,200);through=r.body.through;rows.push(...r.body.rows);
  }
  assert.equal(rows.length,1205);assert.equal(new Set(rows.map(x=>x.id)).size,1205);assert.equal(rows.at(-1).id,1205);
  const legacy=(await api('getMyActivities',{},token)).body;
  assert.deepEqual(rows,legacy.rows);
});
test('활동 검색은 보고 본문까지 찾고 특수문자를 그대로 처리하며 대상자 필터도 유지한다',async()=>{
  const r=await pageGet({query:'%_(),'});assert.equal(r.body.total,1);assert.equal(r.body.rows[0].id,3);
  assert.equal((await pageGet({query:'남의비공개본문'})).body.total,0);
  assert.equal((await pageGet({targetName:'가짜다른대상'})).body.total,120);
  assert.equal((await pageGet({targetName:'가짜대상',query:'%_(),'})).body.total,1);
  assert.equal((await pageGet({query:'존재하지않는내용'})).body.total,0);
});
test('요약 조회도 누적 역할·대상자·교육·피드백·보고 유무를 보존하고 상세에서 원문을 복구한다',async()=>{
  const legacy=(await api('getMyActivities',{},token)).body;
  const summary=(await api('getMyActivities',{summary:true},token)).body;
  assert.equal(summary.rows.length,1205);assert.equal(summary.recent.rows.length,3);
  assert.deepEqual(summary.roleCounts,legacy.roleCounts);assert.deepEqual(summary.roleItemCounts,legacy.roleItemCounts);
  for(let i=0;i<legacy.rows.length;i++){
    const a=legacy.rows[i],b=summary.rows[i];
    for(const k of ['id','submittedAt','activities','roles','targetName','targetStage','tgPosts','aiFeedback','aiFeedbackAt'])assert.deepEqual(b[k],a[k]);
    assert.equal(b.hasReportText,!!a.reportText);assert.equal(b.reportText,'');assert.equal(b.report?.lesson,a.report?.lesson);
  }
  const detail=(await api('getMyActivity',{id:500},token)).body.row;
  assert.deepEqual(detail,legacy.rows.find(a=>a.id===500));assert.ok(detail.report.lessons.length);
  await metrics(true); const page=(await pageGet({limit:20})).body;
  const measurements={fakeRoster:2347,fakeOwnActivities:1205,legacyDirectoryBytes:bytes(roster)+bytes(report),pagedDirectoryBytes:bytes((await directoryGet({})).body),legacyActivitiesBytes:bytes(legacy),summaryWithRecentBytes:bytes(summary),activityPageBytes:bytes(page),metrics:await metrics(),productionTouched:false};
  mkdirSync('../artifacts/lists-20261112',{recursive:true});writeFileSync('../artifacts/lists-20261112/measurements.json',JSON.stringify(measurements,null,2));
  assert.ok(measurements.summaryWithRecentBytes<measurements.legacyActivitiesBytes*.2);
  assert.ok(measurements.pagedDirectoryBytes<measurements.legacyDirectoryBytes*.03);
});
test('서버가 신원을 고정하고 비로그인·손님·다른 사람 상세 및 직접 DB 호출을 거절한다',async()=>{
  for(const action of ['getTeacherDirectory','getMyActivityPage','getMyActivity'])assert.equal((await api(action,{id:1})).status,401);
  const spoof=await pageGet({memberId:ids.other});assert.equal(spoof.status,403);
  assert.equal((await api('getMyActivity',{id:1206},token)).status,404);
  assert.equal((await api('getMyActivity',{id:1},(await login(ids.other,'테스트대상')).body.token)).status,404);
  sql("insert into target_room_invites(code,target_id,expires_at,max_uses) values('LISTTEST','LIST-1','2099-01-01',100) on conflict(code) do update set revoked=false,uses=0");
  const guest=await api('guestLogin',{memberId:'99000999',name:'가짜손님',dept:'청년회',code:'LISTTEST'});
  assert.ok(guest.body.token);
  for(const action of ['getTeacherDirectory','getMyActivityPage','getMyActivity'])assert.equal((await api(action,{id:1},guest.body.token)).status,403);
  for(const role of ['anon','authenticated']){
    assert.equal(sql(`select has_function_privilege('${role}','public.my_activity_page(text,text,text,integer,integer,bigint)','execute')`),'f');
    assert.equal(sql(`select has_table_privilege('${role}','public.activity_list_index','select')`),'f');
    const r=await fetch('http://127.0.0.1:58432/rpc/my_activity_page',{method:'POST',headers:{authorization:'Bearer '+jwt(role),'content-type':'application/json'},body:JSON.stringify({p_nid:ids.member})});assert.ok(r.status>=400);
  }
});
test('잘못된 페이지는 거부하고 마지막 페이지 초과는 마지막으로 보정한다',async()=>{
  for(const body of [{page:0},{page:1.5},{limit:1000},{query:'가'.repeat(121)}]){
    assert.equal((await pageGet(body)).status,400);assert.equal((await directoryGet(body)).status,400);
  }
  assert.equal((await pageGet({page:99999})).body.page,61);
  assert.equal((await directoryGet({page:99999})).body.page,118);
});
test('조회 도중 새 활동이 생겨도 기존 페이지 범위는 고정되고 새 검색에서 보인다',async()=>{
  const first=(await pageGet({limit:20})).body;
  sql(`insert into activities(member_id,submitted_at,target_name) values('${ids.member}','2026-11-13','조회중새기록')`);
  try { assert.equal((await pageGet({page:2,through:first.through})).body.total,1205);assert.equal((await pageGet({query:'조회중새기록'})).body.total,1); }
  finally { sql("delete from activities where target_name='조회중새기록'"); }
});
test('명단 변경 후 강제 갱신은 검색 결과와 직책 수에 즉시 반영한다',async()=>{
  sql("update teachers set position='지역장' where member_id='9700000000001'");
  try {const r=await directoryGet({query:'문자',adminOnly:true,refresh:true});assert.equal(r.body.total,1);}
  finally {sql("update teachers set position='' where member_id='9700000000001'");await directoryGet({refresh:true});}
});
