import {before,test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {ids,PIN,sql} from './helpers/local-db.mjs';
import {seedRooms} from './helpers/rooms-fixture.mjs';
import {imageFixture} from './helpers/image-fixture.mjs';
const base='http://127.0.0.1:58434',legacy='http://127.0.0.1:58433',artifact='../artifacts/next-phase7-20261112/';
async function api(action,body={},token,origin=base){const r=await fetch(origin+'/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...body,...(token?{_tk:token}:{})})});return {status:r.status,body:await r.json()};}
const login=async(id,name)=>(await api('verifyLogin',{memberId:id,name,dept:'청년회',pin:PIN})).body.token;
const media=(id,kind,token=owner)=>fetch(base+'/api/room-attachment',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({_tk:token,targetId:'LIST-1',id,kind})});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
let owner,admin,outsider,guest,textId,fileId,docUrl,photoUrl,photoId;
before(async()=>{seedRooms();owner=await login(ids.member,'테스트교사');admin=await login(ids.admin,'테스트교육');outsider=await login(ids.other,'테스트대상');assert.ok(owner&&admin&&outsider);});
test('방·기록·관리자 목록은 기존 응답과 같고 최신 300개 밖의 고정 글도 제공한다',async()=>{
  for(const [action,token,body]of [['getTargetRoom',owner,{targetId:'LIST-1'}],['getRoomRecords',owner,{targetId:'LIST-1'}],['listMyRooms',owner,{}],['listOpeningRooms',admin,{}]]){const result=await api(action,body,token);assert.equal(result.status,200,action);assert.equal(result.body.error,undefined,action);assert.deepEqual(result,await api(action,body,token,legacy),action);}
  const opening=(await api('listOpeningRooms',{},admin)).body.rows;assert.equal(opening.length,2);assert.deepEqual(opening.map(r=>r.id).sort(),['LIST-1','LIST-2']);const first=opening.find(r=>r.id==='LIST-1');assert.equal(first.name,'가짜대상');assert.equal(first.stage,'센터수강');assert.equal(first.dept,'청년회');assert.equal(first.members,2);assert.equal(first.room,true);assert.equal(opening.find(r=>r.id==='LIST-2').room,false);
  const room=(await api('getTargetRoom',{targetId:'LIST-1'},owner)).body;assert.equal(room.messages.length,300);assert.equal(room.messages[0].id,51);assert.equal(room.pins[0].id,1);assert.equal(room.canManage,true);assert.equal(room.isOwner,true);assert.doesNotMatch(JSON.stringify(room),/010-0000-0001|가짜대상|990000000000/);
  const records=(await api('getRoomRecords',{targetId:'LIST-1'},owner)).body;assert.equal(records.acts.length,1085);assert.equal(records.info.length,42);assert.equal(records.hearts.length,25);assert.doesNotMatch(JSON.stringify(records),/가짜대상|990000000000/);
});
test('비로그인·다른 번호 사칭·미초대 계정은 방의 조회·쓰기·초대·첨부에 접근하지 못한다',async()=>{
  for(const action of ['getTargetRoom','getRoomRecords','sendRoomMessage','pinRoomMessage','deleteRoomMessage','roomFileUpload','searchRoomInvitees','inviteToRoom','createRoomInvite','revokeRoomInvite','leaveRoom','deleteRoom']){
    const body={targetId:'LIST-1',id:1,text:'사칭',fileName:'fake.pdf',data:'ZmFrZQ=='};assert.equal((await api(action,body)).status,401,action);assert.equal((await api(action,{...body,memberId:ids.other},owner)).status,403,action);assert.ok((await api(action,body,outsider)).body.error,action);
  }const denied=await api('listOpeningRooms',{},owner);assert.equal(denied.status,200);assert.match(denied.body.error,/관리자/);
  const page=await fetch(base+'/rooms?target=LIST-1');assert.equal(page.status,200);assert.doesNotMatch(await page.text(),/가짜대상|가짜 대화|990000/);
});
test('글·사진·작은 문서·큰 문서를 가짜 저장소에 저장하고 바이트와 읽음·증분 결과를 유지한다',async()=>{
  const text=(await api('sendRoomMessage',{targetId:'LIST-1',text:'가짜대상 새 대화',name:'사칭 이름',pin:true},owner)).body;assert.equal(text.ok,true);textId=text.message.id;assert.equal(text.message.from,'테스트교사');
  const photo=await imageFixture();writeFileSync(artifact+'room-photo.jpg',photo);
  const p=(await api('sendRoomMessage',{targetId:'LIST-1',photo:'data:image/jpeg;base64,'+photo.toString('base64')},owner)).body;assert.equal(p.ok,true,p.error);photoUrl=p.message.photo;photoId=p.message.id;assert.equal(hash(Buffer.from(await(await media(photoId,'photo')).arrayBuffer())),hash(photo));
  const small=Buffer.from('%PDF-1.4\n% 가짜 첨부 검증 자료\n%%EOF\n');writeFileSync(artifact+'room-small.pdf',small);
  const uploaded=(await api('roomFileUpload',{targetId:'LIST-1',fileName:'가짜자료.pdf',data:small.toString('base64')},owner)).body;assert.equal(uploaded.size,small.length);docUrl=uploaded.url;
  const msg=(await api('sendRoomMessage',{targetId:'LIST-1',file:{url:uploaded.url,name:uploaded.name}},owner)).body;assert.equal(msg.ok,true);fileId=msg.message.id;assert.equal(msg.message.file.size,small.length);
  const large=Buffer.concat([small,Buffer.alloc(3*1024*1024+1,32)]);writeFileSync(artifact+'room-large.pdf',large);
  const direct=(await api('roomFileUpload',{targetId:'LIST-1',fileName:'큰가짜자료.pdf',size:large.length},owner)).body;assert.match(direct.put,/^http:\/\/127\.0\.0\.1:58433\/__local_image_fixture\/private\/room-private\//);
  assert.equal((await fetch(direct.put,{method:'PUT',headers:direct.headers,body:large})).status,200);
  const largeMsg=(await api('sendRoomMessage',{targetId:'LIST-1',file:{url:direct.url,name:direct.name}},owner)).body;assert.equal(largeMsg.ok,true);assert.equal(largeMsg.message.file.size,large.length);assert.equal(hash(Buffer.from(await(await media(largeMsg.message.id,'file')).arrayBuffer())),hash(large));
  const delta=(await api('getTargetRoom',{targetId:'LIST-1',afterId:350},admin)).body;assert.equal(delta.messages.length,4);assert.equal(delta.target,undefined);assert.doesNotMatch(JSON.stringify(delta),/가짜대상/);assert.ok(delta.reads.every(([,last])=>last>=354));
});
test('증분 200개 경계는 다음 ID부터 누락·중복 없이 이어지며 원문 전체 조회로 돌아가지 않는다',async()=>{
  sql(`insert into target_room_messages(target_id,from_id,from_name,body) select 'LIST-1','${ids.admin}','테스트교육','가짜 증분 '||g from generate_series(1,205)g`);
  const one=(await api('getTargetRoom',{targetId:'LIST-1',afterId:354},owner)).body,two=(await api('getTargetRoom',{targetId:'LIST-1',afterId:one.messages.at(-1).id},owner)).body;assert.equal(one.messages.length,200);assert.equal(two.messages.length,5);assert.equal(one.messages[0].id,355);assert.equal(two.messages.at(-1).id,559);assert.equal(two.pins,undefined);
});
test('고정은 참여자에게 허용하되 관리자는 남의 글을 삭제하지 못하고 소유자는 삭제할 수 있다',async()=>{
  assert.equal((await api('pinRoomMessage',{targetId:'LIST-1',id:textId,pinned:false},admin)).body.ok,true);
  assert.ok((await api('deleteRoomMessage',{targetId:'LIST-1',id:textId},admin)).body.error);
  assert.equal((await api('deleteRoomMessage',{targetId:'LIST-1',id:1},owner)).body.ok,true);assert.equal(sql('select deleted from target_room_messages where id=1'),'t');
  assert.equal((await api('deleteRoomMessage',{targetId:'LIST-1',id:fileId},owner)).body.ok,true);assert.equal((await media(fileId,'file')).status,404);
});
test('서명된 명단 초대·링크 생성/취소·만료/사용 제한은 기존 권한을 유지한다',async()=>{
  const search=(await api('searchRoomInvitees',{targetId:'LIST-1',query:'테스트대상'},admin)).body;assert.equal(search.rows.length,1);assert.doesNotMatch(JSON.stringify(search),/9900000000005/);
  assert.ok((await api('inviteToRoom',{targetId:'LIST-1',query:'테스트대상',key:'forged'},owner)).body.error);
  assert.equal((await api('inviteToRoom',{targetId:'LIST-1',query:'테스트대상',key:search.rows[0].key},admin)).body.ok,true);
  assert.equal((await api('getTargetRoom',{targetId:'LIST-1'},outsider)).body.canManage,false);
  assert.ok((await api('createRoomInvite',{targetId:'LIST-1'},outsider)).body.error);
  const invite=(await api('createRoomInvite',{targetId:'LIST-1'},admin)).body;assert.equal(invite.hours,24);assert.equal(invite.max,5);
  assert.equal((await api('revokeRoomInvite',{targetId:'LIST-1',code:invite.raw},owner)).body.ok,true);assert.ok((await api('joinRoomByCode',{code:invite.raw},outsider)).body.error);
  sql("insert into target_room_invites(code,target_id,expires_at,max_uses,uses) values('EXPIREDX','LIST-2','2000-01-01',5,0),('FULLCODE','LIST-2','2099-01-01',5,5)");
  for(const code of ['EXPIREDX','FULLCODE'])assert.ok((await api('joinRoomByCode',{code},outsider)).body.error);
});
test('손님은 별도 ID로 지정 방만 가입하고 읽기·대화·고정 후 퇴장할 수 있다',async()=>{
  const login=(await api('guestLogin',{memberId:'99000999',name:'가짜손님',dept:'청년회',code:'ROOMTEST'})).body;guest=login.token;assert.ok(guest.startsWith('g'));assert.notEqual(login.memberId,'99000999');
  assert.equal((await api('joinRoomByCode',{code:'ROOMTEST'},guest)).body.targetId,'LIST-1');assert.equal((await api('listMyRooms',{},guest)).body.rows.length,1);
  const room=(await api('getTargetRoom',{targetId:'LIST-1'},guest)).body;assert.equal(room.isOwner,false);assert.equal(room.canManage,false);assert.equal(room.invites.length,0);assert.equal(room.crew.length,0);
  assert.equal((await api('getRoomRecords',{targetId:'LIST-1'},guest)).body.info.length,42);
  for(const action of ['getTargetRoom','getRoomRecords','sendRoomMessage','roomFileUpload'])assert.equal((await api(action,{targetId:'PRIVATE',text:'금지'},guest)).status,403,action);
  for(const action of ['getMyTargets','getTeacherDirectory','targetInfoFeedback'])assert.equal((await api(action,{targetId:'LIST-1'},guest)).status,403,action);
  const msg=(await api('sendRoomMessage',{targetId:'LIST-1',name:'사칭',text:'가짜 손님 글'},guest)).body;assert.equal(msg.message.from,'가짜손님');assert.equal((await api('pinRoomMessage',{targetId:'LIST-1',id:msg.message.id,pinned:true},guest)).body.ok,true);
  assert.equal((await api('leaveRoom',{targetId:'LIST-1'},guest)).body.ok,true);assert.ok((await api('getTargetRoom',{targetId:'LIST-1'},guest)).body.error);assert.equal((await api('listMyRooms',{},guest)).body.rows.length,0);
});
test('관리자 권한 회수는 이전 관리자 멤버 행으로 우회할 수 없고 담당자를 내보낼 수 없다',async()=>{
  const room=(await api('getTargetRoom',{targetId:'LIST-1'},admin)).body,ownerKey=room.members.find(m=>m.role==='담당').key;
  assert.ok((await api('leaveRoom',{targetId:'LIST-1',key:ownerKey},admin)).body.error);
  sql(`delete from admins where nid='${ids.admin}'`);assert.ok((await api('getTargetRoom',{targetId:'LIST-1'},admin)).body.error);
  assert.ok((await api('getRoomRecords',{targetId:'LIST-1'},admin)).body.error);
  const denied=await api('listOpeningRooms',{},admin);assert.equal(denied.status,200);assert.match(denied.body.error,/관리자/);
});
test('첨부 오류를 거절하고 방 삭제는 대상자·활동·누적 기록을 보존한다',async()=>{
  for(const body of [{fileName:'x.exe',data:'ZmFrZQ=='},{fileName:'x.pdf',size:50*1024*1024+1},{fileName:'x.pdf',data:Buffer.alloc(3*1024*1024+1).toString('base64')}])assert.ok((await api('roomFileUpload',{targetId:'LIST-1',...body},owner)).body.error);
  assert.ok((await api('sendRoomMessage',{targetId:'LIST-1',file:{url:'https://example.invalid/x.pdf',name:'x.pdf'}},owner)).body.error);
  assert.ok((await api('deleteRoom',{targetId:'LIST-1'},outsider)).body.error);
  const count=sql('select count(*) from activities'),notes=sql("select count(*) from target_ai_notes where target_id='LIST-1'");assert.equal((await api('deleteRoom',{targetId:'LIST-1'},owner)).body.ok,true);
  for(const table of ['target_room_messages','target_room_members','target_room_invites'])assert.equal(sql(`select count(*) from ${table} where target_id='LIST-1'`),'0');
  assert.equal(sql("select count(*) from targets where target_id='LIST-1'"),'1');assert.equal(sql('select count(*) from activities'),count);assert.equal(sql("select count(*) from target_ai_notes where target_id='LIST-1'"),notes);assert.equal((await media(photoId,'photo')).status,404);
  assert.equal((await api('getTargetRoom',{targetId:'LIST-1'},owner)).body.messages.length,0);
});
