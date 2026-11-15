import {before,test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {seedConnect,connectChat} from './helpers/connect-fixture.mjs';
import {ids,PIN,sql,quote} from './helpers/local-db.mjs';
const next='http://127.0.0.1:58434',legacy='http://127.0.0.1:58433';
async function api(action,body={},token,base=next){const r=await fetch(base+'/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...body,...(token?{_tk:token}:{})})});return{status:r.status,body:await r.json()};}
async function ok(action,body,token){const r=await api(action,body,token);assert.equal(r.status,200,action);assert.equal(r.body.error,undefined,action+': '+r.body.error);return r.body;}
let member,admin,other,coach;
before(async()=>{seedConnect();[member,admin,other,coach]=await Promise.all([[ids.member,'테스트교사'],[ids.admin,'테스트교육'],[ids.other,'테스트대상'],[ids.coach,'테스트교관']].map(async([memberId,name])=>(await ok('verifyLogin',{memberId,name,pin:PIN,dept:'청년회'})).token));assert.ok(member&&admin&&other&&coach);});
test('연결·개인 대화 정상 응답은 기존/Next API가 같고 정적 화면은 개인 자료를 포함하지 않는다',async()=>{
 for(const [action,body,token]of [['getConnectCard',{memberId:ids.other},member],['searchConnectCards',{limit:100},member],['getHelpPosts',{includeClosed:'owner'},member],['getMessages',{chatId:connectChat,paged:true},member],['getConnectAdminOverview',{},admin]])assert.deepEqual(await ok(action,body,token),(await api(action,body,token,legacy)).body,action);
 const r=await fetch(next+'/connect');assert.equal(r.status,200);assert.doesNotMatch(await r.text(),/990000000000|가짜 내 소개|010-0000/);
});
test('명함 205개 전체와 100개 이후 페이지·필터·관리자 전체 합계를 보존한다',async()=>{
 const rows=[];for(let offset=0;offset<205;offset+=100){const r=await ok('searchConnectCards',{offset,limit:100},member);assert.equal(r.total,205);rows.push(...r.rows);}assert.equal(rows.length,205);assert.equal(new Set(rows.map(r=>r.memberId)).size,205);assert.equal(rows[0].name,'테스트교사');assert.equal(rows[0].career,'가짜 숨은 경력');assert.equal(rows[1].memberId.startsWith('r_'),true);
 const filtered=await ok('searchConnectCards',{role:'협력교사',keyword:'가짜명함203',limit:100},member);assert.equal(filtered.total,1);assert.equal(filtered.rows[0].name,'가짜명함203');const scheduled=await ok('searchConnectCards',{schedule:'등록',limit:100},member);assert.ok(scheduled.rows.every(c=>!c.expired));
 const overview=await ok('getConnectAdminOverview',{},admin);assert.equal(overview.stats.cardCount,205);assert.equal(overview.stats.helpCount,3);assert.equal(overview.stats.helpOpen,1);assert.equal(overview.stats.matchCount,1);assert.ok(overview.cards.every(c=>!c.photoUrl));assert.ok((await api('getConnectAdminOverview',{},member)).body.error);assert.ok(overview.matches[0].refId.startsWith('r_'));assert.ok(!JSON.stringify(overview).includes(ids.other));
});
test('공개 이름·전화번호가 같아도 다른 계정 명함을 병합하지 않고 숨은 경력·기존 역할을 보존한다',async()=>{
 const source=(await ok('getConnectCard',{memberId:ids.member},member)).card,original=sql(`select row_to_json(c) from connect_cards c where member_id='${ids.other}'`);const saved=await ok('saveConnectCard',{data:{...source,name:'테스트대상',phone:'010-0000-0005'}},member);assert.equal(saved.card.memberId,ids.member);assert.equal(saved.card.career,'가짜 숨은 경력');assert.ok(saved.card.roles.includes('기타'));assert.equal(sql(`select row_to_json(c) from connect_cards c where member_id='${ids.other}'`),original);assert.equal(sql('select count(*) from connect_cards'),'205');
 assert.equal((await api('saveConnectCard',{memberId:ids.other,data:source},member)).status,403);await ok('saveConnectCard',{data:source},member);
});
test('도움 글의 본인 마감·영구 삭제와 관리자 마감만 허용하며 잘못된 수정은 새 글을 만들지 않는다',async()=>{
 const rows=(await ok('getHelpPosts',{includeClosed:'owner'},member)).rows;assert.equal(rows.length,2);assert.equal(rows.find(h=>h.helpId==='CONNECT-MY').canDelete,true);assert.equal(rows.find(h=>h.helpId==='CONNECT-OTHER').canDelete,false);assert.equal((await ok('getHelpPosts',{includeClosed:true},member)).rows.length,3);
 const data={type:'교사 · 상담1',dept:'청',startDate:'2026-01-01',endDate:'2099-12-31',oneLiner:'가짜 새 도움 글',target:'상황',need:'도움'};assert.ok((await api('saveHelpPost',{data:{...data,helpId:'CONNECT-OTHER'}},member)).body.error);assert.equal(sql('select count(*) from help_posts'),'3');const saved=await ok('saveHelpPost',{data},member);assert.ok(saved.helpId);
 assert.ok((await api('closeHelpPost',{helpId:saved.helpId},other)).body.error);assert.ok((await api('deleteHelpPost',{helpId:saved.helpId},admin)).body.error);await ok('closeHelpPost',{helpId:saved.helpId},admin);assert.equal(sql(`select status from help_posts where help_id=${quote(saved.helpId)}`),'마감');await ok('deleteHelpPost',{helpId:saved.helpId},member);assert.equal(sql('select count(*) from help_posts'),'3');
});
test('개인 대화 1205개는 최근 50개·이전 페이지·같은 시각 새 ID를 빠짐없이 읽고 참여자만 접근한다',async()=>{
 let page=await ok('getMessages',{chatId:connectChat,paged:true},member);assert.equal(page.rows.length,50);assert.equal(page.rows[0].id,1156);const idsSeen=page.rows.map(r=>r.id);while(page.hasMore){page=await ok('getMessages',{chatId:connectChat,beforeId:page.olderCursor},member);idsSeen.push(...page.rows.map(r=>r.id));}assert.equal(new Set(idsSeen).size,1205);
 for(const token of [admin,coach]){assert.equal((await api('getMessages',{chatId:connectChat,paged:true},token)).status,403);assert.equal((await api('markRead',{chatId:connectChat,throughId:1205},token)).status,403);}
 await ok('markRead',{chatId:connectChat,throughId:1202},member);assert.equal(sql(`select count(*) from chat_messages where chat_id='${connectChat}' and not is_read`),'3');
 await ok('sendMessage',{toId:ids.member,message:'가짜 새 대화'},other);const fresh=await ok('getMessages',{chatId:connectChat,afterId:1205},member);assert.equal(fresh.rows.length,1);assert.equal(fresh.rows[0].message,'가짜 새 대화');assert.ok(fresh.rows[0].fromId.startsWith('r_'));assert.equal((await api('sendMessage',{fromId:ids.other,toId:ids.coach,message:'사칭'},member)).status,403);
 const list=await ok('getChatList',{},member);assert.ok(list.rows[0].otherId.startsWith('r_'));assert.ok(!JSON.stringify(list).includes(ids.other));
});
test('연락처 확인은 전송하지 않고 기존 프로필 번호만 공유하며 확인 후 변경된 번호는 거절한다',async()=>{
 const count=sql('select count(*) from chat_messages'),preview=await ok('shareContact',{toId:ids.other,preview:true},member);assert.equal(preview.phone,'010-0000-0001');assert.equal(sql('select count(*) from chat_messages'),count);assert.ok((await api('shareContact',{toId:ids.other,expectedPhone:'010-0000-0101'},member)).body.error);assert.equal(sql('select count(*) from chat_messages'),count);
 await ok('shareContact',{toId:ids.other,expectedPhone:preview.phone},member);const message=sql('select message from chat_messages order by id desc limit 1');assert.match(message,/테\*트교사/);assert.match(message,/010-0000-0001$/);assert.ok((await api('shareContact',{toId:ids.member,preview:true},other)).body.error);
});
test('연락 클릭 기록은 메시지를 자동 전송하지 않으며 성사 변경은 참여자·관리자만 할 수 있다',async()=>{
 const before=sql('select count(*) from chat_messages');const target=(await ok('getConnectCard',{memberId:ids.other},member)).card.memberId;const data={kind:'도와주세요',refId:'CONNECT-OTHER',toId:target,toName:'테스트대상'};await ok('recordMatch',data,member);assert.equal((await ok('recordMatch',data,member)).duplicate,true);assert.equal(sql('select count(*) from chat_messages'),before);assert.equal(sql('select count(*) from matches'),'2');assert.ok((await api('setMatchDone',{matchId:'CONNECT-MATCH',status:'성사'},coach)).body.error);await ok('setMatchDone',{matchId:'CONNECT-MATCH',status:'성사'},admin);assert.equal((await ok('getConnectAdminOverview',{},admin)).stats.matchDone,1);
});
test('명함 사진만 변경해 다른 필드는 보존하고 원본 사본 바이트·본인 삭제 범위를 지킨다',async()=>{
 const initial=(await ok('getConnectCard',{memberId:ids.member},member)).card,bytes=await sharp({create:{width:240,height:320,channels:3,background:'#445577'}}).webp().toBuffer();const photoUrl='data:image/webp;base64,'+bytes.toString('base64');assert.equal((await api('setConnectCardPhoto',{memberId:ids.other,photoUrl},member)).status,403);const updated=(await ok('setConnectCardPhoto',{photoUrl},member)).card;for(const key of ['name','phone','oneLiner','intro','career','roles','schedType'])assert.deepEqual(updated[key],initial[key]);assert.deepEqual(Buffer.from(await(await fetch(updated.photoUrl)).arrayBuffer()),bytes);assert.equal((await api('deleteConnectCard',{memberId:ids.other},member)).status,403);await ok('deleteConnectCard',{},member);assert.equal((await ok('getConnectCard',{memberId:ids.member},member)).card,null);assert.ok((await ok('getConnectCard',{memberId:ids.other},member)).card);await ok('saveConnectCard',{data:initial},member);
});
