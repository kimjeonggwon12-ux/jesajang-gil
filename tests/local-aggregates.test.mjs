import {test,before} from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
import {ids,api,login,sql,jwt} from './helpers/local-db.mjs';
import {seedAggregates} from './helpers/aggregates-fixture.mjs';
process.env.SUPABASE_URL='http://127.0.0.1:58433';
process.env.SUPABASE_SERVICE_ROLE_KEY=jwt('service_role');
const {legacyTeacherReport}=await import('./helpers/legacy-teacher-report.mjs');
const {teacherListReportAt}=await import('../server/actions/tiers.js');
const {forgetRoster}=await import('../server/actions/roster.js');
const dir='../artifacts/db-aggregates-20261112';mkdirSync(dir,{recursive:true});
let token,legacy,overview;
const bytes=x=>Buffer.byteLength(JSON.stringify(x));
const metric=async reset=>(await fetch('http://127.0.0.1:58433/__local_metrics',{method:reset?'POST':'GET'})).json();
const totalDb=m=>Object.values(m.db).reduce((s,x)=>s+x.bytes,0);
before(async()=>{seedAggregates();token=(await login()).body.token;assert.ok(token);});
test('전체 명단은 월말·윤년·1년 심사·미래 기록·이름 보정·신청·사례 순위까지 기존 계산과 같다',async()=>{
 for(const stamp of ['2026-11-12T06:30:12.345+09:00','2026-11-30T23:59:59.999+09:00','2026-03-31T23:59:59.999+09:00','2025-03-01T00:00:00+09:00','2024-02-29T23:59:59+09:00']){
  const at=new Date(stamp);forgetRoster();const a=await legacyTeacherReport(at);forgetRoster();const b=await teacherListReportAt(at);
  assert.equal(b.rows.length,2347);assert.deepEqual(b,a,stamp);
 }
});
test('전체 집계는 원본 이력 전송 없이 같은 결과를 반환하며 DB 응답 바이트를 줄인다',async()=>{
 const now=new Date('2026-11-12T06:30:12.345+09:00');
 forgetRoster();await metric(true);const a=await legacyTeacherReport(now);const old=await metric();
 forgetRoster();await metric(true);const b=await teacherListReportAt(now);const next=await metric();assert.deepEqual(b,a);
 const measured={teachers:2347,activities:Number(sql('select count(*) from activities')),oldDbBytes:totalDb(old),newDbBytes:totalDb(next),old,new:next};
 writeFileSync(dir+'/report-measurements.json',JSON.stringify(measured,null,2));
 assert.ok(measured.newDbBytes<measured.oldDbBytes*.7,JSON.stringify({old:measured.oldDbBytes,new:measured.newDbBytes}));
 assert.ok(!Object.keys(next.db).some(k=>/^GET \/(activities|attend_records|center_leads|plaza_posts)$/.test(k)));
});
test('개인 누적 요약은 대상자별·역할별·교육·보고·피드백 결과와 최신 기록을 모두 유지한다',async()=>{
 legacy=(await api('getMyActivities',{},token)).body;
 const r=await api('getMyActivities',{summary:true,aggregate:true},token);assert.equal(r.status,200);assert.ok(!r.body.error, r.body.error);overview=r.body;
 assert.equal(overview.rows.length,3);assert.equal(overview.overview.total,legacy.rows.length);
 assert.deepEqual(overview.roleCounts,legacy.roleCounts);assert.deepEqual(overview.roleItemCounts,legacy.roleItemCounts);
 const by=new Map();for(const a of legacy.rows){const n=a.targetName.trim();if(n){if(!by.has(n))by.set(n,[]);by.get(n).push(a);}}
 const expected=[...by].map(([name,list])=>{list.sort((a,b)=>a.submittedAt.localeCompare(b.submittedAt));return {name,list};}).sort((a,b)=>b.list.at(-1).submittedAt.localeCompare(a.list.at(-1).submittedAt));
 assert.deepEqual(overview.overview.people.map(p=>p.name),expected.map(p=>p.name));
 for(const {name,list} of expected){
  const p=overview.overview.people.find(p=>p.name===name),last=list.at(-1),fbs=list.filter(a=>a.aiFeedback),posts=list.map(a=>a.tgPosts.find(x=>x.kind==='post')).filter(Boolean);
  assert.equal(p.total,list.length);assert.equal(p.edu,list.filter(a=>a.activities.some(x=>['상담1','상담2','복음방'].includes(x))).length);
  assert.equal(p.feedbackCount,fbs.length);assert.equal(p.postedCount,posts.length);assert.equal(p.last,last.submittedAt);
  assert.equal(p.lastFeedbackAt,fbs.at(-1)?.aiFeedbackAt||'');assert.deepEqual(p.lastPost,posts.at(-1)||null);
  for(const k of ['id','submittedAt','activities','roles','targetName','targetStage','tgPosts','aiFeedbackAt'])assert.deepEqual(p.latest[k],last[k],k);
  assert.equal(p.latest.hasReportText,!!last.reportText);assert.equal(p.latest.hasAiFeedback,!!last.aiFeedback);
  assert.deepEqual([...p.stageCandidates].sort(),[...new Set(list.flatMap(a=>[...a.activities,a.targetStage]))].sort());
 }
 const year=String(new Date().getFullYear());
 assert.deepEqual(overview.overview.coopRecords,legacy.rows.filter(a=>a.submittedAt.startsWith(year)&&a.roles.includes('협력교사')).map(({id,submittedAt,activities,targetName})=>({id,submittedAt,activities,targetName})));
 for(const n of overview.overview.names){const rows=legacy.rows.filter(a=>a.targetName===n.name);assert.equal(n.total,rows.length);assert.deepEqual(n.roles.sort(),[...new Set(rows.flatMap(a=>a.roles))].sort());}
});
test('보고·피드백 원문은 페이지에서 읽고 회차는 검색 전 전체 이력 기준으로 유지한다',async()=>{
 const list=legacy.rows.filter(a=>a.targetName.trim()==='가짜대상').sort((a,b)=>a.submittedAt.localeCompare(b.submittedAt));
 const seq=new Map(list.map((a,i)=>[a.id,i+1]));let seen=[],through;
 for(let page=1;;page++){
  const r=await api('getMyActivityPage',{targetName:'가짜대상',page,limit:50,feedbackOnly:true,through},token);assert.equal(r.status,200);assert.ok(!r.body.error,r.body.error);
  through=r.body.through;for(const a of r.body.rows){assert.equal(a.sequence,seq.get(a.id));const {sequence,...rest}=a;assert.deepEqual(rest,legacy.rows.find(x=>x.id===a.id));}seen.push(...r.body.rows.map(a=>a.id));if(page===r.body.pages)break;
 }
 assert.deepEqual(seen,legacy.rows.filter(a=>a.targetName.trim()==='가짜대상'&&a.aiFeedback).map(a=>a.id));
 const found=await api('getMyActivityPage',{targetName:'가짜대상',feedbackOnly:true,query:'검색 전용',withSequence:true},token);
 assert.equal(found.body.total,1);assert.equal(found.body.rows[0].sequence,seq.get(found.body.rows[0].id));
 const report=await api('getMyActivityPage',{targetName:'가짜대상',query:'특수%_(),검증',withSequence:true},token);assert.equal(report.body.total,1);assert.equal(report.body.rows[0].sequence,seq.get(report.body.rows[0].id));
});
test('누적 조회의 응답 크기는 본문 전체 및 종전 색인보다 줄고 다른 사람 기록을 포함하지 않는다',async()=>{
 await metric(true);const old=(await api('getMyActivities',{summary:true},token)).body;const oldMetric=await metric();
 await metric(true);const next=(await api('getMyActivities',{summary:true,aggregate:true},token)).body;const newMetric=await metric();
 const m={ownRecords:legacy.rows.length,legacyBytes:bytes(legacy),indexBytes:bytes(old),overviewBytes:bytes(next),oldDbBytes:totalDb(oldMetric),newDbBytes:totalDb(newMetric),old:oldMetric,new:newMetric};
 writeFileSync(dir+'/activity-measurements.json',JSON.stringify(m,null,2));
 assert.ok(m.overviewBytes<m.indexBytes*.1);assert.ok(m.newDbBytes<m.oldDbBytes*.1);
 assert.ok(!JSON.stringify(next).includes('남의비공개'));
});
test('집계와 추가 페이지도 기존 인증 경계를 유지하고 공개 DB 역할은 직접 실행할 수 없다',async()=>{
 for(const data of [{summary:true,aggregate:true},{withSequence:true},{feedbackOnly:true}]){
  const action=data.summary?'getMyActivities':'getMyActivityPage';
  assert.equal((await api(action,data)).status,401);assert.equal((await api(action,{...data,memberId:ids.other},token)).status,403);
 }
 for(const signature of ['teacher_report_facts(jsonb,jsonb,jsonb,text[])','my_activity_overview(text,integer,text[])','my_activity_detail_page(text,text,text,integer,integer,bigint,boolean)','app_trim(text)','app_add_months(timestamp,integer)']){
  for(const role of ['anon','authenticated'])assert.equal(sql(`select has_function_privilege('${role}','public.${signature}','execute')`),'f');
  assert.equal(sql(`select prosecdef from pg_proc where oid='public.${signature}'::regprocedure`),'f');
 }
 const other=(await login(ids.other,'테스트대상')).body.token;const r=await api('getMyActivities',{summary:true,aggregate:true},other);
 assert.equal(r.body.overview.people.some(p=>p.name==='가짜대상'),false);
});
