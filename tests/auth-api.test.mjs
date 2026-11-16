// 실제 handler/registry/actions를 실행한다. DB·외부 통신만 격리한다.
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, scryptSync } from 'node:crypto';
import * as fake from './helpers/fake-db.mjs';

for (const key of Object.keys(process.env)) if (/SUPABASE|TEACHERSQUARE|GEMINI|TELEGRAM|R2_|ATTEND_|BOT_TOKEN|VERCEL/.test(key)) delete process.env[key];
process.env.AUTH_SIGNING_KEY = 'local-only-auth-test-key-32-bytes-or-more';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'local-only-fake-db-key';
process.env.TEACHERSQUARE_CRON_KEY = 'local-only-cron-key';
process.env.TEACHER_EXPORT_PW = 'local-only-export-password';
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error('Network disabled in auth tests'); };
mock.module('../server/lib/db.js', { exports: { db: fake.db, run: fake.run, selectAll: fake.selectAll, isDuplicate: fake.isDuplicate } });
const { default: handler } = await import('../api/index.js');
const { tokenFor, tokenInfo, pinVersion } = await import('../server/lib/auth.js');
const { forgetRoster } = await import('../server/actions/roster.js');
const { kstDate, kstDateTime } = await import('../server/lib/util.js');
const { settled } = await import('../server/lib/background.js');
const { encId } = await import('../server/lib/idref.js');
const { actions } = await import('../server/registry.js');
const { withActor, currentActor } = await import('../server/lib/request-context.js');
const M = '9900000000001', E = '9900000000002', V = '9900000000003', C = '9900000000004', O = '9900000000005';
const person = (member_id, name, dept = '청년회', position = '') => ({ member_id, nid: member_id, name, dept, position, region: '1지역', tier: '활동교사', note: '', affiliation: '', sort_order: Number(member_id.slice(-2)) });
const people = [person(M,'테스트교사'), person(E,'테스트교육','교육부'), person(V,'테스트전도','전도부'), person(C,'테스트교관'), person(O,'테스트대상','장년회')];
const fixturePin = {pin_hash:scryptSync('582946','local-test-salt',32).toString('hex'),salt:'local-test-salt',ver:'seed',fails:0,locked_until:''};
let sequence = 0;
beforeEach(() => {
  fake.reset({ member_pins: people.map(p=>({...fixturePin,nid:p.nid})), teachers: people, admins: [{ ...people[1], id: 1 }, { ...people[2], id: 2 }, { ...people[3], id: 3, position: '복음방 교관' }] });
  forgetRoster(); networkAttempts = 0;
});
afterEach(async () => { await settled(); assert.equal(networkAttempts, 0, '외부 통신 시도가 없어야 한다'); });
const session = id => tokenFor(id, 'm', { pinVersion: pinVersion(fake.rows.member_pins.find(r => r.nid === id)) });
async function request(action, data = {}, token, method = 'POST') {
  let status = 200, body, headers = {};
  const response = { setHeader(k,v) { headers[k] = v; }, status(v) { status = v; return this; }, json(v) { body = v; return this; }, end() { return this; } };
  await handler({ method, body: { action, ...data, ...(token ? { _tk: token } : {}) } }, response);
  return { status, body, headers };
}
async function login(id = M, extra = {}) {
  const p = fake.rows.teachers.find(r => r.nid === id);
  return request('verifyLogin', { memberId: id, name: p.name, dept: p.dept, pin:'582946', ...extra });
}
function meeting() {
  const id = 'LOCAL-' + ++sequence;
  fake.rows.attend_meetings.push({ id: sequence, meeting_id: id, title: '[TEST] 가상 모임', date: kstDate(), start_time: '', end_time: '', status: '열림', org: '전체', questions: [], ask_district: false, ask_dept: false, slots: [] });
  return id;
}
test('명단 로그인은 만료가 있는 서로 다른 로그인 표를 발급한다', async () => {
  const a = await login(), b = await login();
  assert.equal(a.body.ok, true); assert.notEqual(a.body.token,b.body.token);
  assert.equal(tokenInfo(a.body.token).nid, M);
  assert.ok(tokenInfo(a.body.token).expiresAt <= Date.now()/1000 + 43200);
});
test('잘못된 이름·부서에는 로그인 표를 주지 않는다', async () => {
  for (const extra of [{ name: '다른사람' }, { dept: '장년회' }]) assert.equal((await login(M,extra)).body.token, undefined);
});
test('PIN 조회 장애 시 로그인은 닫히고 내부 오류는 노출되지 않는다', async () => {
  fake.faults.add('member_pins'); const r = await login();
  assert.equal(r.status,503); assert.equal(r.body.token,undefined); assert.equal(r.body.retry,true);
  assert.ok(!JSON.stringify(r.body).includes('simulated'));
});
test('독립 서명 키가 없거나 DB 키와 같으면 로그인할 수 없다', async () => {
  const original = process.env.AUTH_SIGNING_KEY;
  try { for (const value of ['', process.env.SUPABASE_SERVICE_ROLE_KEY]) { process.env.AUTH_SIGNING_KEY = value; assert.equal((await login()).status,503); } }
  finally { process.env.AUTH_SIGNING_KEY = original; }
});
test('서명 변조·이전 형식·만료된 표는 거절된다', async () => {
  const valid = session(M), parts = valid.split('.');
  const c = JSON.parse(Buffer.from(parts[1],'base64url'));
  c.iat -= 86400; c.exp -= 86400;
  const value = parts[0]+'.'+Buffer.from(JSON.stringify(c)).toString('base64url');
  const expired = value+'.'+createHmac('sha256',process.env.AUTH_SIGNING_KEY).update('login:v3:'+value).digest('base64url');
  for (const token of [valid.slice(0,-1)+(valid.endsWith('a')?'b':'a'), 'm'+M+'.'+'a'.repeat(32), expired]) {
    const r = await request('getRoster',{},token); assert.equal(r.status,401); assert.equal(r.body.auth,false);
  }
});
test('미인증 요청·알 수 없는 액션·다른 HTTP 메서드를 거절한다', async () => {
  assert.equal((await request('getRoster')).status,401);
  assert.equal((await request('unknownLegacyAction')).status,400);
  assert.equal((await request('toString')).status,400);
  assert.equal((await request('getRoster',{},session(M),'PUT')).status,405);
  assert.equal((await request('getRoster',{},undefined,'OPTIONS')).status,204);
});
test('모든 등록 비공개 액션에 공통 로그인 검사를 적용한다', async () => {
  const { PUBLIC_ACTIONS } = await import('../server/lib/auth.js');
  for (const action of Object.keys(actions)) if (!PUBLIC_ACTIONS.has(action)) assert.equal((await request(action)).status,401,action);
  assert.equal(fake.calls.length,0);
});
test('본문 작업자 사칭과 내부 신원 객체 주입을 막는다', async () => {
  assert.equal((await request('checkAdmin',{memberId:V},session(M))).status,403);
  const r = await request('checkAdmin',{_actor:{nid:V},auth:{nid:V},isAdmin:true},session(M));
  assert.equal(r.body.isAdmin,false); assert.equal(r.body.permissions.canChangeTier,false);
  assert.equal(r.headers['Cache-Control'],'no-store');
});
test('연락처 조회의 memberId는 작업자이며 관리자 번호를 사칭할 수 없다',async()=>{
  fake.rows.teacher_profiles.push({id:1,member_id:O,nid:O,phone:'TEST-PRIVATE-CONTACT'});
  assert.equal((await request('getMemberContact',{memberId:E,targetId:O},session(M))).status,403);
  assert.equal((await request('getMemberContact',{targetId:O},session(M))).body.phone,'');
  assert.equal((await request('getMemberContact',{targetId:O},session(E))).body.phone,'TEST-PRIVATE-CONTACT');
});
test('명단에서 빠진 계정의 기존 로그인 표도 거절된다', async () => {
  const token = session(M); fake.rows.teachers = fake.rows.teachers.filter(r=>r.nid!==M);
  assert.equal((await request('getRoster',{},token)).status,401);
});
test('등록 전화번호는 복구 담당자에게만 보이며 문자 미인증이어도 연락 확인에 사용할 수 있다',async()=>{
  fake.rows.member_registration_contacts.push({nid:O,phone:'01000000005',source:'self_reported',phone_verified_at:null,invalidated_at:null});
  for(const [token,status] of [[undefined,401],[session(M),200],[session(C),200]]) {
    const r=await request('getPinRecoveryContact',{targetId:O},token);
    assert.equal(r.status,status);assert.equal(r.body.contacts,undefined);
  }
  for(const id of [E,V]) {
    const r=await request('getPinRecoveryContact',{targetId:O},session(id));
    assert.equal(r.body.ok,true);assert.equal(r.body.contacts[0].phone,'01000000005');
    assert.equal(r.body.contacts[0].disputed,false);assert.equal(r.body.name,'테스트대상');
    assert.equal(r.headers['Cache-Control'],'no-store');
  }
  assert.equal((await request('getPinRecoveryContact',{targetId:'9900000000999'},session(E))).body.contacts,undefined);
});
test('일반 교사는 전체 명단을 조회할 수 있지만 직책을 지정할 수 없다', async () => {
  const r = await request('getRoster',{},session(M)); assert.equal(r.body.rows.length,people.length);
  assert.equal((await request('upsertRosterLeader',{memberId:O,name:'테스트대상',position:'지역장'},session(M))).status,403);
  assert.equal(fake.rows.teachers.find(r=>r.nid===O).position,'');
});
test('교육 담당자의 대상 직책 지정과 감사 기록은 로그인 작업자 기준이다', async () => {
  const target=fake.rows.teachers.find(t=>t.nid===O),data={memberId:encId(O),name:'테스트대상',position:'지역장',expected:Object.fromEntries(['name','dept','region','position'].map(k=>[k,target[k]||'']))},token=session(E);
  const preview=await request('previewRosterLeader',data,token);assert.equal(preview.body.ok,true);
  const r = await request('upsertRosterLeader',{...data,review:preview.body.review,confirmed:true},token);
  assert.equal(r.body.ok,true); assert.equal(fake.rows.teachers.find(r=>r.nid===O).position,'지역장');
  assert.equal(fake.rows.roster_changes[0].actor_id,E); assert.equal(fake.rows.roster_changes[0].target_id,O);
});
test('필수교육 수정은 담당자만, 대상과 기록자는 분리한다', async () => {
  const data = {memberId:O,name:'테스트대상',category:'상담교육',date:'2026-11-11',registrar:'위조기록자'};
  assert.equal((await request('updateRequiredEducation',data,session(M))).status,403);
  assert.equal((await request('updateRequiredEducation',data,session(E))).status,200);
  assert.equal(fake.rows.required_education[0].member_id,O);
  assert.equal(fake.rows.required_education_log[0].registrar,'테스트교육');
});
test('전도 담당자만 등급을 변경하며 입력된 승인자 정보는 신뢰하지 않는다', async () => {
  const data = {items:[{memberId:O,newTier:'정교사',prevTier:'활동교사'}],approverDept:'전도부',approverName:'위조승인자'};
  for (const id of [M,E]) assert.equal((await request('bulkChangeTier',data,session(id))).status,403);
  const review=(await request('previewTierChange',data,session(V))).body.review;
  const r = await request('bulkChangeTier',{...data,review,confirmed:true},session(V)); assert.equal(r.body.ok,true);
  assert.equal(fake.rows.teachers.find(r=>r.nid===O).tier,'정교사');
  assert.equal(fake.rows.tier_history[0].approver1,'전도부 테스트전도');
});
test('두 번째 겸직의 전도 권한도 확인하고 회수하면 즉시 거절한다', async () => {
  fake.rows.admins.push({...people[1],id:8,dept:'전도부'});
  const token=session(E); assert.equal((await request('checkAdmin',{},token)).body.permissions.canChangeTier,true);
  fake.rows.admins=fake.rows.admins.filter(r=>r.id!==8);
  assert.equal((await request('bulkChangeTier',{items:[]},token)).status,403);
});
test('엑셀은 공유 비밀번호만 알아도 일반 교사는 받을 수 없다', async () => {
  assert.equal((await request('exportTeacherList',{password:process.env.TEACHER_EXPORT_PW},session(M))).status,403);
  assert.equal(fake.calls.filter(c=>c.table==='alert_log').length,0);
});
test('교육·전도 담당자는 기존 추가 확인 후 실제 엑셀을 받을 수 있다', async () => {
  for (const id of [E,V]) {
    const r=await request('exportTeacherList',{password:process.env.TEACHER_EXPORT_PW},session(id));
    assert.ok(r.body.base64,JSON.stringify(r)); assert.equal(Buffer.from(r.body.base64,'base64').subarray(0,2).toString(),'PK');
  }
  assert.equal(fake.rows.alert_log.filter(r=>r.ok).length,2);
});
test('PIN 미등록과 복구 대기 계정에는 로그인 표를 발급하지 않는다',async()=>{
  fake.rows.member_pins=fake.rows.member_pins.filter(r=>r.nid!==M);
  assert.equal((await login()).body.needsRegistration,true);
  assert.equal((await request('setPin',{pin:'582946'},session(M))).status,401);
  fake.rows.member_pins.push({...fixturePin,nid:M,pin_hash:'',salt:''});
  assert.equal((await login()).body.needsRecovery,true);
  assert.equal((await request('getRoster',{},session(M))).status,401);
});
test('PIN 해제 불가와 담당자 복구의 추가 확인을 검증한다',async()=>{
  assert.ok((await request('removePin',{pin:'582946'},session(M))).body.error);
  assert.ok((await request('resetPin',{targetId:M},session(O))).body.error);
  assert.ok((await request('resetPin',{targetId:M},session(E))).body.error);
  assert.ok((await request('resetPin',{targetId:M,identityConfirmed:true,reason:'PIN 분실',adminPin:'111111'},session(E))).body.error);
  assert.equal((await login()).body.ok,true);
});
test('PIN 다섯 번 실패 후 올바른 PIN도 잠금 시간 동안 거절한다',async()=>{
  for(let i=0;i<5;i++)assert.equal((await login(M,{pin:'1111'})).body.token,undefined);
  assert.equal((await login()).body.locked,true);
});
test('PIN 상태 장애와 비공개 상태 조회는 통과되지 않는다', async () => {
  assert.equal((await request('pinStatus',{memberId:M})).status,401);
  const token=session(M); fake.faults.add('member_pins'); assert.equal((await request('pinStatus',{},token)).status,503);
});
test('동시에 같은 PIN 실패 횟수를 읽어도 한 요청만 비교할 수 있다',async()=>{
  const {checkPin}=await import('../server/actions/pins.js');
  const old=structuredClone(fake.rows.member_pins[0]);
  const results=await Promise.all(Array.from({length:12},()=>checkPin(old,'1111')));
  assert.equal(results.filter(r=>r.retry).length,11);
  assert.equal(fake.rows.member_pins[0].fails,1);
  assert.ok(results.every(r=>!r.ok));
});
test('1:1 대화는 참여자만 조회·읽음 처리할 수 있다', async () => {
  const chatId=[M,O].sort().join('__');
  fake.rows.chat_messages.push({id:1,chat_id:chatId,from_id:O,to_id:M,from_nid:O,to_nid:M,message:'테스트 비공개 대화',sent_at:kstDateTime(),is_read:false});
  for(const action of ['getMessages','markRead']) assert.equal((await request(action,{chatId:encId(chatId)},session(E))).status,403);
  assert.equal((await request('getMessages',{chatId:encId(chatId)},session(M))).body.rows.length,1);
  assert.equal((await request('markRead',{chatId},session(M))).body.updated,1);
});
test('발신자 위조를 거절하고 정상 발송에는 실제 계정을 쓴다', async () => {
  assert.equal((await request('sendMessage',{fromId:O,toId:E,message:'테스트'},session(M))).status,403);
  assert.equal((await request('sendMessage',{toId:O,message:'테스트'},session(M))).body.ok,true);
  assert.equal(fake.rows.chat_messages[0].from_id,M);
});
test('본문 관리자 표시로 타인의 도움 글을 마감할 수 없다', async () => {
  fake.rows.help_posts.push({id:1,help_id:'TEST-HELP',member_id:O,status:'모집'});
  assert.ok((await request('closeHelpPost',{helpId:'TEST-HELP',admin:true},session(M))).body.error);
  assert.equal(fake.rows.help_posts[0].status,'모집');
  assert.equal((await request('closeHelpPost',{helpId:'TEST-HELP'},session(E))).body.ok,true);
});
test('공식 일정 삭제는 전도 권한을 확인한다', async () => {
  fake.rows.calendar_events.push({id:1,event_id:'TEST-EVENT',category:'공식',created_by:V,repeat_days:[]});
  assert.ok((await request('deleteCalendarEvent',{eventId:'TEST-EVENT'},session(M))).body.error);
  assert.equal(fake.rows.calendar_events.length,1);
  assert.equal((await request('deleteCalendarEvent',{eventId:'TEST-EVENT'},session(V))).body.ok,true);
});
test('QR 모임은 공개하되 로그인 없이 이전 출석과 설문 답변을 주지 않는다', async () => {
  const meetingId=meeting(); fake.rows.attend_records.push({id:1,meeting_id:meetingId,nid:M,member_id:M,name:'테스트교사',answers:{secret:'테스트 비공개 답변'},at:kstDateTime()});
  const r=await request('getAttendMeeting',{meetingId,memberId:M}); assert.equal(r.body.mine,null); assert.ok(r.body.meeting);
  assert.equal((await request('getAttendMeeting',{meetingId,memberId:M,name:'테스트교사'})).body.mine,null);
  assert.equal((await request('getMyAttendance',{memberId:M})).status,401);
  const own=await request('getAttendMeeting',{meetingId,memberId:M,name:'테스트교사'},session(M)); assert.equal(own.body.mine.answers.secret,'테스트 비공개 답변');
  const other=await request('getAttendMeeting',{meetingId,memberId:M,name:'테스트교사'},session(E)); assert.equal(other.body.mine,null);
});
test('공개 QR 신규 제출·중복 제출은 유지하며 이전 답변은 보호한다', async () => {
  const meetingId=meeting(), data={meetingId,memberId:M,name:'테스트교사',answers:{}};
  const first=await request('submitAttendance',data); assert.equal(first.body.ok,true,JSON.stringify(first));
  fake.rows.attend_records[0].answers={secret:'이전 답변'};
  const again=await request('submitAttendance',data); assert.equal(again.body.already,true); assert.equal(again.body.record.limited,true); assert.equal(again.body.record.answers,undefined);
  assert.equal(fake.rows.attend_records.length,1);
});
test('손님은 기존 번호를 사칭하지 않고 신규 임의 식별자와 한 방의 표만 받는다', async () => {
  fake.rows.target_room_invites.push({id:1,code:'TESTCODE',target_id:'TEST-ROOM',revoked:false,expires_at:'2099-01-01 00:00:00',uses:0,max_uses:100});
  const data={memberId:'99000999',name:'테스트손님',dept:'청년회',code:'TESTCODE'};
  const a=await request('guestLogin',data), b=await request('guestLogin',data);
  assert.equal(a.body.ok,true); assert.notEqual(a.body.memberId,data.memberId); assert.notEqual(a.body.memberId,b.body.memberId);
  assert.equal(a.body.memberId,tokenInfo(a.body.token).nid); // 화면이 자신의 새 식별자로 세션을 복원할 수 있어야 한다.
  assert.equal(tokenInfo(a.body.token).roomId,'TEST-ROOM');
  assert.equal((await request('getRoster',{},a.body.token)).status,403);
  assert.equal((await request('getTargetRoom',{targetId:'OTHER-ROOM'},a.body.token)).status,403);
  assert.equal((await request('guestLogin',{...data,code:''})).body.token,undefined);
});
test('손님이 다른 초대 코드로 방을 확장하거나 남의 목록을 볼 수 없다', async () => {
  const guest='99000999', token=tokenFor(guest,'g',{roomId:'TEST-ROOM',name:'테스트손님'});
  fake.rows.target_room_invites.push({id:1,code:'DIFFCODE',target_id:'OTHER-ROOM',revoked:false});
  assert.ok((await request('joinRoomByCode',{code:'DIFFCODE'},token)).body.error);
  fake.rows.target_room_members.push({id:1,nid:guest,target_id:'OTHER-ROOM',role:'초대'});
  assert.deepEqual((await request('listMyRooms',{},token)).body.rows,[]);
});
test('대화방에 관리자라는 옛 기록이 있어도 회수된 권한으로 들어갈 수 없다', async () => {
  fake.rows.targets.push({target_id:'TEST-ROOM',creator_id:O,stage:'상담1'});
  fake.rows.target_room_members.push({id:1,target_id:'TEST-ROOM',member_id:M,nid:M,role:'관리자'});
  assert.ok((await request('getTargetRoom',{targetId:'TEST-ROOM'},session(M))).body.error);
});
test('지역 현황은 같은 지역 이름이어도 부서를 섞지 않는다', async () => {
  const r=await request('getDistrictView',{},session(M));
  assert.ok(r.body.teachers,JSON.stringify(r)); assert.ok(!r.body.teachers.some(t=>t.name==='테스트대상'));
  assert.ok(r.body.teachers.some(t=>t.name==='테스트교관'));
});
test('교관의 지역 공란은 부서 전체 답변 권한이 아니다', async () => {
  fake.rows.feedbacks.push({id:1,receipt_no:'TEST-FB',member_id:M,nid:M,source:'교관요청',status:'대기',situation:'테스트 상담'});
  fake.rows.admins.find(r=>r.nid===C).region='';
  const r=await request('getCoachFeedbacks',{},session(C)); assert.deepEqual(r.body.pending,[]);
  assert.ok((await request('submitCoachReply',{feedbackId:'TEST-FB',reply:'테스트 답변'},session(C))).body.error);
  assert.equal(fake.rows.feedbacks[0].status,'대기');
  fake.rows.admins.find(r=>r.nid===C).region='1지역';
  assert.equal((await request('getCoachFeedbacks',{},session(C))).body.pending.length,1);
  assert.equal((await request('submitCoachReply',{feedbackId:'TEST-FB',reply:'테스트 답변'},session(C))).body.ok,true);
  assert.equal((await request('getCoachFeedbacks',{coachId:V},session(C))).status,403);
});
test('겸직한 교관의 부서·지역 조합을 합치되 교차한 범위를 만들지 않는다', async () => {
  fake.rows.admins.push({...people[3],id:8,dept:'장년회',region:'2지역',position:'복음방 교관'});
  fake.rows.teachers.push(person('9900000000006','테스트장년2','장년회'));fake.rows.teachers.at(-1).region='2지역';
  for(const p of [people[0],people[4],fake.rows.teachers.at(-1)]) fake.rows.feedbacks.push({id:fake.rows.feedbacks.length+1,member_id:p.member_id,nid:p.nid,source:'교관요청',status:'대기'});
  const r=await request('getCoachFeedbacks',{},session(C));
  assert.deepEqual(r.body.pending.map(p=>p.name).sort(),['테스트교사','테스트장년2'].sort());
});
test('교관의 다른 부서 답변과 지역 공란 현황 조회를 거절한다', async () => {
  fake.rows.feedbacks.push({id:1,receipt_no:'OTHER-FB',member_id:O,nid:O,source:'교관요청',status:'대기'});
  assert.ok((await request('submitCoachReply',{feedbackId:'OTHER-FB',reply:'테스트'},session(C))).body.error);
  fake.rows.teachers.find(r=>r.nid===M).region='';assert.ok((await request('getDistrictView',{},session(M))).body.error);
});
test('손님은 정상 초대 입장·메시지 전송이 가능하고 탈퇴 후에는 거절된다', async () => {
  const guest='99000999', token=tokenFor(guest,'g',{roomId:'TEST-ROOM',name:'테스트손님'});
  fake.rows.targets.push({target_id:'TEST-ROOM',target_name:'테스트섭외자',creator_id:O,creator_nid:O,stage:'섭외'});
  fake.rows.target_room_invites.push({id:1,code:'TESTCODE',target_id:'TEST-ROOM',revoked:false,expires_at:'2099-01-01 00:00:00',uses:0,max_uses:10});
  assert.equal((await request('joinRoomByCode',{code:'TESTCODE'},token)).body.ok,true);
  const first=await request('getTargetRoom',{targetId:'TEST-ROOM',afterId:1},token);assert.equal(first.body.ok,true);assert.equal(first.body.canManage,false);
  assert.equal((await request('sendRoomMessage',{targetId:'TEST-ROOM',text:'테스트 대화'},token)).body.ok,true);
  fake.rows.target_room_members=[];assert.ok((await request('getTargetRoom',{targetId:'TEST-ROOM'},token)).body.error);
});
test('손님은 입력 번호가 담당자와 같아도 방 관리 권한을 얻지 않는다', async () => {
  const guest='99000999',token=tokenFor(guest,'g',{roomId:'TEST-ROOM',name:'테스트손님'});
  fake.rows.targets.push({target_id:'TEST-ROOM',target_name:'테스트섭외자',creator_id:guest,creator_nid:guest,stage:'상담1'});
  fake.rows.target_room_members.push({id:1,target_id:'TEST-ROOM',member_id:guest,nid:guest,role:'초대'});
  const r=await request('getTargetRoom',{targetId:'TEST-ROOM',afterId:1},token);
  assert.equal(r.body.ok,true);assert.equal(r.body.isOwner,false);assert.equal(r.body.canManage,false);
});
test('공지 변경·삭제는 일반 계정에 거절하고 지정 관리자에게 허용한다',async()=>{
  fake.rows.calendar_ads.push({id:1,ad_id:'TEST-AD',title:'기존 테스트',sort_no:1});
  const data={ad:{adId:'TEST-AD',title:'변경 테스트'}};
  assert.ok((await request('saveCalendarAd',data,session(M))).body.error);
  assert.ok((await request('deleteCalendarAd',{adId:'TEST-AD'},session(M))).body.error);
  assert.equal((await request('saveCalendarAd',data,session(E))).body.ok,true);
  assert.equal((await request('deleteCalendarAd',{adId:'TEST-AD'},session(E))).body.ok,true);
});
test('다른 사람의 매칭 상태 변경은 거절하고 참여자에게는 허용한다',async()=>{
  fake.rows.matches.push({id:1,match_id:'TEST-MATCH',from_id:O,to_id:C,status:'요청'});
  assert.ok((await request('setMatchDone',{matchId:'TEST-MATCH',status:'성사'},session(M))).body.error);
  assert.equal(fake.rows.matches[0].status,'요청');
  assert.equal((await request('setMatchDone',{matchId:'TEST-MATCH',status:'성사'},session(O))).body.ok,true);
});
test('부서 일정 수정에는 원래 부서 권한을 검사하고 작성자도 위조할 수 없다',async()=>{
  fake.rows.calendar_events.push({id:1,event_id:'TEST-EVENT',category:'부서',dept:'장년회',created_by:O,repeat_days:[]});
  const event={eventId:'TEST-EVENT',category:'부서',dept:'청년회',title:'테스트',startDate:kstDate()};
  assert.ok((await request('saveCalendarEvent',{event},session(C))).body.error);
  const mine={category:'내일정',title:'내 테스트',startDate:kstDate()};
  const r=await request('saveCalendarEvent',{event:mine,by:O},session(M));assert.equal(r.body.ok,true);
  assert.equal(fake.rows.calendar_events.at(-1).created_by,M);
});
test('예약 키는 허용된 예약 액션에서만 쓰고 일반 사용자 사칭에 쓸 수 없다', async () => {
  assert.equal((await request('tsStatus',{key:'wrong'},session(E))).status,401);
  assert.equal((await request('checkAdmin',{key:process.env.TEACHERSQUARE_CRON_KEY,memberId:V})).status,401);
  const {authenticateRequest}=await import('../server/lib/request-auth.js');
  assert.equal((await authenticateRequest('tsStatus',{key:process.env.TEACHERSQUARE_CRON_KEY})).actor.cron,true);
});
test('동시 요청의 작업자 문맥이 서로 섞이지 않는다', async () => {
  await Promise.all([M,E,V].map(nid=>withActor({nid},async()=>{ await new Promise(r=>setTimeout(r,5)); assert.equal(currentActor().nid,nid); })));
  assert.equal(currentActor(),null);
});

