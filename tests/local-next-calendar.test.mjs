import {before,test} from 'node:test';
import assert from 'node:assert/strict';
import {ids,PIN,sql} from './helpers/local-db.mjs';
import {seedCalendar} from './helpers/calendar-fixture.mjs';
import sharp from 'sharp';
const base='http://127.0.0.1:58434',legacy='http://127.0.0.1:58433';
async function api(action,body={},token,origin=base){const r=await fetch(origin+'/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...body,...(token?{_tk:token}:{})})});return {status:r.status,body:await r.json()};}
const ok=async(action,body,token)=>{const r=await api(action,body,token);assert.equal(r.status,200,action);assert.equal(r.body.error,undefined,action+': '+r.body.error);return r.body;};
let member,admin,evangel,coach,other,personalId,attendeeId,cheerId,questionId;
const event=(extra={})=>({type:'행사',title:'가짜 추가 일정',startDate:'2026-11-12',endDate:'2026-11-12',category:'공식',...extra});
before(async()=>{seedCalendar();const tokens=[];for(const [id,name,dept]of [[ids.member,'테스트교사','청년회'],[ids.admin,'테스트교육','청년회'],[ids.evangel,'테스트전도','전도부'],[ids.coach,'테스트교관','청년회'],[ids.other,'테스트대상','청년회']]){const r=await ok('verifyLogin',{memberId:id,name,dept,pin:PIN});assert.ok(r.token);tokens.push(r.token);}[member,admin,evangel,coach,other]=tokens;});
test('일정·공지·질문·신청·관리자 집계는 기존 API와 같고 개인 일정/고유번호를 가린다',async()=>{
  for(const [action,body,token]of [['getCalendarEvents',{},member],['getCalendarAds',{},member],['getAdQuestions',{adId:'AD-ACTIVE'},member],['getMyEventSignups',{eventId:'CAL-EVENT'},other],['getCalendarReport',{},admin]]){const result=await ok(action,body,token);assert.deepEqual(result,(await api(action,body,token,legacy)).body,action);}
  const result=await ok('getCalendarEvents',{},member);assert.equal(result.rows.length,7);assert.ok(result.rows.some(e=>e.eventId==='CAL-PRIVATE'));assert.ok(!result.rows.some(e=>e.eventId==='CAL-OTHER'));assert.equal(result.rows.find(e=>e.eventId==='CAL-PRIVATE').createdBy,ids.member);assert.notEqual(result.rows.find(e=>e.eventId==='CAL-EVENT').createdBy,ids.evangel);assert.equal(result.rows.find(e=>e.eventId==='CAL-EVENT').attendeeCount,1005);assert.equal(result.weeks[0].items[0].theme,'가짜 종전 주간');
  const mine=await ok('getMyEventSignups',{eventId:'CAL-EVENT'},other);assert.equal(mine.totalAttendees,1005);assert.equal(mine.attendees.length,1005);assert.equal((await ok('getMyEventSignups',{eventId:'CAL-EVENT'},member)).attendees.length,0);
  const report=await ok('getCalendarReport',{},admin);assert.equal(report.total,1005);assert.equal(report.byApplicantDept['청'],502);assert.equal(report.byApplicantDept['부'],503);assert.equal(report.byStage['친분'],1005);
  const page=await fetch(base+'/calendar');assert.equal(page.status,200);assert.doesNotMatch(await page.text(),/가짜 가을|990000000000|가짜 참석자/);
});
test('로그인·신청자 사칭·일반 회원 집계·존재하지 않는/비공개 행사 신청을 차단한다',async()=>{
  for(const action of ['getCalendarEvents','getCalendarAds','getCalendarReport','saveCalendarEvent','applyEventStaff','applyEventAttendee','exportCalendarAttendees'])assert.equal((await api(action,{})).status,401,action);
  assert.equal((await api('applyEventAttendee',{eventId:'CAL-EVENT',applicantId:ids.other},member)).status,403);assert.ok((await api('getCalendarReport',{},member)).body.error);assert.equal((await api('getCalendarReport',{memberId:ids.admin},member)).status,403);
  for(const eventId of ['missing','CAL-PRIVATE','CAL-YOUTH','CAL-COURSE'])for(const action of ['getMyEventSignups','applyEventStaff','applyEventAttendee'])assert.ok((await api(action,{eventId,dept:'청',applicantDept:'청',applicantRole:'교',guestName:'가짜',guestDept:'청',guestAge:'30',guestStage:'친분'},member)).body.error,action+eventId);
});
test('공식은 전도 담당자·부서는 해당 부서 담당자·내 일정은 작성자만 변경한다',async()=>{
  for(const token of [member,admin,coach])assert.ok((await api('saveCalendarEvent',{event:event()},token)).body.error);
  assert.equal((await ok('saveCalendarEvent',{event:event()},evangel)).ok,true);
  for(const dept of ['부','교'])assert.ok((await api('saveCalendarEvent',{event:event({category:'부서',dept})},coach)).body.error);
  assert.equal((await ok('saveCalendarEvent',{event:event({category:'부서',dept:'청',region:'01지역'})},coach)).ok,true);
  const p=await ok('saveCalendarEvent',{event:event({category:'내일정',repeatDays:[3,0,3,9],repeatUntil:'2030-01-01'})},member);personalId=p.eventId;
  assert.equal(sql(`select repeat_days::text||'|'||repeat_until||'|'||created_by from calendar_events where event_id='${personalId}'`),'{0,3}|2027-11-12|'+ids.member);
  for(const token of [admin,other]){assert.ok((await api('saveCalendarEvent',{event:event({eventId:personalId,category:'내일정'})},token)).body.error);assert.ok((await api('deleteCalendarEvent',{eventId:personalId},token)).body.error);}
  assert.ok((await api('saveCalendarEvent',{event:event({eventId:'CAL-EVENT',category:'내일정'})},member)).body.error);
  assert.equal((await ok('saveCalendarEvent',{event:event({eventId:personalId,category:'내일정',title:'가짜 수정'})},member)).ok,true);
});
test('스탭 갱신과 참석자 등록은 서버 이름을 쓰고 다른 신청을 지울 수 없다',async()=>{
  assert.equal((await ok('applyEventStaff',{eventId:'CAL-EVENT',dept:'청',note:'가짜 메모',name:'사칭'},member)).ok,true);
  assert.equal((await ok('applyEventStaff',{eventId:'CAL-EVENT',dept:'부',note:'가짜 변경'},member)).updated,true);assert.equal(sql(`select count(*) from event_staff where member_id='${ids.member}'`),'1');assert.equal(sql(`select name from event_staff where member_id='${ids.member}'`),'테스트교사');
  const saved=await ok('applyEventAttendee',{eventId:'CAL-EVENT',applicantId:ids.member,applicantName:'사칭',applicantDept:'청',applicantRole:'교',guestName:'가짜 신규 참석자',guestDept:'부',guestAge:'30',guestStage:'만남1'},member);attendeeId=saved.id;
  assert.equal(sql(`select applicant_name from event_attendees where signup_id='${attendeeId}'`),'테스트교사');assert.ok((await api('deleteEventAttendee',{id:attendeeId},other)).body.error);assert.equal((await ok('getMyEventSignups',{eventId:'CAL-EVENT'},member)).attendees.length,1);
  assert.equal((await ok('cancelEventStaff',{eventId:'CAL-EVENT'},member)).ok,true);assert.equal(sql("select count(*) from event_staff where signup_id='ST-SEED'"),'1');
});
test('응원 사진은 가짜 저장소에서 원본 바이트를 보존하며 삭제 권한을 유지한다',async()=>{
  const bytes=await sharp({create:{width:60,height:40,channels:3,background:'#34694a'}}).webp().toBuffer(),photo='data:image/webp;base64,'+bytes.toString('base64');
  const saved=await ok('saveEventCheer',{eventId:'CAL-EVENT',body:'가짜 응원',name:'사칭',photos:[photo]},member);assert.equal(saved.ok,true);assert.equal(saved.cheer.name,'테스트교사');cheerId=saved.cheer.cheerId;assert.equal(saved.cheer.photos.length,1);assert.deepEqual(Buffer.from(await(await fetch(saved.cheer.photos[0])).arrayBuffer()),bytes);
  assert.ok((await api('saveEventCheer',{eventId:'CAL-PRIVATE',body:'금지'},other)).body.error);assert.ok((await api('deleteEventCheer',{cheerId},other)).body.error);assert.equal((await ok('getEventCheers',{eventId:'CAL-EVENT'},member)).rows[0].isMine,true);
  assert.equal((await ok('deleteEventCheer',{cheerId},admin)).ok,true);assert.equal(sql(`select status from event_cheers where cheer_id='${cheerId}'`),'삭제');
});
test('주간 안내는 관리자만 일요일 기준으로 쓰며 6개 과정·10개 메모 한도를 유지한다',async()=>{
  const body={weekStart:'2026-11-08',items:Array.from({length:8},(_,i)=>({cohort:'가짜'+i,theme:'주간'+i,memo:'메모'})),notes:Array(12).fill('가짜 메모')};assert.ok((await api('saveCalendarWeek',body,member)).body.error);assert.ok((await api('saveCalendarWeek',{...body,weekStart:'2026-11-09'},admin)).body.error);assert.equal((await ok('saveCalendarWeek',body,admin)).ok,true);
  const week=(await ok('getCalendarEvents',{},member)).weeks[0];assert.equal(week.items.length,6);assert.equal(week.notes.length,10);assert.equal(week.updatedBy,'테스트교육');
});
test('공지 종료일/제목 연도와 질문·관리자 답변 및 수정·삭제 범위를 보존한다',async()=>{
  const ads=await ok('getCalendarAds',{},member);assert.deepEqual(ads.rows.map(r=>r.adId),['AD-ACTIVE','AD-DATE']);assert.equal(ads.rows[1].endDate,'2027-01-05');assert.equal((await ok('getCalendarAds',{all:true},admin)).rows.length,3);
  assert.ok((await api('saveCalendarAd',{ad:{title:'금지'}},member)).body.error);const a=await ok('saveCalendarAd',{ad:{title:'가짜 추가 공지',sort:7,body:'본문',endDate:'2030-01-01'}},admin);assert.equal(a.ok,true);
  const q=await ok('saveAdQuestion',{adId:'AD-ACTIVE',text:'가짜 추가 질문',name:'사칭'},member);questionId=q.questionId;assert.equal((await ok('getAdQuestions',{adId:'AD-ACTIVE'},admin)).rows.find(r=>r.questionId===questionId).authorName,'테스트교사');
  for(const action of ['saveAdQuestion','deleteAdQuestion','answerAdQuestion'])assert.ok((await api(action,{questionId,text:'수정',answer:'답변'},member)).body.error);
  assert.equal((await ok('answerAdQuestion',{questionId,answer:'가짜 관리자 답변',name:'사칭'},admin)).ok,true);assert.equal((await ok('getAdQuestions',{adId:'AD-ACTIVE'},member)).rows.find(r=>r.questionId===questionId).answererName,'테스트교육');
  assert.equal((await ok('answerAdQuestion',{questionId,answer:''},admin)).ok,true);assert.equal(sql(`select answer||answerer_id||answerer_name from ad_questions where question_id='${questionId}'`),'');assert.equal((await ok('saveAdQuestion',{questionId,text:'가짜 질문 수정'},admin)).ok,true);assert.equal((await ok('deleteAdQuestion',{questionId},admin)).ok,true);assert.equal(sql(`select status from ad_questions where question_id='${questionId}'`),'삭제');
});
test('참석자 다운로드는 교육·전도 담당자만 비밀번호 확인 후 1000명 이후까지 받아 기록한다',async()=>{
  const password='local-only-export-password';for(const token of [member,coach])assert.equal((await api('exportCalendarAttendees',{password},token)).status,403);
  assert.ok((await api('exportCalendarAttendees',{password:'wrong'},admin)).body.error);
  for(const token of [admin,evangel]){const result=await ok('exportCalendarAttendees',{eventId:'CAL-EVENT',password},token);const csv=Buffer.from(result.base64,'base64').toString('utf8');assert.equal(result.fileName,'세미나_참석자_집계.csv');assert.equal(csv.charCodeAt(0),0xfeff);assert.equal(csv.split('\n').length,1007);assert.ok(csv.includes('가짜 참석자 1005'));assert.ok(csv.includes('가짜 신규 참석자'));}
  const audits=JSON.parse(sql("select json_agg(summary order by id) from alert_log where kind='명단엑셀' and ok=true and summary like '파일 준비 · exportCalendarAttendees · %'"));
  assert.equal(audits.length,2);assert.match(audits[0],/테스트교육/);assert.match(audits[1],/테스트전도/);
  for(const audit of audits){assert.match(audit,/"eventId":"CAL-EVENT"/);assert.match(audit,/"people":1006/);}
  assert.equal(sql("select count(*) from alert_log where kind='명단엑셀' and ok=false and summary like '비밀번호 틀림 · exportCalendarAttendees · %'"),'1');
});
test('삭제는 선택한 일정·신청 범위에 한정되고 공지 질문 원본은 기존대로 보존된다',async()=>{
  assert.equal((await ok('deleteEventAttendee',{id:attendeeId},member)).ok,true);assert.equal(sql('select count(*) from event_attendees'),'1005');assert.equal((await ok('deleteCalendarEvent',{eventId:personalId},member)).ok,true);assert.equal(sql("select count(*) from calendar_events where event_id='CAL-OTHER'"),'1');
  assert.equal((await ok('deleteCalendarAd',{adId:'AD-ACTIVE'},admin)).ok,true);assert.equal(sql("select count(*) from ad_questions where ad_id='AD-ACTIVE'"),'3');
  assert.ok((await api('deleteCalendarEvent',{eventId:'CAL-EVENT'},admin)).body.error);assert.equal((await ok('deleteCalendarEvent',{eventId:'CAL-EVENT'},evangel)).ok,true);assert.equal(sql("select count(*) from event_attendees where event_id='CAL-EVENT'"),'0');assert.equal(sql("select count(*) from event_staff where event_id='CAL-EVENT'"),'0');assert.equal(sql("select count(*) from calendar_events where event_id='CAL-YOUTH'"),'1');
});
