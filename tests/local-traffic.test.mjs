import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
import {seedTraffic,chatId,metrics} from './helpers/traffic-fixture.mjs';
import {login,api,sql,ids} from './helpers/local-db.mjs';
let token;
beforeEach(async()=>{seedTraffic();token=(await login()).body.token;assert.ok(token);});
const get=(data={})=>api('getMessages',{chatId,paged:true,...data},token);
test('긴 대화는 최근 50개로 시작하고 이전 페이지를 끝까지 읽어도 누락·중복이 없다',async()=>{
  await metrics(true);let r=await get();assert.equal(r.status,200);assert.equal(r.body.rows.length,50);
  assert.equal((await metrics()).db['GET /chat_messages'].rows,51);
  assert.equal(r.body.rows[0].id,1156);assert.equal(r.body.nextCursor,1205);
  let rows=[...r.body.rows];
  while(r.body.hasMore){r=await get({beforeId:r.body.olderCursor});rows=[...r.body.rows,...rows];}
  assert.equal(rows.length,1205);assert.equal(new Set(rows.map(x=>x.id)).size,1205);assert.equal(rows[0].id,1);
});
test('빈 증분 조회는 메시지 0행이고 같은 초의 새 메시지 120건도 순서대로 모두 받는다',async()=>{
  await metrics(true);const empty=await get({afterId:1205});assert.deepEqual(empty.body.rows,[]);
  assert.equal((await metrics()).db['GET /chat_messages'].rows,0);
  sql(`insert into chat_messages(chat_id,from_id,to_id,message,sent_at) select '${chatId}','${ids.other}','${ids.member}','가짜 새 메시지 '||g,'2026-11-12 09:00:00' from generate_series(1,120)g`);
  let cursor=1205,rows=[],r;
  do{r=await get({afterId:cursor});rows.push(...r.body.rows);cursor=r.body.nextCursor;}while(r.body.hasMore);
  assert.equal(rows.length,120);assert.equal(new Set(rows.map(x=>x.id)).size,120);assert.equal(cursor,1325);
  assert.equal((await get({afterId:0})).body.rows[0].id,1);
});
test('읽음은 수신자와 확인한 마지막 번호까지만 갱신하며 뒤늦게 도착한 메시지는 남긴다',async()=>{
  sql(`insert into chat_messages(chat_id,from_id,to_id,message,sent_at) values('${chatId}','${ids.other}','${ids.member}','늦게 온 가짜 메시지','2026-11-12 09:00:00')`);
  await metrics(true);let r=await api('markRead',{chatId,throughId:1205},token);
  assert.equal(r.body.updated,5);assert.equal(sql('select is_read from chat_messages where id=1206'),'f');
  assert.equal((await metrics()).db['GET /chat_messages'],undefined);
  r=await api('markRead',{chatId,throughId:1205},token);assert.equal(r.body.updated,0);
  const outsider=(await login(ids.admin,'테스트교육')).body.token;
  for(const action of ['getMessages','markRead'])assert.equal((await api(action,{chatId,throughId:1206},outsider)).status,403);
});
test('미확인 알림 수는 1,000건을 넘어도 정확하며 메시지 본문을 가져오지 않는다',async()=>{
  sql('update chat_messages set is_read=false');await metrics(true);
  const r=await api('getConnectUnread',{},token);assert.equal(r.body.unread,1205);
  const stats=await metrics();assert.equal(stats.db['HEAD /chat_messages'].bytes,0);assert.equal(stats.db['HEAD /coop_requests'].bytes,0);
});
test('목록의 이력을 생략해도 대상자 정보·담당 범위는 같고 빈 목록은 이력을 조회하지 않는다',async()=>{
  const full=await api('getMyTargets',{},token);await metrics(true);
  const light=await api('getMyTargets',{includeHistory:false},token);
  const withoutHistory=rows=>rows.map(({history,...rest})=>rest);
  assert.deepEqual(withoutHistory(light.body.rows),withoutHistory(full.body.rows));
  assert.equal(full.body.rows.reduce((n,r)=>n+r.history.length,0),1205);
  assert.equal(light.body.rows.reduce((n,r)=>n+r.history.length,0),0);
  assert.equal((await metrics()).db['GET /target_history'],undefined);
  const dossier=await api('heartsDossier',{targetId:'TRAFFIC-1'},token);
  assert.equal(dossier.status,200);assert.equal(dossier.body.ok,true);
  assert.match(dossier.body.context,/가짜 이력/);
  const outsider=(await login(ids.admin,'테스트교육')).body.token;await metrics(true);
  assert.deepEqual((await api('getMyTargets',{},outsider)).body.rows,[]);
  assert.equal((await metrics()).db['GET /target_history'],undefined);
  assert.equal((await api('getMyTargets',{memberId:ids.member},outsider)).status,403);
});
test('옛 전체 조회를 유지하고 잘못된 커서와 과도한 페이지 크기를 제한한다',async()=>{
  assert.equal((await api('getMessages',{chatId},token)).body.rows.length,1205);
  assert.equal((await api('getMessages',{chatId,after:'2026-11-12 09:00:00'},token)).body.rows.length,0);
  for(const afterId of ['-1','3.5','oops','9007199254740992'])assert.equal((await get({afterId})).status,400);
  assert.equal((await get({afterId:0,beforeId:10})).status,400);
  assert.equal((await get({limit:999999})).body.rows.length,100);
});
test('동일한 가짜 자료의 변경 후 전송량을 개인정보 없이 저장한다',async()=>{
  const out={};
  for(const [name,action,body] of [['chatInitial','getMessages',{chatId,paged:true}],['chatIdle','getMessages',{chatId,paged:true,afterId:1205}],['targets','getMyTargets',{includeHistory:false}],['unread','getConnectUnread',{}]]) {
    await metrics(true);const r=await api(action,body,token);assert.equal(r.status,200);assert.ok(!r.body.error);
    out[name]={returnedRows:r.body.rows?.length,...await metrics()};
  }
  mkdirSync(new URL('../../artifacts/traffic-20261112/',import.meta.url),{recursive:true});
  writeFileSync(new URL('../../artifacts/traffic-20261112/after.json',import.meta.url),JSON.stringify(out,null,2));
});
