import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {api,login,ids,sql,quote,jwt} from './helpers/local-db.mjs';
import {seedRooms} from './helpers/rooms-fixture.mjs';
let owner,admin,other,coach;
const request=async(action,body={},token=owner)=>(await api(action,{targetId:'LIST-1',...body},token)).body;
const proof=(nid=ids.member)=>JSON.parse(sql(`select jsonb_build_object('actorId',${quote(nid)},'actorNid',${quote(nid)},'actorName',(select name from teachers where teachers.nid=${quote(nid)}),'actorVer',(select ver from member_pins where member_pins.nid=${quote(nid)}),'actorState',jsonb_build_object('teacher',(select jsonb_build_array(member_id,name,dept,position) from teachers where teachers.nid=${quote(nid)}),'admins',coalesce((select jsonb_agg(jsonb_build_array(id,member_id,name,dept,position) order by id) from admins where admins.nid=${quote(nid)}),'[]'::jsonb)),'targetId','LIST-1','expected',room_access_revision('LIST-1',${quote(nid)}),'canManage',true,'isOwner',${nid===ids.member})`));
const apply=(p,operation,extra={})=>JSON.parse(sql(`select room_membership_apply(${quote(JSON.stringify({...p,operation,...extra}))}::jsonb)`));
const snapshot=()=>JSON.parse(sql(`select jsonb_build_object(${['targets','target_room_messages','target_room_members','target_room_invites','room_attachments'].map(t=>`'${t}',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb)::text) from ${t} x)`).join(',')})`));
function failOn(table,event){sql(`create function local_room_write_failure() returns trigger language plpgsql as $$begin raise exception 'local forced failure';end$$;create trigger local_room_write_failure before ${event} on ${table} for each statement execute function local_room_write_failure();`);return()=>sql(`drop trigger local_room_write_failure on ${table};drop function local_room_write_failure()`);}
const invitee=async(token=owner)=>(await request('searchRoomInvitees',{query:'테스트대상'},token)).rows.find(r=>r.name==='테스트대상');
beforeEach(async()=>{seedRooms();owner=(await login()).body.token;admin=(await login(ids.admin,'테스트교육')).body.token;other=(await login(ids.other,'테스트대상')).body.token;coach=(await login(ids.coach,'테스트교관')).body.token;});

