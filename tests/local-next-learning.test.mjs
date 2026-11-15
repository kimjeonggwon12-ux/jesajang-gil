import {before,test} from 'node:test';
import assert from 'node:assert/strict';
import {seedLearning} from './helpers/learning-fixture.mjs';
import {ids,PIN,sql,quote} from './helpers/local-db.mjs';
const next='http://127.0.0.1:58434',legacy='http://127.0.0.1:58433';
async function api(action,body={},token,base=next){const r=await fetch(base+'/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...body,...(token?{_tk:token}:{})})});return{status:r.status,body:await r.json()};}
async function ok(action,body={},token){const r=await api(action,body,token);assert.equal(r.status,200,action);assert.ok(!r.body.error,action+': '+r.body.error);return r.body;}
let member,admin,other,coach,evangel;
before(async()=>{seedLearning(true);[member,admin,other,coach,evangel]=await Promise.all([[ids.member,'테스트교사','청년회'],[ids.admin,'테스트교육','청년회'],[ids.other,'테스트대상','청년회'],[ids.coach,'테스트교관','청년회'],[ids.evangel,'테스트전도','전도부']].map(async([memberId,name,dept])=>(await ok('verifyLogin',{memberId,name,dept,pin:PIN})).token));});
test('새 교재 경로는 개인 자료를 정적 HTML에 넣지 않고 기존 API와 같은 성공 응답을 보낸다',async()=>{
 for(const [action,body]of [['getCourseList',{}],['getVideos',{}],['getLectures',{}],['getVideoRequests',{}],['getVideoTranscript',{id:'VD-ONE'}]])assert.deepEqual(await ok(action,body,member),(await api(action,body,member,legacy)).body,action);
 const r=await fetch(next+'/library');assert.equal(r.status,200);assert.doesNotMatch(await r.text(),/테스트교사|9900000000001|가짜 신청 댓글/);assert.equal((await api('getVideoRequests')).status,401);
 assert.equal((await ok('getCourseList',{},member)).rows.length,1008);assert.equal((await ok('getLectureStats',{lectureId:'LC-ONE'},admin)).people.length,1006);
});
test('신청함·연락처·댓글은 본인과 교육/전도 담당 범위를 유지한다',async()=>{
 const m=await ok('getVideoRequests',{},member),a=await ok('getVideoRequests',{},admin),c=await ok('getVideoRequests',{},coach);assert.equal(m.requests.length,1);assert.equal(m.wishes.length,1);assert.equal(m.wishes[0].phone,'');assert.equal(m.comments['TW-MINE'].length,1006);assert.equal(a.wishes.length,2);assert.ok(a.wishes.every(x=>x.phone));assert.equal(c.isApprover,false);assert.equal(c.requests.length,0);
 assert.ok((await api('addRequestComment',{reqId:'TW-MINE',text:'다른 사람'},other)).body.error);await ok('addRequestComment',{reqId:'TW-MINE',text:'담당 답변'},admin);assert.equal((await ok('getVideoRequests',{},member)).comments['TW-MINE'].at(-1).staff,true);
 for(const token of [member,coach]){assert.ok((await api('reviewVideoRequest',{id:'VD-PENDING',approve:true},token)).body.error);assert.ok((await api('getLectureStats',{lectureId:'LC-ONE'},token)).body.error);}
});
test('영상 중복·교재 신청·승인과 반려·삭제는 기존 계약을 유지한다',async()=>{
 assert.ok((await api('requestVideo',{video:{url:'FAKEVID0001',title:'[TEST] 중복',parts:['상담'],phone:'01000000001'}},member)).body.error);
 const wish=await ok('requestTextbook',{wish:{title:'[TEST] 새 교재',note:'가짜 메모',phone:'01000000001'}},member);await ok('reviewTextbookRequest',{id:wish.id},evangel);assert.equal((await ok('getVideoRequests',{},member)).wishes.find(x=>x.id===wish.id).status,'확인');
 const req=await ok('requestVideo',{video:{url:'FAKEVID0006',title:'[TEST] 완전히 새로운 6강',parts:['소양','상담'],phone:'01000000001',force:true}},member);await ok('reviewVideoRequest',{id:req.id,approve:true,parts:['상담']},admin);assert.ok((await ok('getVideos',{},member)).videos.some(x=>x.id===req.id));assert.ok(!(await ok('getVideoRequests',{},member)).requests.some(x=>x.id===req.id));
 await ok('reviewVideoRequest',{id:'VD-PENDING',approve:false},evangel);assert.equal((await ok('getVideoRequests',{},member)).requests[0].status,'반려');await ok('deleteVideo',{id:req.id},admin);assert.ok(!(await ok('getVideos',{},member)).videos.some(x=>x.id===req.id));
});
test('강좌 숨김·개인 진도·90% 이수·중복 칸·다른 계정 사칭을 검증한다',async()=>{
 assert.ok(!(await ok('getLectures',{},member)).lectures.some(l=>l.hidden));assert.ok((await ok('getLectures',{},admin)).lectures.some(l=>l.hidden));const body={lectureId:'LC-ONE',videoKey:'VD-ONE',duration:100,lastPos:85,buckets:[3,4,5,6,7,8,8,-1,999,1.5]};
 const r=await ok('saveLectureProgress',body,member);assert.equal(r.completed,true);assert.equal(r.pct,100);assert.deepEqual(JSON.parse(sql(`select buckets from lecture_progress where nid='${ids.member}' and lecture_id='LC-ONE' and video_key='VD-ONE'`)),[0,1,2,3,4,5,6,7,8]);assert.equal((await api('saveLectureProgress',{...body,memberId:ids.other},member)).status,403);
 const hidden={...body,lectureId:'LC-HIDDEN'};assert.ok((await api('saveLectureProgress',hidden,member)).body.error);assert.equal((await ok('saveLectureProgress',hidden,admin)).completed,false);assert.equal((await ok('saveLectureProgress',{...body,duration:200,buckets:[]},member)).completed,true);
 assert.equal((await ok('getLectures',{},other)).lectures.find(l=>l.lectureId==='LC-ONE').doneCount,0);
});
test('교재/영상 운영 역할과 주소가 바뀐 녹취·삭제 영상의 진도 경계를 검증한다',async()=>{
 const lecture={title:'[TEST] 새 강좌',part:'우수복음방교육',lessons:['VD-ONE','VD-ONE','VD-TWO','없는 영상'],hidden:true};assert.ok((await api('saveLecture',{lecture},member)).body.error);assert.ok((await api('saveVideo',{video:{url:'FAKEVID0007',title:'[TEST] 차단',parts:['소양']}},coach)).body.error);
 const l=await ok('saveLecture',{lecture},admin);assert.deepEqual(JSON.parse(sql(`select lessons from lectures where lecture_id=${quote(l.lectureId)}`)),['VD-ONE','VD-TWO']);await ok('deleteLecture',{lectureId:l.lectureId},evangel);
 for(const id of ['VD-PENDING','VD-STALE','없는 영상'])assert.equal((await ok('getVideoTranscript',{id},member)).exists,false);assert.equal((await ok('getLectures',{},member)).lectures.find(x=>x.lectureId==='LC-STALE').lessons[0].docs,false);
 await ok('deleteVideo',{id:'VD-TWO'},admin);assert.ok((await api('saveLectureProgress',{lectureId:'LC-ONE',videoKey:'VD-TWO',duration:100,buckets:[0]},member)).body.error);
});
test('녹취 생성은 관리자만 실행하며 가짜 AI 단계와 자료를 저장한다',async()=>{
 assert.ok((await api('videoTranscribe',{id:'VD-STALE',duration:100},member)).body.error);let result;for(let i=0;i<6;i++){result=await ok('videoTranscribe',{id:'VD-STALE',duration:100},coach);if(result.status==='완료')break;}assert.equal(result.status,'완료');const r=await ok('getVideoTranscript',{id:'VD-STALE'},member);assert.match(r.transcript,/로컬 영상 검증용/);assert.deepEqual(Object.keys(r.pkg).sort(),['lesson','outreach','quiz','share']);assert.ok(Object.values(r.pkg).every(Boolean));
});
