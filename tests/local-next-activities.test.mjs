import {before,test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import sharp from 'sharp';
import {seedLists} from './helpers/lists-fixture.mjs';
import {ids,PIN,sql,quote} from './helpers/local-db.mjs';
import {imageFixture} from './helpers/image-fixture.mjs';
import {emptyActivity,normalizeActivity,activityPayload,editActivity} from '../next-app/lib/activities.ts';
const base='http://127.0.0.1:58434',old='http://127.0.0.1:58433';
const artifact='../artifacts/next-phase5-20261112/';
const hash=x=>createHash('sha256').update(x).digest('hex');
const rows=query=>JSON.parse(sql(`select coalesce(jsonb_agg(r),'[]'::jsonb) from (${query}) r`));
async function api(action,body={},token,origin=base){const r=await fetch(origin+'/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...body,...(token?{_tk:token}:{})})});return {status:r.status,body:await r.json()};}
let token,other,input,createdId,targetId,originalPhotos,payload;
const context={name:'테스트교사',memberId:ids.member,dept:'청년회',today:'2026-11-12',targets:[],overview:{people:[]}};
before(async()=>{
 seedLists();sql('truncate report_rooms,target_room_messages,target_room_members,target_room_invites,target_ai_notes restart identity');
 token=(await api('verifyLogin',{memberId:ids.member,name:'테스트교사',dept:'청년회',pin:PIN})).body.token;
 other=(await api('verifyLogin',{memberId:ids.other,name:'테스트대상',dept:'청년회',pin:PIN})).body.token;
 assert.ok(token&&other);
 input=await sharp(await imageFixture()).resize({width:1280}).jpeg({quality:94}).toBuffer();
 writeFileSync(artifact+'report-photo.jpg',input);
});
test('활동 집계·검색·쪽·대상자·공유 일지는 기존 API와 같고 1000건 이후를 포함한다',async()=>{
 const reads=[['getMyActivities',{summary:true,aggregate:true}],['getMyActivityPage',{page:1,limit:20,withSequence:true}],['getMyActivityPage',{page:21,limit:50,withSequence:true}],['getMyActivityPage',{query:'특수%_(),문자',limit:20,withSequence:true}],['getMyActivityPage',{targetName:'가짜대상',feedbackOnly:true,withSequence:true}],['getMyTargets',{includeHistory:false}],['getTargetJournal',{targetId:'LIST-1'}]];
 for(const [action,body] of reads){const next=await api(action,body,token);assert.equal(next.body.error,undefined,action);assert.deepEqual(next,await api(action,body,token,old),action);}
 const summary=(await api('getMyActivities',{summary:true,aggregate:true},token)).body;assert.equal(summary.overview.total,1205);assert.equal(summary.rows.length,3);
 const page=(await api('getMyActivityPage',{page:21,limit:50,withSequence:true},token)).body;assert.equal(page.total,1205);assert.equal(page.rows.length,50);assert.ok(page.rows.every(r=>r.sequence>0));
 assert.equal((await api('getTargetJournal',{targetId:'LIST-1'},token)).body.journal.length,1085);
 assert.doesNotMatch(JSON.stringify(summary),/남의비공개/);
});
test('로그인 전 활동 HTML은 개인 자료를 포함하지 않고 API는 비로그인·사칭을 차단한다',async()=>{
 const r=await fetch(base+'/activities');assert.equal(r.status,200);assert.doesNotMatch(await r.text(),/테스트교사|가짜대상|9900000000001|가짜 보고서/);
 for(const action of ['getMyActivities','getMyActivityPage','getMyTargets','submitActivity','updateActivity','deleteTarget']){
  assert.equal((await api(action,{})).status,401,action);
  assert.equal((await api(action,{memberId:ids.other},token)).status,403,action);
 }
});
test('새 화면의 보고를 실제 DB와 가짜 사진 저장소에 저장하고 자동 대상자·담당·집계를 유지한다',async()=>{
 const f=emptyActivity(context);Object.assign(f,{roles:['교사','인도자'],items:['복음방','동아리'],activityItem:'복음방',targetName:'가짜이관대상',targetGender:'여',targetAgeGroup:'30대',targetStage:'친분',rpLessonsEdited:true,extraTitle:'새 교육 제목',todayWork:'실제 로컬 저장 검사',nextWork:'다음 내용',reaction:'긍정적',photos:Array(3).fill('data:image/jpeg;base64,'+input.toString('base64'))});
 Object.assign(f.rp,{age:'35',phone4:'1234',faith:'미입력',recruitType:'지인',time:'오후',request:'교관 확인',nextDate:'2026-11-13',center:'가짜센터',eduWeekly:'2',lessons:[{date:'2026-11-01',title:'이전 제목'}]});normalizeActivity(f,context);payload=activityPayload(f,context);
 const result=await api('submitActivity',{...payload,name:'사칭이름'},token);assert.equal(result.status,200);assert.equal(result.body.ok,true);createdId=result.body.id;assert.equal(result.body.reported,false);assert.match(result.body.reportError,/연결/);
 const row=rows(`select * from activities where id=${createdId}`)[0];assert.equal(row.name,'테스트교사');assert.equal(row.member_id,ids.member);assert.deepEqual(row.activities,['복음방','동아리']);assert.deepEqual(row.roles,['교사','인도자']);assert.equal(row.report_text,payload.reportText);assert.equal(row.report.phone4,'1234');assert.deepEqual(row.report.lessons,payload.report.lessons);
 originalPhotos=row.report.photos;assert.equal(originalPhotos.length,3);
 for(const url of originalPhotos){assert.match(url,/^http:\/\/127\.0\.0\.1:58433\/__local_images\/report\/.*\.iv1-/);const r=await fetch(url);assert.equal(r.status,200);assert.equal(hash(Buffer.from(await r.arrayBuffer())),hash(input));assert.equal((await fetch(url.replace(/\.jpg$/,'.w320.webp'))).status,200);}
 const target=rows("select * from targets where target_name='가짜이관대상'")[0];targetId=target.target_id;assert.equal(target.creator_id,ids.member);assert.equal(target.leader_id,ids.member);assert.equal(target.stage,'복음방');assert.deepEqual(target.report_profile.lessons,payload.report.lessons);
 const summary=(await api('getMyActivities',{summary:true,aggregate:true},token)).body;assert.equal(summary.overview.total,1206);assert.equal(summary.overview.people.find(p=>p.name==='가짜이관대상').edu,1);
});
test('사진 오류는 활동 저장 전에 중단하고 이미 저장한 기록은 보고방 실패로 중복 등록하지 않는다',async()=>{
 const count=sql('select count(*) from activities');const r=await api('submitActivity',{...payload,photos:['data:image/jpeg;base64,not-an-image']},token);assert.ok(r.body.error);assert.equal(sql('select count(*) from activities'),count);
 const retry=await api('postActivityReport',{id:createdId},token);assert.match(retry.body.error,/보고방.*연결/);assert.equal(sql('select count(*) from activities'),count);
});
test('다른 계정은 보고 원문·수정·대상자 일지·수정·삭제를 거절당한다',async()=>{
 assert.equal((await api('getMyActivity',{id:createdId},other)).status,404);
 for(const [action,body]of [['updateActivity',{...payload,id:createdId}],['postActivityReport',{id:createdId}],['getTargetJournal',{targetId}],['updateTarget',{targetId,memo:'사칭'}],['deleteTarget',{targetId}]]){const result=await api(action,body,other);assert.ok(result.body.error,action);}
 assert.equal(rows(`select today_work from activities where id=${createdId}`)[0].today_work,'실제 로컬 저장 검사');
 assert.equal(rows(`select memo from targets where target_id=${quote(targetId)}`)[0].memo,'');
});
test('보고 수정은 같은 행·시각·사진·누적 제목 순서를 보존하며 본인 이름 연결만 갱신한다',async()=>{
 const target=(await api('getMyTargets',{includeHistory:false},token)).body.rows.find(t=>t.targetId===targetId),before=(await api('getMyActivity',{id:createdId},token)).body.row;
 sql(`insert into activities(member_id,name,activities,target_name,today_work) values('${ids.other}','테스트대상',array['만남1'],'가짜이관대상','다른 담당 아님');`);
 const f=editActivity(before,{...context,targets:[target]});assert.equal(f.rpTodayAt,1);f.date='2026-11-11';f.targetName='가짜이관수정';f.extraTitle='수정한 교육';f.todayWork='수정 내용';const p=activityPayload(f,{...context,targets:[target]});const r=await api('updateActivity',p,token);assert.equal(r.body.ok,true);assert.equal(r.body.reposted,false);
 const after=(await api('getMyActivity',{id:createdId},token)).body.row;assert.equal(after.submittedAt.slice(11),before.submittedAt.slice(11));assert.equal(after.submittedAt.slice(0,10),'2026-11-11');assert.deepEqual(after.report.photos,originalPhotos);assert.equal(after.reportText,p.reportText);
 const saved=rows(`select target_name,report_profile from targets where target_id=${quote(targetId)}`)[0];assert.equal(saved.target_name,'가짜이관수정');assert.equal(p.report.lessons,undefined);assert.deepEqual(saved.report_profile.lessons,[{date:'2026-11-01',title:'이전 제목'},{date:'2026-11-11',title:'수정한 교육'}]);assert.equal(sql(`select target_name from activities where nid='${ids.other}' and today_work='다른 담당 아님'`),'가짜이관대상');
 delete p.photos;assert.equal((await api('updateActivity',p,token)).body.ok,true);assert.deepEqual((await api('getMyActivity',{id:createdId},token)).body.row.report.photos,originalPhotos);
});
test('대상자 등록·중복 거절·목표 변경·완료·단계 이력은 기존 서버 계약을 따른다',async()=>{
 const r=await api('addTarget',{targetName:'가짜수동등록',stage:'없는단계',memo:'첫 메모',nextMeetingDate:'2026-11-13'},token);assert.equal(r.body.ok,true);const id=r.body.targetId;
 assert.match((await api('addTarget',{targetName:'가짜수동등록'},token)).body.error,/이미/);assert.equal(sql(`select stage from targets where target_id=${quote(id)}`),'섭외');
 sql(`update targets set goal_cohort='2026-11',goal_plan='이전 가짜 계획',goal_plan_at='2026-11-10',goal_plan_basis='이전 근거' where target_id=${quote(id)};insert into target_ai_notes(target_id,member_id,kind,text) values(${quote(id)},'${ids.member}','개강 인도 계획','보존될 계획');`);
 assert.equal((await api('updateTarget',{targetId:id,stage:'친분',goalCohort:'2026-12',completed:true,memo:'수정 메모'},token)).body.ok,true);
 const t=rows(`select * from targets where target_id=${quote(id)}`)[0];assert.equal(t.stage,'친분');assert.equal(t.completed,true);assert.equal(t.goal_cohort,'2026-12');assert.equal(t.goal_plan,'');assert.equal(t.goal_plan_at,null);assert.equal(t.goal_plan_basis,'');assert.equal(sql(`select count(*) from target_ai_notes where target_id=${quote(id)}`),'1');assert.equal(sql(`select count(*) from target_history where target_id=${quote(id)}`),'2');
});
test('대상자 삭제는 기존 담당자 연결 범위만 삭제하고 무관한 동명 기록은 보존한다',async()=>{
 sql(`insert into targets(target_id,creator_id,leader_id,target_name,stage) values('NEXT-DELETE','${ids.member}','${ids.other}','가짜삭제대상','친분');
 insert into activities(member_id,name,target_name,activities,today_work) values('${ids.member}','테스트교사','가짜삭제대상',array['만남1'],'삭제1'),('${ids.other}','테스트대상','가짜삭제대상',array['만남1'],'삭제2'),('${ids.admin}','테스트교육','가짜삭제대상',array['만남1'],'보존');
 insert into target_history(member_id,target_id,to_stage) values('${ids.member}','NEXT-DELETE','친분');
 insert into target_ai_notes(target_id,member_id,kind,text) values('NEXT-DELETE','${ids.member}','파악 정보','가짜 정보');
 insert into target_room_members(target_id,member_id,name) values('NEXT-DELETE','${ids.member}','테스트교사');
 insert into target_room_messages(target_id,from_id,body) values('NEXT-DELETE','${ids.member}','가짜 방 글');`);
 const r=await api('deleteTarget',{targetId:'NEXT-DELETE'},token);assert.equal(r.body.ok,true);assert.equal(r.body.deletedActivities,2);assert.equal(r.body.deletedHistory,1);
 for(const table of ['targets','target_history','target_ai_notes','target_room_members','target_room_messages'])assert.equal(sql(`select count(*) from ${table} where target_id='NEXT-DELETE'`),'0',table);
 assert.equal(sql("select count(*) from activities where target_name='가짜삭제대상' and today_work='보존'"),'1');assert.equal(sql(`select count(*) from targets where target_id=${quote(targetId)}`),'1');
});
