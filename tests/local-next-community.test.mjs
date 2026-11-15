import {before,test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {seedCommunity} from './helpers/community-fixture.mjs';
import {ids,PIN,sql} from './helpers/local-db.mjs';
import {caseParse} from '../next-app/lib/community.ts';
const next='http://127.0.0.1:58434',legacy='http://127.0.0.1:58433';
async function api(action,body={},token,base=next){const response=await fetch(base+'/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...body,...(token?{_tk:token}:{})})});return{status:response.status,body:await response.json()};}
async function ok(action,body,token){const r=await api(action,body,token);assert.equal(r.status,200,action);assert.equal(r.body.error,undefined,action+': '+r.body.error);return r.body;}
let member,admin,other,savedId,commentId;
before(async()=>{seedCommunity();const tokens=[];for(const [id,name]of [[ids.member,'테스트교사'],[ids.admin,'테스트교육'],[ids.other,'테스트대상']]){const r=await ok('verifyLogin',{memberId:id,name,dept:'청년회',pin:PIN});assert.ok(r.token);tokens.push(r.token);}[member,admin,other]=tokens;});
test('게시판·댓글·월간·연락처의 정상 응답은 기존/Next API에서 같고 정적 HTML에 개인 자료가 없다',async()=>{
 for(const [action,body]of [['listPlazaPosts',{category:'사례'}],['getPlazaPost',{postId:'COMM-OTHER-POST'}],['getPlazaMonthly',{month:'2026-11'}],['getMemberContact',{targetId:ids.other}]]){const r=await ok(action,body,member);assert.deepEqual(r,(await api(action,body,member,legacy)).body,action);}
 const r=await fetch(next+'/community');assert.equal(r.status,200);assert.doesNotMatch(await r.text(),/990000000000|비공개가짜|가짜 내 사례/);
});
test('별칭 검색·20개 페이지·이름 공모와 1000개 이후 댓글이 보존된다',async()=>{
 const a=await ok('listPlazaPosts',{category:'사례',limit:20},member),b=await ok('listPlazaPosts',{category:'사례',offset:20,limit:20},member);assert.equal(a.total,47);assert.equal(a.rows.length,20);assert.equal(b.rows.length,20);assert.equal(new Set([...a.rows,...b.rows].map(p=>p.postId)).size,40);assert.equal((await ok('listPlazaPosts',{category:'사례',keyword:'가짜 사례 45'},member)).total,1);
 const d=await ok('getPlazaPost',{postId:'COMM-OTHER-POST'},member);assert.equal(d.comments.length,1005);assert.equal(d.post.commentCount,1005);assert.match(d.comments.at(-1).text,/1005$/);assert.doesNotMatch(JSON.stringify(d),/비공개가짜대상|010-0000-0005/);assert.notEqual(d.post.memberId,ids.other);assert.equal((await ok('listPlazaPosts',{keyword:'[이름 공모]',limit:50},member)).rows.length,50);
});
test('월간 점수·동점·쿠폰 중복 작성자 제외는 기존 계산을 유지하고 이름만 가린다',async()=>{
 const r=await ok('getPlazaMonthly',{month:'2026-11'},member);assert.deepEqual(r.teachers.map(t=>[t.dept,t.name,t.score,t.count,t.positive,t.targets]),[['부녀회','테스트교관',3,1,0,1],['청년회','테스트교사',7,2,1,2]]);assert.deepEqual(r.coupon.map(p=>p.postId),['COMM-OTHER-POST','COMM-OWN-POST','COMM-ADMIN']);assert.equal(r.popular[0].likeCount,8);assert.equal(r.popular[0].commentCount,1005);assert.doesNotMatch(JSON.stringify(r),/비공개가짜대상|010-0000-0005/);assert.match(r.coupon[1].summary,/개인가짜대상/);assert.match((await ok('getPlazaMonthly',{month:'2026-11'},other)).popular[0].summary,/비공개가짜대상/);
});
test('비로그인·사칭·전도부 게시판·타인 글/댓글 변경을 서버가 거절한다',async()=>{
 for(const action of ['listPlazaPosts','getPlazaPost','getPlazaMonthly','savePlazaPost','adminSetPlazaPhotos','togglePlazaLike','addPlazaComment','writeCaseDraft'])assert.equal((await api(action,{})).status,401,action);
 assert.equal((await api('savePlazaPost',{memberId:ids.other},member)).status,403);
 for(const token of [member,admin]){assert.ok((await api('savePlazaPost',{data:{postId:'COMM-OTHER-POST',category:'사례',title:'금지',body:'금지'}},token)).body.error);assert.ok((await api('deletePlazaPost',{postId:'COMM-OTHER-POST'},token)).body.error);assert.ok((await api('editPlazaComment',{commentId:'COMM-C-1',text:'금지'},token)).body.error);assert.ok((await api('deletePlazaComment',{commentId:'COMM-C-1'},token)).body.error);}
 assert.ok((await api('savePlazaPost',{data:{category:'전도부',title:'금지',body:'금지'}},member)).body.error);assert.equal((await ok('savePlazaPost',{data:{category:'전도부',title:'가짜 교육 관리자 안내',body:'가짜'}},admin)).ok,true);
 for(const postId of ['missing','COMM-DELETED'])assert.ok((await api('addPlazaComment',{postId,text:'금지'},member)).body.error);
});
test('글과 댓글은 서버 작성자를 사용하며 수정·좋아요·삭제 결과를 보존한다',async()=>{
 const r=await ok('savePlazaPost',{name:'사칭',data:{category:'실패사례',title:'가짜 저장',body:'가짜 본문',tags:['기록']}},member);savedId=r.postId;let d=await ok('getPlazaPost',{postId:savedId},member);assert.equal(d.post.name,'테스트교사');assert.equal(d.post.category,'사례');
 await ok('savePlazaPost',{data:{postId:savedId,category:'사례',title:'가짜 수정',body:'바뀐 본문'}},member);assert.equal((await ok('getPlazaPost',{postId:savedId},member)).post.body,'바뀐 본문');
 await ok('addPlazaComment',{postId:savedId,text:'내 댓글',name:'사칭'},member);d=await ok('getPlazaPost',{postId:savedId},member);assert.equal(d.comments[0].name,'테스트교사');commentId=d.comments[0].commentId;await ok('editPlazaComment',{commentId,text:'댓글 수정'},member);assert.equal((await ok('getPlazaPost',{postId:savedId},member)).comments[0].text,'댓글 수정');
 await Promise.all([ok('togglePlazaLike',{postId:savedId},member),ok('togglePlazaLike',{postId:savedId},other)]);assert.equal((await ok('getPlazaPost',{postId:savedId},member)).post.likeCount,2);assert.equal((await ok('togglePlazaLike',{postId:savedId},member)).likeCount,1);
 await ok('deletePlazaComment',{commentId},member);assert.equal((await ok('getPlazaPost',{postId:savedId},member)).comments.length,0);await ok('deletePlazaPost',{postId:savedId},member);assert.ok((await api('getPlazaPost',{postId:savedId},member)).body.error);assert.equal(sql(`select status from plaza_posts where post_id='${savedId}'`),'삭제');
});
test('명함 연락처는 공개하되 명단의 비공개 번호는 관리자에게만 제공한다',async()=>{
 assert.equal((await ok('getMemberContact',{targetId:ids.other},member)).phone,'010-0000-0005');assert.equal((await ok('getMemberContact',{targetId:ids.member},other)).phone,'');assert.equal((await ok('getMemberContact',{targetId:ids.member},admin)).phone,'010-0000-0001');
});
test('관리자 사진 변경은 글 원문을 보존하고 가짜 저장소 바이트가 선택 사본과 같다',async()=>{
 const bytes=await sharp({create:{width:90,height:60,channels:3,background:'#445599'}}).jpeg().toBuffer(),photo='data:image/jpeg;base64,'+bytes.toString('base64');const original=(await ok('getPlazaPost',{postId:'COMM-OTHER-POST'},other)).post;
 assert.ok((await api('adminSetPlazaPhotos',{postId:original.postId,photos:[photo],thumb:photo},member)).body.error);await ok('adminSetPlazaPhotos',{postId:original.postId,photos:[photo],thumb:photo},admin);const updated=(await ok('getPlazaPost',{postId:original.postId},other)).post;for(const key of ['title','body','memberId','createdAt','updatedAt'])assert.equal(updated[key],original[key]);assert.deepEqual(Buffer.from(await(await fetch(updated.photos[0])).arrayBuffer()),bytes);
});
test('사례 AI 초안은 자기 담당자만 생성하며 하루 5회·명시적 게시 전 비공개를 유지한다',async()=>{
 const before=sql('select count(*) from plaza_posts');assert.ok((await api('writeCaseDraft',{targetId:'COMM-OTHER'},member)).body.error);assert.ok((await api('writeCaseDraft',{targetId:'COMM-OWN'},admin)).body.error);
 const draft=await ok('writeCaseDraft',{targetId:'COMM-OWN'},member);assert.equal(draft.title,'가짜 누적 기록 사례 초안');assert.equal(caseParse(draft.body).filter(Boolean).length,7);assert.equal(sql('select count(*) from plaza_posts'),before);assert.equal(sql("select count(*) from target_ai_notes where kind='사례 초안'"),'1');
 for(let i=0;i<4;i++)await ok('writeCaseDraft',{targetId:'COMM-OWN'},member);assert.match((await api('writeCaseDraft',{targetId:'COMM-OWN'},member)).body.error,/5번/);assert.equal(sql('select count(*) from plaza_posts'),before);
});
