import {test,before} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {seed,sql,ids,login,api,apiBase} from './helpers/local-db.mjs';
import {imageFixture} from './helpers/image-fixture.mjs';
const targetId='IMAGE-LOCAL',artifact=new URL('../../artifacts/images-20261112/',import.meta.url);
let token,input,original;
const hash=b=>createHash('sha256').update(b).digest('hex');
const stats=()=>fetch('http://127.0.0.1:58433/__local_image_stats').then(r=>r.json());
before(async()=>{
  seed();sql(`truncate target_room_messages,target_room_members,target_room_invites,target_history,targets restart identity;
    insert into targets(target_id,creator_id,target_name,stage) values('${targetId}','${ids.member}','가짜 이미지검증','섭외');`);
  token=(await login()).body.token;input=await imageFixture();await fs.mkdir(artifact,{recursive:true});
});
test('권한 있는 사용자의 사진은 실제 API·DB·가짜 저장소를 거쳐 원본과 사본으로 연결된다',async()=>{
  const r=await api('sendRoomMessage',{targetId,text:'로컬 사진 검증 · 사진을 누르면 원본',photo:'data:image/jpeg;base64,'+input.toString('base64')},token);
  assert.equal(r.status,200);assert.equal(r.body.ok,true);original=r.body.message.photo;
  assert.equal(original,'room-media:'+r.body.message.id);
  const stored=sql(`select photo from target_room_messages where target_id='${targetId}'`);assert.match(stored,/^room-private:[0-9a-f-]{36}$/);
  const attachment=JSON.parse(sql(`select row_to_json(a) from room_attachments a where message_id=${r.body.message.id} and kind='photo'`));
  assert.equal(stored,'room-private:'+attachment.id);
  const download=variant=>fetch(apiBase+'/api/room-attachment',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({_tk:token,targetId,id:r.body.message.id,kind:'photo',variant})});
  const response=await download('original');assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
  const originalBytes=Buffer.from(await response.arrayBuffer());assert.equal(hash(originalBytes),hash(input));
  await fs.writeFile(new URL('sample-original.jpg',artifact),originalBytes);
  const variants=[];
  for(const side of [320,960]){
    const item=attachment.variants[side];assert.ok(item);assert.equal(item.mime,'image/webp');
    // 이 주소는 격리 저장소의 검사 도구다. 제품의 공개 다운로드 경로가 아니다.
    const storedVariant=await fetch('http://127.0.0.1:58433/__local_image_fixture/private/'+item.key);assert.equal(storedVariant.status,200);
    const bytes=Buffer.from(await storedVariant.arrayBuffer()),meta=await sharp(bytes).metadata();
    assert.equal(bytes.length,item.size);assert.equal(Math.max(meta.width,meta.height),side);assert.ok(bytes.length<input.length);
    const object=(await stats()).objects.find(o=>o.key==='private/'+item.key);assert.equal(object.sha256,hash(bytes));
    assert.equal((await fetch('http://127.0.0.1:58433/__local_images/private/'+item.key)).status,404);
    if(side===960){const preview=await download('preview');assert.equal(preview.status,200);assert.equal(hash(Buffer.from(await preview.arrayBuffer())),hash(bytes));}
    variants.push({side,bytes:bytes.length,width:meta.width,height:meta.height});
    await fs.writeFile(new URL(`sample-${side}.webp`,artifact),bytes);
  }
  assert.equal((await fetch('http://127.0.0.1:58433/__local_images/private/'+attachment.object_key)).status,404);
  await fs.writeFile(new URL('image-transfer.json',artifact),JSON.stringify({fakeData:true,authenticatedDownload:true,publicDownloadDenied:true,originalBytes:input.length,originalSha256:hash(input),storedOriginalSha256:hash(originalBytes),variants},null,2));
});
test('초대되지 않은 계정은 사진 저장 전에 거절되고 원본 저장 범위가 넓어지지 않는다',async()=>{
  const other=(await login(ids.other,'테스트대상')).body.token,count=(await stats()).objects.length;
  const r=await api('sendRoomMessage',{targetId,photo:'data:image/jpeg;base64,'+input.toString('base64')},other);
  assert.ok(r.status===403||r.body.error);assert.equal((await stats()).objects.length,count);
  const room=await api('getTargetRoom',{targetId},other);assert.ok(room.status===403||room.body.error);
});
test('손상 사진은 명확한 오류를 반환하며 DB 메시지와 저장소 파일을 늘리지 않는다',async()=>{
  const count=(await stats()).objects.length,rows=sql('select count(*) from target_room_messages');
  const r=await api('sendRoomMessage',{targetId,photo:'data:image/png;base64,YWJjZA=='},token);
  assert.equal(r.status,400);assert.ok(r.body.error);assert.equal((await stats()).objects.length,count);assert.equal(sql('select count(*) from target_room_messages'),rows);
  const mine=await api('getTargetRoom',{targetId},token);assert.equal(mine.status,200);assert.equal(mine.body.messages[0].photo,original);
});
