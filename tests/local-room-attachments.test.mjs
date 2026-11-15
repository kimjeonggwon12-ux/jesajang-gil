import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {api,apiBase,login,ids,sql,quote,jwt} from './helpers/local-db.mjs';
import {seedRooms} from './helpers/rooms-fixture.mjs';
import {imageFixture} from './helpers/image-fixture.mjs';
let owner,admin,other;
const bytes=Buffer.from('%PDF-1.4\n% isolated room attachment\n%%EOF\n'),hash=b=>createHash('sha256').update(b).digest('hex');
const request=async(action,body={},token=owner)=>(await api(action,{targetId:'LIST-1',...body},token)).body;
const upload=(body={},token=owner)=>request('roomFileUpload',{fileName:'가짜문서.pdf',data:bytes.toString('base64'),...body},token);
const send=(value,body={},token=owner)=>request('sendRoomMessage',{file:{url:value.url,name:value.name},...body},token);
const get=(id,kind='file',token=owner,extra={})=>fetch(apiBase+'/api/room-attachment',{method:'POST',signal:AbortSignal.timeout(15000),headers:{'content-type':'application/json'},body:JSON.stringify({_tk:token,targetId:'LIST-1',id,kind,...extra})});
beforeEach(async()=>{seedRooms();owner=(await login()).body.token;admin=(await login(ids.admin,'테스트교육')).body.token;other=(await login(ids.other,'테스트대상')).body.token;});
test('문서 원본 보존, 공개 주소 없는 응답, 로그인 후 같은 바이트를 내려받는다',async()=>{
 const value=await upload(),msg=await send(value);assert.equal(msg.ok,true,msg.error);assert.match(value.url,/^room-private:/);assert.match(msg.message.file.url,/^room-media:/);
 const response=await get(msg.message.id);assert.equal(response.status,200);assert.equal(hash(Buffer.from(await response.arrayBuffer())),hash(bytes));assert.match(response.headers.get('cache-control'),/no-store/);assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 const room=await request('getTargetRoom');assert.doesNotMatch(JSON.stringify(room),/room-private|r2.cloudflarestorage|__local_images/);
 const key=sql('select object_key from room_attachments limit 1');assert.equal((await fetch('http://127.0.0.1:58433/__local_images/private/'+key)).status,404);
});
test('비로그인, GET, 다른 방/다른 메시지/미초대자는 첨부를 받지 못한다',async()=>{
 const msg=await send(await upload());assert.equal((await get(msg.message.id,'file','')).status,401);assert.equal((await fetch(apiBase+'/api/room-attachment')).status,405);
 assert.equal((await get(msg.message.id,'file',other)).status,403);assert.equal((await get(msg.message.id,'file',owner,{targetId:'LIST-2'})).status,404);assert.equal((await get(msg.message.id+1)).status,404);
 assert.equal((await get(msg.message.id,'photo')).status,404);
});
test('같은 방의 다른 업로더·다른 방·외부 주소·공개 주소 재사용을 거절한다',async()=>{
 const value=await upload();for(const [body,token]of [[{},admin],[{targetId:'LIST-2'},owner]])assert.ok((await send(value,body,token)).error);
 for(const url of ['https://example.invalid/a.pdf','http://127.0.0.1:58433/__local_images/room-files/a.pdf'])assert.ok((await send({url,name:'x.pdf'})).error);
 assert.equal(sql("select count(*) from target_room_messages where file_url<>''"),'0');assert.equal((await send(value)).ok,true);
});
test('동시에 두 번 전송해도 하나의 메시지만 생기고 첨부는 한 번만 소비된다',async()=>{
 const value=await upload(),results=await Promise.all([send(value),send(value)]);assert.equal(results.filter(r=>r.ok).length,1,JSON.stringify(results));assert.equal(results.filter(r=>r.error).length,1);
 assert.equal(sql('select count(*) from room_attachments where message_id is not null'),'1');assert.equal(sql("select count(*) from target_room_messages where file_url<>''"),'1');assert.ok((await send(value)).error);
});
test('큰 파일은 확정 사본을 쓰므로 서명 업로드 재사용으로 원본을 바꿀 수 없다',async()=>{
 const large=Buffer.concat([bytes,Buffer.alloc(3*1024*1024+1,32)]),value=await upload({data:null,size:large.length});assert.ok(value.put,value.error);
 assert.equal((await fetch(value.put,{method:'PUT',headers:value.headers,body:large})).status,200);const msg=await send(value);assert.equal(msg.ok,true,msg.error);
 await fetch(value.put,{method:'PUT',headers:value.headers,body:Buffer.from('changed')});const response=await get(msg.message.id);assert.equal(response.status,200);assert.equal(hash(Buffer.from(await response.arrayBuffer())),hash(large));
});
test('미완료·크기 불일치·만료된 업로드는 메시지로 확정되지 않는다',async()=>{
 const value=await upload({data:null,size:bytes.length+1});assert.ok((await send(value)).error);await fetch(value.put,{method:'PUT',headers:value.headers,body:bytes});assert.ok((await send(value)).error);
 const small=await upload();sql("update room_attachments set expires_at=now()-interval '1 second'");assert.ok((await send(small)).error);assert.equal(sql("select count(*) from target_room_messages where file_url<>''"),'0');
});
test('사진 원본과 작은 표시용 사본, 사진·문서 동시 저장을 유지한다',async()=>{
 const photo=await imageFixture(),file=await upload(),msg=await send(file,{photo:'data:image/jpeg;base64,'+photo.toString('base64')});assert.equal(msg.ok,true,msg.error);
 const original=await get(msg.message.id,'photo');assert.equal(original.status,200);assert.equal(hash(Buffer.from(await original.arrayBuffer())),hash(photo));
 const preview=await get(msg.message.id,'photo',owner,{variant:'preview'});assert.equal(preview.status,200);assert.ok((await preview.arrayBuffer()).byteLength<photo.length);assert.equal(sql('select count(*) from room_attachments where message_id is not null'),'2');
});
test('보직·초대 회수와 PIN 변경 및 삭제 뒤의 새 다운로드를 차단한다',async()=>{
 const msg=await send(await upload());assert.equal((await get(msg.message.id,'file',admin)).status,200);
 sql(`delete from admins where nid='${ids.admin}' and position='복음방교관'`);assert.equal((await get(msg.message.id,'file',admin)).status,403);
 sql(`insert into target_room_members(target_id,member_id,name,role)values('LIST-1','${ids.other}','테스트대상','초대')`);assert.equal((await get(msg.message.id,'file',other)).status,200);
 sql(`delete from target_room_members where nid='${ids.other}'`);assert.equal((await get(msg.message.id,'file',other)).status,403);
 assert.equal((await request('deleteRoomMessage',{id:msg.message.id})).ok,true);assert.equal((await get(msg.message.id)).status,404);assert.equal(sql('select count(*) from room_attachments'),'1');
 const second=await send(await upload());sql(`update member_pins set ver='changed' where nid='${ids.member}'`);assert.equal((await get(second.message.id)).status,401);
});
test('손님은 지정 방 첨부만 사용하고 퇴장 후 새 다운로드를 받지 못한다',async()=>{
 const guest=(await api('guestLogin',{memberId:'99000999',name:'가짜손님',dept:'청년회',code:'ROOMTEST'})).body.token;assert.ok(guest);await api('joinRoomByCode',{code:'ROOMTEST'},guest);
 const value=await upload({},guest),msg=await send(value,{},guest);assert.equal(msg.ok,true,msg.error);assert.equal((await get(msg.message.id,'file',guest)).status,200);
 assert.equal((await get(msg.message.id,'file',guest,{targetId:'LIST-2'})).status,403);await request('leaveRoom',{},guest);assert.equal((await get(msg.message.id,'file',guest)).status,403);
});
test('권한 판단 뒤 지역이 바뀌면 DB 확정 단계가 거절한다',async()=>{
 const proof=JSON.parse(sql(`select jsonb_build_object('actorId','${ids.admin}','actorNid','${ids.admin}','actorName','테스트교육','actorVer',(select ver from member_pins where nid='${ids.admin}'),'actorState',jsonb_build_object('teacher',(select jsonb_build_array(member_id,name,dept,position) from teachers where nid='${ids.admin}'),'admins',(select jsonb_agg(jsonb_build_array(id,member_id,name,dept,position) order by id) from admins where nid='${ids.admin}')),'targetId','LIST-1','expected',room_access_revision('LIST-1','${ids.admin}'),'operation','send','text','거절해야 하는 글','attachments','[]'::jsonb)`));
 sql(`update admins set region='2지역' where nid='${ids.admin}' and position='복음방교관'`);
 const result=JSON.parse(sql(`select room_message_apply(${quote(JSON.stringify(proof))}::jsonb)`));assert.equal(result.stale,true);assert.equal(sql("select count(*) from target_room_messages where body='거절해야 하는 글'"),'0');
});
test('메시지 저장 실패는 첨부 소비와 읽음 변경을 남기지 않는다',async()=>{
 const value=await upload(),before=sql('select sum(last_read_id) from target_room_members');
 sql("create function local_room_failure() returns trigger language plpgsql as $$begin raise exception 'local forced failure';end$$;create trigger local_room_failure before insert on target_room_messages for each row execute function local_room_failure();");
 try{assert.ok((await send(value)).error);assert.equal(sql('select count(*) from room_attachments where message_id is not null'),'0');assert.equal(sql('select sum(last_read_id) from target_room_members'),before);}finally{sql('drop trigger local_room_failure on target_room_messages;drop function local_room_failure()');}
 assert.equal((await send(value)).ok,true);
});
test('익명·일반 Supabase 키로 첨부 표나 확정 함수를 직접 사용할 수 없다',async()=>{
 for(const role of ['anon','authenticated']){const token=jwt(role);for(const [path,body]of [['room_attachments',null],['rpc/room_message_apply',{p:{}}],['rpc/room_access_revision',{p_tid:'LIST-1',p_nid:ids.member}]]){const r=await fetch('http://127.0.0.1:58432/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert.ok([401,403,404].includes(r.status),path+':'+r.status);}}
});
test('기존 공개 문서·인라인 사진도 인증 경로로 읽으며 원본은 그대로 둔다',async()=>{
 const key='room-files/2026-11/legacy-fixture.pdf',url='http://127.0.0.1:58433/__local_images/'+key;
 await fetch('http://127.0.0.1:58433/__local_image_fixture/'+key,{method:'PUT',headers:{'content-type':'application/pdf'},body:bytes});
 const photo=await imageFixture(),id=Number(sql(`insert into target_room_messages(target_id,from_id,from_name,file_url,file_name,file_size,photo)values('LIST-1','${ids.member}','테스트교사',${quote(url)},'기존가짜.pdf',${bytes.length},${quote('data:image/jpeg;base64,'+photo.toString('base64'))})returning id`).split('\n')[0]);
 assert.equal(hash(Buffer.from(await(await get(id)).arrayBuffer())),hash(bytes));assert.equal(hash(Buffer.from(await(await get(id,'photo')).arrayBuffer())),hash(photo));
 assert.equal((await get(id,'file',other)).status,403);assert.equal(hash(Buffer.from(await(await fetch(url)).arrayBuffer())),hash(bytes));
 assert.ok(sql(`select photo like 'data:image/%' and file_url=${quote(url)} from target_room_messages where id=${id}`)==='t');
});
test('기존 공개 사진의 표시용 사본을 사용하고 사본 장애 때 보존 원본으로 돌아간다',async()=>{
 const {prepareImage}=await import('../server/lib/image-variants.js'),photo=await imageFixture(),prepared=await prepareImage(photo,'image/jpeg');
 const small=prepared.variants.find(v=>v.side===960).bytes,key='room/2026-11/00000000-0000-4000-8000-000000000099.iv1-320-960.jpg',variant=key.replace(/\.jpg$/,'.w960.webp');
 for(const [path,data,type]of [[key,photo,'image/jpeg'],[variant,small,'image/webp']])await fetch('http://127.0.0.1:58433/__local_image_fixture/'+path,{method:'PUT',headers:{'content-type':type},body:data});
 const id=Number(sql(`insert into target_room_messages(target_id,from_id,photo)values('LIST-1','${ids.member}',${quote('http://127.0.0.1:58433/__local_images/'+key)})returning id`).split('\n')[0]);
 const response=await get(id,'photo',owner,{variant:'preview'});assert.equal(response.status,200);assert.equal(hash(Buffer.from(await response.arrayBuffer())),hash(small));
 await fetch('http://127.0.0.1:58433/__local_image_fixture/'+variant,{method:'DELETE'});
 assert.equal(hash(Buffer.from(await(await get(id,'photo',owner,{variant:'preview'})).arrayBuffer())),hash(photo));
});
