import {test,before} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {ids,api,login,sql,jwt} from './helpers/local-db.mjs';
import {seedLists} from './helpers/lists-fixture.mjs';

let token,originalDigest;
const output='../artifacts/cross-check-20261113';
const digest=()=>sql("select md5(string_agg(row_to_json(a)::text,'|' order by id)) from activities a");
const ok=async(action,body)=>{const r=await api(action,body,token);assert.equal(r.status,200);assert.ok(!r.body.error,r.body.error);return r.body;};
const prefix=text=>{let end=0;for(const c of text||''){if(end+c.length>160)break;end+=c.length;}return (text||'').slice(0,end);};
const expectedCard=a=>({id:a.id,submittedAt:a.submittedAt,activities:a.activities,roles:a.roles,targetName:a.targetName,targetStage:a.targetStage,sequence:a.sequence,preview:a.report?.lesson||a.gospelSubject||a.consultTitle||prefix(a.todayWork),hasAiFeedback:!!a.aiFeedback});
const metrics=async reset=>(await fetch('http://127.0.0.1:58433/__local_metrics',{method:reset?'POST':'GET'})).json();
before(async()=>{
 seedLists();
 sql("update activities set report='{}',gospel_subject='',consult_title='' where id<=5; update activities set gospel_subject='복음방 제목' where id=1; update activities set consult_title='상담 제목' where id=2; update activities set today_work=repeat('😀한',120) where id=3; update activities set today_work='' where id=4; update activities set report=jsonb_build_object('lesson',' ') where id=5;");
 token=(await login()).body.token;assert.ok(token);originalDigest=digest();mkdirSync(output,{recursive:true});
});
test('활동 카드의 모든 페이지는 기존 상세의 순서·누적 회차·표시 내용과 같다',async()=>{
 let through,seen=[];
 for(let page=1;;page++){
  const input={page,limit:50,through,withSequence:true};
  const full=await ok('getMyActivityPage',input),cards=await ok('getMyActivityPage',{...input,cards:true});
  assert.deepEqual(cards,{...full,rows:full.rows.map(expectedCard)});
  through=cards.through;seen.push(...cards.rows.map(r=>r.id));if(page===cards.pages)break;
 }
 assert.equal(seen.length,1205);assert.equal(new Set(seen).size,1205);
});
test('원문 검색·피드백 필터·대상자·빈 결과·마지막 쪽 보정은 가벼운 목록에서도 보존한다',async()=>{
 for(const input of [{through:0},{through:1},{through:3},{through:11},{through:20},{through:39},{query:'%_(),'}, {query:'남의비공개본문'}, {targetName:'가짜대상'}, {targetName:'가짜다른대상',feedbackOnly:true}, {query:'가짜 피드백',feedbackOnly:true}, {query:'존재하지않는문자'}, {page:99999}, {limit:3}]){
  const full=await ok('getMyActivityPage',{...input,withSequence:true});
  const cards=await ok('getMyActivityPage',{...input,withSequence:true,cards:true});
  assert.deepEqual(cards,{...full,rows:full.rows.map(expectedCard)});
 }
 const full=(await ok('getMyActivity',{id:3})).row;
 const cards=await ok('getMyActivityPage',{cards:true});
 assert.equal(cards.rows.find(r=>r.id===3).preview,'😀한'.repeat(53));
 assert.ok(full.reportText);assert.ok(!('reportText' in cards.rows[0]));assert.ok(!('aiFeedback' in cards.rows[0]));
});
test('활동 요약은 최근 원문 조회를 생략해도 누적 계산·역할·보고방을 유지하고 기존 호출은 그대로다',async()=>{
 const before=await ok('getMyActivities',{summary:true,aggregate:true});assert.equal(before.rows.length,3);
 await metrics(true);
 const compact=await ok('getMyActivities',{summary:true,aggregate:true,includeRecent:false});
 const measured=await metrics();
 const {rows,recent,...rest}=before;
 assert.deepEqual(compact,{...rest,rows:[]});
 assert.ok(!Object.keys(measured.db).some(k=>/my_activity_(?:detail_|card_)?page/.test(k)));
 assert.deepEqual(await ok('getMyActivities',{summary:true,aggregate:true}),before);
});
test('본문은 상세에서 그대로 읽으며 대량 경계 자료의 조회 바이트를 기록한다',async()=>{
 const large=await ok('getMyActivityPage',{withSequence:true});
 await metrics(true);
 const cards=await ok('getMyActivityPage',{withSequence:true,cards:true});
 const measured=await metrics();
 const full=(await ok('getMyActivity',{id:large.rows[0].id})).row;
 const {sequence,...expected}=large.rows[0];assert.deepEqual(full,expected);
 const bytes=x=>Buffer.byteLength(JSON.stringify(x));
 const result={dataKind:'synthetic boundary fixture',ownRows:1205,fullPageBytes:bytes(large),cardPageBytes:bytes(cards),cardDb:measured.db,productionTouched:false};
 assert.ok(result.cardPageBytes<result.fullPageBytes*.2);
 writeFileSync(output+'/activity-card-local.json',JSON.stringify(result,null,2)+'\n');
});
test('신원 고정·공개 DB 역할 거절을 유지하고 잘못된 요청과 남의 상세를 차단한다',async()=>{
 assert.equal((await api('getMyActivityPage',{cards:true})).status,401);
 assert.equal((await api('getMyActivityPage',{cards:true,memberId:ids.other},token)).status,403);
 assert.equal((await api('getMyActivity',{id:1206},token)).status,404);
 for(const input of [{page:0},{limit:200},{query:'가'.repeat(121)},{through:-1}])assert.equal((await api('getMyActivityPage',{cards:true,...input},token)).status,400);
 const signature='public.my_activity_card_page(text,text,text,integer,integer,bigint,boolean)';
 assert.equal(sql(`select prosecdef from pg_proc where oid='${signature}'::regprocedure`),'f');
 for(const role of ['anon','authenticated']){
  assert.equal(sql(`select has_function_privilege('${role}','${signature}','execute')`),'f');
  const r=await fetch('http://127.0.0.1:58432/rpc/my_activity_card_page',{method:'POST',headers:{authorization:'Bearer '+jwt(role),'content-type':'application/json'},body:JSON.stringify({p_nid:ids.member,p_query:'',p_target:null,p_page:1,p_limit:20,p_through:null,p_feedback:false})});
  assert.ok(r.status>=400);
 }
 assert.equal(digest(),originalDigest,'조회 전후 활동 원문 불변');
});