test('직접 초대·고정·링크 생성/취소·퇴장과 현재 담당 보호를 유지한다',async()=>{
 const person=await invitee(admin);assert.ok(person.key);assert.equal((await request('inviteToRoom',{query:'테스트대상',key:person.key},admin)).ok,true);
 assert.equal((await request('getTargetRoom',{},other)).canManage,false);assert.equal((await request('pinRoomMessage',{id:1,pinned:false},other)).ok,true);
 assert.ok((await request('createRoomInvite',{},other)).error);
 const link=await request('createRoomInvite',{},admin);assert.equal(link.hours,24);assert.equal(link.max,5);
 assert.equal((await request('revokeRoomInvite',{code:link.raw})).ok,true);assert.ok((await request('joinRoomByCode',{code:link.raw},coach)).error);
 const key=Number(sql(`select id from target_room_members where nid='${ids.member}'`));
 sql(`update target_room_members set role='초대' where nid='${ids.member}'`);
 assert.ok((await request('leaveRoom',{key},admin)).error);assert.ok((await request('leaveRoom')).error);
 assert.equal((await request('leaveRoom',{},other)).ok,true);assert.ok((await request('getTargetRoom',{},other)).error);
});
test('이미 담당인 추천자는 추가 초대를 요구하지 않으며 옛 자동 행은 초대로 보지 않는다',async()=>{
 const room=await request('getTargetRoom');
 for(const name of ['테스트교사','테스트교관','테스트전도'])assert.equal(room.crew.find(p=>p.name===name)?.joined,true,name);
});
test('같은 계정의 동시 링크 참여는 사용 1회·멤버 1명·안내 1건만 남긴다',async()=>{
 const results=await Promise.all([request('joinRoomByCode',{code:'ROOMTEST'},other),request('joinRoomByCode',{code:'ROOMTEST'},other)]);
 assert.equal(results.filter(r=>r.ok).length,2,JSON.stringify(results));assert.equal(results.filter(r=>r.already).length,1);
 assert.equal(sql("select uses from target_room_invites where code='ROOMTEST'"),'1');assert.equal(sql(`select count(*) from target_room_members where nid='${ids.other}'`),'1');assert.equal(sql("select count(*) from target_room_messages where body like '%초대 링크로 들어왔어요%'"),'1');
});
test('서로 다른 계정이 마지막 초대 자리로 들어와도 정원을 넘지 않는다',async()=>{
 sql("update targets set leader_id='' where target_id='LIST-1';update target_room_invites set max_uses=1 where code='ROOMTEST'");
 const results=await Promise.all([request('joinRoomByCode',{code:'ROOMTEST'},other),request('joinRoomByCode',{code:'ROOMTEST'},coach)]);
 assert.equal(results.filter(r=>r.ok).length,1,JSON.stringify(results));assert.equal(results.filter(r=>r.error).length,1);assert.equal(sql("select uses from target_room_invites where code='ROOMTEST'"),'1');
});
test('링크 참여의 안내 저장 실패는 사용 횟수·멤버 등록도 되돌린다',async()=>{
 const before=snapshot(),clear=failOn('target_room_messages','insert');
 try{assert.ok((await request('joinRoomByCode',{code:'ROOMTEST'},other)).error);assert.deepEqual(snapshot(),before);}finally{clear();}
 assert.equal((await request('joinRoomByCode',{code:'ROOMTEST'},other)).ok,true);
});
test('명시 초대 실패 때 이전 자동 관리자 역할을 유지하고 재시도는 초대 1건이다',async()=>{
 sql(`insert into target_room_members(target_id,member_id,name,role) values('LIST-1','${ids.other}','테스트대상','관리자')`);
 const person=await invitee(),before=snapshot(),clear=failOn('target_room_messages','insert');
 try{assert.ok((await request('inviteToRoom',{query:'테스트대상',key:person.key})).error);assert.deepEqual(snapshot(),before);}finally{clear();}
 const results=await Promise.all([request('inviteToRoom',{query:'테스트대상',key:person.key}),request('inviteToRoom',{query:'테스트대상',key:person.key})]);
 assert.equal(results.filter(r=>r.ok).length,1);assert.equal(sql(`select role from target_room_members where nid='${ids.other}'`),'초대');assert.equal(sql("select count(*) from target_room_messages where body like '%테스트대상 님을 초대했어요.'"),'1');
});
test('나가기 안내 저장 실패는 멤버를 되돌리고 남의 멤버를 대신 나가게 할 수 없다',async()=>{
 await request('joinRoomByCode',{code:'ROOMTEST'},other);const before=snapshot(),clear=failOn('target_room_messages','insert');
 try{assert.ok((await request('leaveRoom',{},other)).error);assert.deepEqual(snapshot(),before);}finally{clear();}
 const key=Number(sql(`select id from target_room_members where nid='${ids.admin}'`));assert.ok((await request('leaveRoom',{key},other)).error);
 assert.equal((await request('leaveRoom',{},other)).ok,true);
});
test('지역 보직·PIN·담당/초대가 판단 뒤 바뀌면 모든 관리/읽음 쓰기를 차단한다',()=>{
 const operations=[['read',{lastId:350}],['createInvite',{code:'RACETEST'}],['revokeInvite',{code:'ROOMTEST'}],['invite',{invitee:{}}],['leave',{key:1}],['pin',{id:1,pinned:false}],['deleteRoom',{}]];
 const p=proof(ids.admin);sql(`update admins set region='2지역' where nid='${ids.admin}' and position='복음방교관'`);const before=snapshot();
 for(const [operation,extra]of operations)assert.equal(apply(p,operation,extra).stale,true,operation);assert.deepEqual(snapshot(),before);
 const own=proof();sql(`update member_pins set ver='revoked' where nid='${ids.member}'`);for(const [operation,extra]of operations)assert.ok(apply(own,operation,extra).error,operation);assert.deepEqual(snapshot(),before);
});
test('현재 초대 관계가 사라지거나 대상자 담당이 바뀐 뒤 과거 고정 요청은 차단한다',()=>{
 sql(`insert into target_room_members(target_id,member_id,name,role)values('LIST-1','${ids.other}','테스트대상','초대')`);
 const p={...proof(ids.other),canManage:false};sql(`delete from target_room_members where nid='${ids.other}'`);assert.equal(apply(p,'pin',{id:1,pinned:false}).stale,true);
 const own=proof();sql(`update targets set creator_id='${ids.coach}' where target_id='LIST-1'`);assert.equal(apply(own,'pin',{id:1,pinned:false}).stale,true);assert.equal(sql('select pinned from target_room_messages where id=1'),'t');
});
test('검색 뒤 명단이 달라진 수신자는 과거 검색 결과로 초대하지 않는다',()=>{
 const p=proof(),candidate=JSON.parse(sql(`select jsonb_build_object('member_id',member_id,'nid',nid,'name',name,'dept',dept,'region',region,'affiliation',affiliation,'position',position) from teachers where nid='${ids.other}'`));
 sql(`update teachers set name='변경된가짜이름' where nid='${ids.other}'`);const before=snapshot();assert.ok(apply(p,'invite',{invitee:candidate}).error);assert.deepEqual(snapshot(),before);
});
test('회수·만료된 링크를 DB 확정에서 확인하고 손님의 방/만료 증거를 검사한다',()=>{
 const p=proof(ids.other);sql("update target_room_invites set revoked=true where code='ROOMTEST'");assert.ok(apply(p,'join',{code:'ROOMTEST'}).error);
 sql("update target_room_invites set revoked=false,expires_at='2000-01-01' where code='ROOMTEST'");assert.ok(apply(p,'join',{code:'ROOMTEST'}).error);
 const guest={actorGuest:true,actorId:'99000111',actorNid:'99000111',actorName:'가짜손님',targetId:'LIST-1',actorRoom:'LIST-2',actorExpires:Math.floor(Date.now()/1000)+3600};
 assert.ok(apply(guest,'join',{code:'ROOMTEST'}).error);assert.ok(apply({...guest,actorRoom:'LIST-1',actorExpires:0},'join',{code:'ROOMTEST'}).error);assert.equal(sql("select uses from target_room_invites where code='ROOMTEST'"),'0');
});
test('삭제된 글/다른 방 글/없는 글 고정은 성공으로 표시하지 않는다',async()=>{
 sql('update target_room_messages set deleted=true where id=1');
 for(const body of [{id:1},{id:999999},{id:2,targetId:'LIST-2'}])assert.ok((await request('pinRoomMessage',{...body,pinned:true})).error);assert.equal(sql('select pinned from target_room_messages where id=2'),'f');
});
test('늦은 읽음 요청으로 읽은 위치를 뒤로 되돌리지 않는다',()=>{
 const p=proof();assert.equal(apply(p,'read',{lastId:350}).ok,true);assert.equal(apply(p,'read',{lastId:50}).ok,true);assert.equal(sql(`select last_read_id from target_room_members where nid='${ids.member}'`),'350');
});
test('처음 관리자가 입장할 때 안내 글 실패는 자동 멤버 생성도 되돌린다',async()=>{
 sql(`delete from target_room_members where nid='${ids.admin}'`);const before=snapshot(),clear=failOn('target_room_messages','insert');
 try{assert.ok((await request('getTargetRoom',{},admin)).error);assert.deepEqual(snapshot(),before);}finally{clear();}
 const room=await request('getTargetRoom',{},admin);assert.equal(room.canManage,true);assert.equal(sql(`select count(*) from target_room_members where nid='${ids.admin}'`),'1');
});
test('방 삭제 어느 단계의 실패도 대화·링크·멤버·미완료 첨부·세대를 함께 되돌린다',async()=>{
 const file=await request('roomFileUpload',{fileName:'가짜대기.pdf',data:Buffer.from('%PDF-1.4\n%%EOF').toString('base64')});assert.ok(file.url,file.error);
 const before=snapshot();
 for(const [table,event]of [['target_room_messages','delete'],['target_room_invites','delete'],['target_room_members','delete'],['room_attachments','update'],['targets','update']]){
  const clear=failOn(table,event);try{assert.ok((await request('deleteRoom')).error,table);assert.deepEqual(snapshot(),before,table);}finally{clear();}
 }
});
test('방 삭제는 활동·상담을 보존하며 과거 요청/미완료 첨부는 새 빈 방에 확정되지 않는다',async()=>{
 const p=proof(),count=sql('select count(*) from activities'),notes=sql("select count(*) from target_ai_notes where target_id='LIST-1'");
 const file=await request('roomFileUpload',{fileName:'가짜대기.pdf',data:Buffer.from('%PDF-1.4\n%%EOF').toString('base64')});assert.ok(file.url);
 assert.ok((await request('deleteRoom',{},admin)).error);assert.equal((await request('deleteRoom')).ok,true);
 for(const table of ['target_room_messages','target_room_members','target_room_invites'])assert.equal(sql(`select count(*) from ${table} where target_id='LIST-1'`),'0');
 assert.equal(sql('select count(*) from activities'),count);assert.equal(sql("select count(*) from target_ai_notes where target_id='LIST-1'"),notes);assert.equal(sql("select room_generation from targets where target_id='LIST-1'"),'1');
 assert.equal(apply(p,'createInvite',{code:'STALETEST'}).stale,true);const old=JSON.parse(sql(`select room_message_apply(${quote(JSON.stringify({...p,operation:'send',text:'stale',attachments:[]}))}::jsonb)`));assert.equal(old.stale,true);
 assert.ok((await request('sendRoomMessage',{file:{url:file.url,name:file.name}})).error);
 assert.equal((await request('getTargetRoom')).messages.length,0);assert.equal((await request('sendRoomMessage',{text:'새 방 메시지'})).ok,true);
});
test('익명/일반 키로 관리 확정 함수를 직접 실행하지 못한다',async()=>{
 for(const role of ['anon','authenticated']){const r=await fetch('http://127.0.0.1:58432/rpc/room_membership_apply',{method:'POST',headers:{Authorization:'Bearer '+jwt(role),'content-type':'application/json'},body:JSON.stringify({p:{}})});assert.ok([401,403,404].includes(r.status),role+':'+r.status);}
});

test('새 글 없는 반복 조회는 읽음 DB 쓰기나 확정 RPC를 만들지 않는다',async()=>{
 assert.equal((await request('getTargetRoom')).ok,true);
 const before=sql(`select xmin::text from target_room_members where nid='${ids.member}'`);
 await fetch('http://127.0.0.1:58433/__local_metrics',{method:'POST'});
 for(let i=0;i<3;i++){const r=await request('getTargetRoom',{afterId:350});assert.equal(r.ok,true);assert.deepEqual(r.messages,[]);}
 assert.equal(sql(`select xmin::text from target_room_members where nid='${ids.member}'`),before);
 const stats=await(await fetch('http://127.0.0.1:58433/__local_metrics')).json();
 assert.equal(stats.db['POST /rpc/room_membership_apply'],undefined);assert.equal(stats.db['POST /rpc/room_access_revision'],undefined);
});