test('격려 메시지는 받은 사람만 읽음으로 바꿀 수 있다',async()=>{
  const at='2026-11-12 01:00:00';
  fake.rows.encouragements.push({id:1,to_id:O,to_nid:O,sent_at:at,is_read:false},{id:2,to_id:M,to_nid:M,sent_at:at,is_read:false});
  assert.equal((await request('markEncouragementRead',{messageId:O+'::'+at},session(M))).status,403);
  assert.equal(fake.rows.encouragements[0].is_read,false);
  assert.equal((await request('markEncouragementRead',{messageId:M+'::'+at},session(M))).body.ok,true);
  assert.equal(fake.rows.encouragements[1].is_read,true);
});
test('다운로드 생성 중 권한/PIN 변경 또는 감사 실패 시 파일을 반환하지 않는다',async()=>{
  for(const kind of ['role','pin','audit']){
    const savedAdmins=structuredClone(fake.rows.admins),savedTeachers=structuredClone(fake.rows.teachers),savedPins=structuredClone(fake.rows.member_pins);
    const token=session(E);let changed=false;
    const hook=q=>{if(changed||q.table!=='teachers')return;changed=true;
      if(kind==='role'){fake.rows.admins=fake.rows.admins.filter(a=>a.nid!==E);fake.rows.teachers.find(t=>t.nid===E).dept='청년회';}
      if(kind==='pin')fake.rows.member_pins.find(p=>p.nid===E).ver='revoked';
      if(kind==='audit')fake.faults.add('alert_log');};
    // 인증의 첫 명단 조회 후, 파일 준비가 시작되는 전체 명단 조회에만 주입한다.
    fake.beforeQuery.push(q=>{if(q.table==='teachers'&&q.columns==='*'&&!q.filters.length)hook(q);});
    forgetRoster();const result=await request('exportRosterSheet',{password:process.env.TEACHER_EXPORT_PW},token);
    assert.equal(changed,true,kind);assert.ok(result.body.error,kind);assert.equal(result.body.base64,undefined,kind);
    fake.rows.admins=savedAdmins;fake.rows.teachers=savedTeachers;fake.rows.member_pins=savedPins;fake.beforeQuery.length=0;fake.faults.clear();
  }
});

// 한 요청 안에서도 인증 직후 캐시된 보직으로 원문을 계속 반환하지 않는다.
test('피드백 원문을 준비하는 사이 보직이 바뀌면 이미 읽은 원문도 응답하지 않는다',async()=>{
  fake.rows.targets.push({target_id:'SCOPE-RACE',creator_id:M,creator_nid:M,target_name:'가짜대상',stage:'상담1'});
  fake.rows.target_room_members.push({id:1,target_id:'SCOPE-RACE',member_id:C,nid:C,name:'테스트교관',role:'관리자',last_read_id:0});
  fake.rows.target_ai_notes.push({id:1,target_id:'SCOPE-RACE',member_id:M,kind:'파악정보',text:'반환금지원문'});
  let changed=false;fake.beforeQuery.push(q=>{if(!changed&&q.table==='target_ai_notes'){changed=true;fake.rows.admins=fake.rows.admins.filter(a=>a.nid!==C);}});
  const result=await request('getRoomRecords',{targetId:'SCOPE-RACE'},session(C));assert.equal(changed,true);assert.ok(result.body.error);assert.doesNotMatch(JSON.stringify(result),/반환금지원문/);
});
