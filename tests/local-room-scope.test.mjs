import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {seed,sql,ids,login,api,quote} from './helpers/local-db.mjs';
import {OWNER} from './helpers/education-fixture.mjs';
let member,coach,education,other,appOwner;
const ok=async(action,body={},token=coach)=>{const r=await api(action,body,token);assert.equal(r.status,200,action);assert.equal(r.body.error,undefined,action+': '+r.body.error);return r.body;};
const denied=async(action,body={},token=education)=>{const r=await api(action,body,token);assert.ok(r.status>=400||r.body.error,action);return r;};
const opening=async(token=coach)=>(await ok('listOpeningRooms',{},token)).rows.map(r=>r.id).sort();
const roomState=()=>sql("select jsonb_build_array((select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from target_room_members t),(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from target_room_messages t),(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from target_room_invites t))");
beforeEach(async()=>{
 seed();sql(`truncate target_room_messages,target_room_members,target_room_invites,target_ai_notes,target_history,targets,activities,feedbacks restart identity cascade;
 update teachers set dept='장년회' where nid='${ids.other}';update teachers set dept='청년회',region='2지역' where nid='${ids.evangel}';update teachers set dept='장년회',region='2지역' where nid='${ids.fresh}';
 insert into teachers(member_id,name,dept,region)values('${OWNER}','테스트앱관리','청년회','1지역');insert into member_pins(nid,pin_hash,salt,ver)select '${OWNER}',pin_hash,salt,'room-owner' from member_pins where nid='${ids.member}';
 insert into admins(member_id,name,dept,region,position)values('${ids.coach}','테스트교관','청년회','1지역','복음방교관');
 insert into targets(target_id,creator_id,target_name,teacher_name,stage)values
 ('S-R1','${ids.member}','같은대상','같은교사','상담1'),('S-R2','${ids.evangel}','같은대상','같은교사','복음방'),('S-R3','${ids.other}','다른부서비공개','다른교사','센터수강'),('S-R4','${ids.fresh}','다른지역비공개','다른교사2','상담2'),('S-EARLY','${ids.member}','이전단계','같은교사','섭외');
 insert into target_room_members(target_id,member_id,name,role)values('S-R1','${ids.member}','테스트교사','담당'),('S-R1','${ids.coach}','테스트교관','관리자'),('S-R1','${ids.admin}','테스트교육','관리자');
 insert into target_room_messages(target_id,from_id,from_name,body)values('S-R1','${ids.member}','테스트교사','범위안본문'),('S-R2','${ids.evangel}','테스트전도','범위밖본문'),('S-R3','${ids.other}','테스트대상','다른부서본문');
 insert into target_ai_notes(target_id,member_id,kind,text)values('S-R1','${ids.member}','파악정보','범위안원문'),('S-R2','${ids.evangel}','파악정보','범위밖원문');
 insert into target_room_invites(code,target_id,created_by,created_name,expires_at)values('SCOPETST','S-R1','${ids.member}','테스트교사',now()+interval '1 day');`);
 [member,coach,education,other,appOwner]=await Promise.all([[ids.member,'테스트교사','청년회'],[ids.coach,'테스트교관','청년회'],[ids.admin,'테스트교육','청년회'],[ids.other,'테스트대상','장년회'],[OWNER,'테스트앱관리','청년회']].map(async([id,name,dept])=>(await login(id,name,undefined,dept)).body.token));assert.ok(member&&coach&&education&&other&&appOwner);
});
test('교육·앱 관리자라는 이유만으로 원문·기록·첨부·초대·수정에 접근하지 않는다',async()=>{
 const before=roomState();
 for(const token of [education,appOwner]){
  assert.deepEqual(await opening(token),[]);assert.deepEqual((await ok('listMyRooms',{},token)).rows,[]);assert.equal((await ok('getNewMarks',{},token)).room,0);
  for(const action of ['getTargetRoom','getRoomRecords','sendRoomMessage','roomFileUpload','pinRoomMessage','deleteRoomMessage','searchRoomInvitees','inviteToRoom','createRoomInvite','revokeRoomInvite','leaveRoom','deleteRoom'])await denied(action,{targetId:'S-R1',id:1,text:'금지',query:'테스트대상',fileName:'x.pdf',data:'ZmFrZQ=='},token);
 }
 assert.equal(roomState(),before);
});
test('다섯 부서 직책과 네 지역 직책은 명단/겸직에서 부서와 지역을 함께 대조한다',async()=>{
 for(const source of ['teachers','admins'])for(const position of ['회장','총무','총교관','서기','전도부장','지역장','교관','섭외 교관','복음방 교관']){
  sql(`delete from admins where nid='${ids.coach}';update teachers set position='' where nid='${ids.coach}';`);
  if(source==='teachers')sql(`update teachers set position=${quote(position)} where nid='${ids.coach}'`);else sql(`insert into admins(member_id,name,dept,region,position)values('${ids.coach}','테스트교관','청년회','1지역',${quote(position)})`);
  const result=(await ok('listOpeningRooms')).rows;assert.deepEqual(result.map(r=>r.id),['S-R1'],source+' '+position);const department=['회장','총무','총교관','서기','전도부장'].includes(position);assert.equal(result[0].dup,department?2:undefined);assert.equal(result[0].stage,department?'복음방':'상담1');
  if(department)await ok('getRoomRecords',{targetId:'S-R2'});else await denied('getRoomRecords',{targetId:'S-R2'},coach);
 }
});
test('겸직은 합치고 같은 지역명의 다른 부서·빈 지역·알 수 없는 직책은 열지 않는다',async()=>{
 assert.deepEqual(await opening(),['S-R1']);sql(`insert into admins(member_id,name,dept,region,position)values('${ids.coach}','테스트교관','장년회','2지역','지역장')`);assert.deepEqual(await opening(),['S-R1','S-R4']);await denied('getRoomRecords',{targetId:'S-R3'},coach);
 sql(`update admins set region='' where nid='${ids.coach}' and dept='청년회'`);assert.deepEqual(await opening(),['S-R4']);await denied('getTargetRoom',{targetId:'S-R1'},coach);
 sql(`delete from admins where nid='${ids.coach}';update teachers set position='교육부장' where nid='${ids.coach}'`);assert.deepEqual(await opening(),[]);
 sql(`update teachers set position='특별교관임시' where nid='${ids.coach}'`);await denied('getTargetRoom',{targetId:'S-R1'},coach);
});
test('담당 밖 중복 이름은 합치기 전에 제거하고 담당 목록의 기존 계산은 유지한다',async()=>{
 const rows=(await ok('listOpeningRooms')).rows;assert.equal(rows.length,1);assert.equal(rows[0].id,'S-R1');assert.equal(rows[0].stage,'상담1');assert.equal(rows[0].dup,undefined);assert.equal(rows[0].members,3);assert.doesNotMatch(JSON.stringify(rows),/범위밖|다른부서|다른지역/);
 const r=await ok('getRoomRecords',{targetId:'S-R1'});assert.equal(r.info[0].text,'범위안원문');
 sql(`update teachers set region='2지역' where nid='${ids.member}'`);assert.deepEqual(await opening(),[]);await denied('getRoomRecords',{targetId:'S-R1'},coach);
});
test('자동 관리자/옛 담당 참여 행은 해제 뒤 목록·미리보기·알림·직접 접근 근거가 아니다',async()=>{
 const initial=await ok('listMyRooms');assert.equal(initial.rows.length,1);assert.equal(initial.rows[0].last.text,'범위안본문');assert.equal((await ok('getNewMarks')).room,1);
 sql(`delete from admins where nid='${ids.coach}';update target_room_members set role='담당' where nid='${ids.coach}'`);
 const before=roomState();assert.deepEqual((await ok('listMyRooms')).rows,[]);assert.equal((await ok('getNewMarks')).room,0);await denied('getTargetRoom',{targetId:'S-R1'},coach);assert.equal(roomState(),before);
});
test('명시 초대는 보직과 독립적이고 자동 관리자로 승격하지 않으며 관리 기능은 현재 범위만 따른다',async()=>{
 sql(`update target_room_members set role='초대',invited_by='테스트교사' where nid='${ids.coach}'`);
 assert.equal((await ok('getTargetRoom',{targetId:'S-R1'})).canManage,true);assert.equal(sql(`select role from target_room_members where nid='${ids.coach}'`),'초대');
 sql(`delete from admins where nid='${ids.coach}'`);assert.equal((await ok('getTargetRoom',{targetId:'S-R1'})).canManage,false);assert.equal((await ok('listMyRooms')).rows.length,1);await denied('createRoomInvite',{targetId:'S-R1'},coach);assert.equal((await ok('getRoomRecords',{targetId:'S-R1'})).info.length,1);
 sql(`update target_room_members set role='관리자' where nid='${ids.coach}'`);assert.equal((await ok('getTargetRoom',{targetId:'S-R1'})).canManage,false);
});
test('이전 자동 참여자를 명시 초대로 다시 연결할 수 있고 담당 행은 초대로 덮지 않는다',async()=>{
 const found=await ok('searchRoomInvitees',{targetId:'S-R1',query:'테스트교육'},member);assert.equal(found.rows[0].joined,false);
 assert.equal((await ok('inviteToRoom',{targetId:'S-R1',query:'테스트교육',key:found.rows[0].key},member)).ok,true);
 assert.equal((await ok('getTargetRoom',{targetId:'S-R1'},education)).canManage,false);assert.equal(sql(`select role from target_room_members where nid='${ids.admin}'`),'초대');
 const self=await ok('searchRoomInvitees',{targetId:'S-R1',query:'테스트교사'},member);await denied('inviteToRoom',{targetId:'S-R1',query:'테스트교사',key:self.rows[0].key},member);assert.equal(sql(`select role from target_room_members where nid='${ids.member}'`),'담당');
});
test('오래된 자동 참여 행은 초대 코드를 검증하며 정상 코드로 초대 관계로 전환된다',async()=>{
 sql("update target_room_invites set expires_at='2000-01-01'");await denied('joinRoomByCode',{code:'SCOPETST'},education);assert.equal(sql(`select role from target_room_members where nid='${ids.admin}'`),'관리자');
 sql("update target_room_invites set expires_at=now()+interval '1 day'");assert.equal((await ok('joinRoomByCode',{code:'SCOPETST'},education)).targetId,'S-R1');assert.equal(sql(`select role from target_room_members where nid='${ids.admin}'`),'초대');assert.equal(sql('select uses from target_room_invites'),'1');
 assert.equal((await ok('joinRoomByCode',{code:'SCOPETST'},education)).already,true);assert.equal(sql('select uses from target_room_invites'),'1');
});
test('교사·인도자·섬김이 본인 담당과 손님의 한 방 초대는 보존하며 센터 모드로 넓어지지 않는다',async()=>{
 for(const mode of ['role_scoped','legacy_global']){
  sql(`update center_approval_policy set mode='${mode}',version=version+1`);assert.deepEqual(await opening(education),[]);assert.equal((await ok('getTargetRoom',{targetId:'S-EARLY'},member)).isOwner,true);
 }
 sql(`update targets set leader_id='${ids.other}' where target_id='S-EARLY'`);assert.equal((await ok('getTargetRoom',{targetId:'S-EARLY'},other)).isOwner,true);
 sql(`update targets set leader_id='',helper_id='${ids.other}' where target_id='S-EARLY'`);assert.equal((await ok('getTargetRoom',{targetId:'S-EARLY'},other)).isOwner,true);
 const guest=await ok('guestLogin',{memberId:'99000888',name:'가짜손님',dept:'청년회',code:'SCOPETST'},null);assert.ok(guest.token);await ok('joinRoomByCode',{code:'SCOPETST'},guest.token);assert.equal((await ok('getRoomRecords',{targetId:'S-R1'},guest.token)).info.length,1);assert.equal((await api('getTargetRoom',{targetId:'S-R2'},guest.token)).status,403);assert.equal((await ok('listMyRooms',{},guest.token)).rows.length,1);
});
