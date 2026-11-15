import {before,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {seedRemaining} from './helpers/remaining-fixture.mjs';
import {jwt,sql,ids,api,login,quote} from './helpers/local-db.mjs';
process.env.SUPABASE_URL='http://127.0.0.1:58433';process.env.SUPABASE_SERVICE_ROLE_KEY=jwt('service_role');
const old=(await import('./helpers/legacy-admin-reads.mjs')).default;
const next=(await import('../server/actions/tiers.js')).default;
const oldTarget=await import('./helpers/legacy-target-reads.mjs'), nextTarget=await import('../server/actions/targets.js');
const {forgetRoster}=await import('../server/actions/roster.js');
const {default:oldRoster}=await import('./helpers/legacy-roster-search.mjs');
const {default:newRoster}=await import('../server/actions/roster-admin.js');
const directory='../artifacts/remaining-20261112';mkdirSync(directory,{recursive:true});
let member,admin;
before(async()=>{seedRemaining();member=(await login()).body.token;admin=(await login(ids.evangel,'테스트전도',undefined,'전도부')).body.token;assert.ok(member&&admin);});
const same=async(name,body={})=>{forgetRoster();const a=await old[name](body);forgetRoster();const b=await next[name](body);assert.deepEqual(b,a,name);return b;};
test('결산·등급 심사는 월말·윤일·정책 시작 전후의 전체 결과와 500/400명 목록 상한을 보존한다',async()=>{
 for(const asOf of ['2026-11-04','2026-11-12','2026-11-30','2026-03-31','2024-02-29'])for(const action of ['getSettlementReport','checkTierChanges'])await same(action,{asOf});
 const r=await next.getSettlementReport({asOf:'2026-11-30'});assert.equal(r.inactive.length,400);assert.ok(r.inactiveTotal>400);assert.equal(r.demotions.length,500);assert.ok(r.demotionsTotal>500);
});
test('미참여자 집계는 부서·빈 기록·삭제 모임·중복 출석·미래 기록의 기존 결과를 보존한다',async()=>{
 const r=await same('getNonParticipants');assert.ok(!r.rows.find(x=>x.memberId===ids.member));
 const other=r.rows.find(x=>x.memberId===ids.other);assert.ok(!other?.noEdu); // 미래 교육도 기존처럼 포함
 assert.ok(r.rows.find(x=>x.memberId===ids.coach)?.noEdu); // 지난달 모임의 이번달 출석은 제외
});
test('지역 순위는 실제 최근 시각의 동률 순서와 역할·활동 항목 계산을 보존한다',async()=>{
 for(const dept of ['청년회','장년회','부녀회'])for(const role of ['', '교사'])await same('getTopRegions',{dept,role});
 await same('getChurchTopRegions');
});
test('활동 항목·대상자 단계 집계는 모든 역할·별칭·복수 담당·알 수 없는 항목을 보존한다',async()=>{
 for(const role of ['', '인도자','교사','섬김이','협력교사','협력','잘못된역할'])for(const action of ['getActivityItemDistribution','getTargetStageDistribution']){
  assert.deepEqual(await nextTarget.default[action]({role}),await oldTarget.default[action]({role}),action+' '+role);
 }
 assert.deepEqual(await nextTarget.default.getKeyStageCount(),await oldTarget.default.getKeyStageCount());
});
test('AI 준비 자료는 긴 누적 기록·문자 길이 제한·가린 이름 충돌에도 프롬프트 입력이 같다',async()=>{
 const target=JSON.parse(sql("select row_to_json(t) from targets t where target_id='LIST-1'"));
 for(const budget of [{},{acts:1200,history:600,notes:900,info:700,coaching:800}]){
  const old=await oldTarget.targetDossier(target,ids.member,budget),updated=await nextTarget.targetDossier(target,ids.member,budget);
  assert.deepEqual(updated,old);assert.ok(!updated.acts.join('\n').includes('남의 기록 제외'));
 }
 sql(`insert into targets(target_id,creator_id,target_name) values('RM-MASK','${ids.member}','가나다상')`);
 assert.deepEqual(await nextTarget.targetDossier(target,ids.member),await oldTarget.targetDossier(target,ids.member));
 sql("delete from targets where target_id='RM-MASK'");
 const special=JSON.parse(sql("select row_to_json(t) from targets t where target_id='RM-T'"));
 assert.deepEqual(await nextTarget.targetDossier(special,ids.member),await oldTarget.targetDossier(special,ids.member));
});
test('명단 검색은 기존 조회값·한도를 유지하고 전체 겸직과 최신 검토 버전을 제공한다',async()=>{
 for(const query of ['가짜교사','테스트','%_(),','9900000000001','가']){
  const body={memberId:ids.evangel,query},actual=await newRoster.searchRoster(body),legacy=await oldRoster.searchRoster(body);
  const rows=[];
  for(const {admins,rosterRevision,admin,...row} of actual.rows){
   const assignments=JSON.parse(sql(`select coalesce(json_agg(json_build_object('assignmentId',id,'name',name,'dept',dept,'region',region,'position',position,'phone',phone) order by id),'[]') from admins where nid=regexp_replace(regexp_replace(${quote(row.memberId)},'[^0-9]','','g'),'^0+','')`));
   assert.deepEqual(admins,assignments);
   const {assignmentId,...first}=assignments[0]||{};assert.deepEqual(admin,assignments.length?first:null);
   if(row.inRoster){
    // 같은 정규화 번호를 가진 공백/앞자리 0 표기도 있으므로 실제 명단 행으로 검토 버전을 고른다.
    const revision=sql(`select s->>'revision' from jsonb_array_elements(roster_member_state(array[(select nid from teachers where member_id=${quote(row.memberId)})])) s where s->'row'->>'member_id'=${quote(row.memberId)}`);
    assert.match(rosterRevision,/^[0-9a-f]{32}$/);assert.equal(rosterRevision,revision);
   }
   else assert.equal(rosterRevision,undefined);
   rows.push(row);
  }
  // 첫 겸직 선택/전체 겸직/검토 버전은 후속 권한 보완으로 추가된 계약이며 위에서 별도로 확인한다.
  assert.deepEqual({...actual,rows},{...legacy,rows:legacy.rows.map(({admin,...row})=>row)});
 }
 assert.equal((await newRoster.searchRoster({memberId:ids.evangel,query:'가짜교사'})).rows.length,30);
 assert.ok((await newRoster.searchRoster({memberId:ids.member,query:'테스트'})).error);
});
test('요약 계약은 기존 전체 응답을 보존하며 목록을 열기 전 큰 명단 전송을 생략한다',async()=>{
 const full=await next.getSettlementReport({}),summary=await next.getSettlementReport({summary:true});
 for(const k of ['promotionsTotal','demotionsTotal','inactiveTotal','inactiveWarn','inactiveDanger','pendingApprovalCount'])assert.equal(summary[k],full[k]);
 assert.equal(summary.centerLeadTotal,full.leaders.reduce((n,r)=>n+r.leadCount,0));assert.equal(summary.details,false);assert.equal(summary.promotions,undefined);
 const n=await next.getNonParticipants({}),s=await next.getNonParticipants({summary:true});assert.deepEqual(s.depts,n.depts);assert.deepEqual(s.meetings,n.meetings);assert.equal(s.rows,undefined);
});
const metric=async reset=>(await fetch('http://127.0.0.1:58433/__local_metrics',{method:reset?'POST':'GET'})).json();
const bytes=m=>Object.values(m.db).reduce((n,r)=>n+r.bytes,0),requests=m=>Object.values(m.db).reduce((n,r)=>n+r.requests,0);
test('같은 자료의 DB 전송·요청 수와 첫 화면 요약 전송량을 측정한다',async()=>{
 const results=[];
 const target=JSON.parse(sql("select row_to_json(t) from targets t where target_id='LIST-1'"));
 for(const [name,a,b] of [
  ...['getSettlementReport','checkTierChanges','getNonParticipants','getChurchTopRegions'].map(name=>[name,()=>old[name]({}),()=>next[name]({})]),
  ['activityItems',()=>oldTarget.default.getActivityItemDistribution({}),()=>nextTarget.default.getActivityItemDistribution({})],
  ['targetStages',()=>oldTarget.default.getTargetStageDistribution({}),()=>nextTarget.default.getTargetStageDistribution({})],
  ['dossier',()=>oldTarget.targetDossier(target,ids.member),()=>nextTarget.targetDossier(target,ids.member)],
 ]){
  forgetRoster();await metric(true);const before=await a(),m1=await metric();
  forgetRoster();await metric(true);const after=await b(),m2=await metric();assert.deepEqual(after,before,name);
  const r={name,oldBytes:bytes(m1),newBytes:bytes(m2),oldRequests:requests(m1),newRequests:requests(m2)};
  assert.ok(r.newBytes<r.oldBytes*.8,JSON.stringify(r));results.push(r);
 }
 const initial=[];
 for(const name of ['getSettlementReport','getNonParticipants']){
  const full=await next[name]({}),summary=await next[name]({summary:true});initial.push({name,fullBytes:Buffer.byteLength(JSON.stringify(full)),summaryBytes:Buffer.byteLength(JSON.stringify(summary))});
 }
 writeFileSync(directory+'/measurements.json',JSON.stringify({syntheticOnly:true,results,initial,productionTouched:false},null,2));
});
test('비로그인·손님·번호 대입과 SQL 직접 실행은 차단하고 기존 전체 읽기 권한을 유지한다',async()=>{
 sql("insert into target_room_invites(code,target_id,expires_at,max_uses) values('READTEST','LIST-1','2099-01-01',100) on conflict(code) do update set revoked=false,uses=0");
 const guest=(await api('guestLogin',{memberId:'99000999',name:'가짜손님',dept:'청년회',code:'READTEST'})).body.token;assert.ok(guest);
 for(const action of ['getSettlementReport','checkTierChanges','getNonParticipants','getActivityItemDistribution','getTargetStageDistribution','getKeyStageCount','getChurchTopRegions']){
  assert.equal((await api(action,{summary:true})).status,401);
  assert.equal((await api(action,{},guest)).status,403);
  assert.equal((await api(action,{memberId:ids.other},member)).status,403);
  assert.equal((await api(action,{summary:true},member)).status,200);
 }
 assert.ok((await api('searchRoster',{query:'테스트'},member)).body.error);assert.ok((await api('searchRoster',{query:'테스트'},admin)).body.rows.length);
 assert.ok((await api('getTargetJournal',{targetId:'STAT-5'},member)).body.error);
 for(const signature of ['participation_facts(timestamp)','activity_item_counts(integer,text,jsonb,boolean)','target_stage_counts(text)','target_coaching_page(text[],text,text,boolean,integer,integer,bigint)']){
  for(const role of ['anon','authenticated'])assert.equal(sql(`select has_function_privilege('${role}','public.${signature}','execute')`),'f');
  assert.equal(sql(`select prosecdef from pg_proc where oid='public.${signature}'::regprocedure`),'f');
 }
 assert.equal(sql("select has_table_privilege('anon','public.target_dossier_activities','select')"),'f');
});
test('동시 요약 요청에서도 같은 합계와 응답을 유지한다',async()=>{
 const start=performance.now();
 const result=await Promise.all(Array.from({length:8},async()=>{
  const at=performance.now();const responses=await Promise.all(['getSettlementReport','getNonParticipants'].map(action=>api(action,{summary:true},member)));
  assert.ok(responses.every(r=>r.status===200&&!r.body.error));return {elapsedMs:performance.now()-at,bodies:responses.map(r=>r.body)};
 }));
 for(const r of result)assert.deepEqual(r.bodies,result[0].bodies);
 writeFileSync(directory+'/concurrency.json',JSON.stringify({syntheticOnly:true,clients:8,requests:16,totalMs:performance.now()-start,clientMs:result.map(r=>r.elapsedMs),productionTouched:false},null,2));
});
test('읽기 최적화는 교사·활동·출석·승인·대상자 원본을 변경하지 않는다',async()=>{
 const digest=()=>['teachers','activities','attend_records','tier_approvals','targets','target_history','target_ai_notes','feedbacks'].map(t=>sql(`select md5(coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text,'[]')) from ${t} r`));
 const before=digest();await next.getSettlementReport({});await next.getNonParticipants({});await nextTarget.default.getKeyStageCount();
 const target=JSON.parse(sql("select row_to_json(t) from targets t where target_id='LIST-1'"));await nextTarget.targetDossier(target,ids.member);
 assert.deepEqual(digest(),before);
});
