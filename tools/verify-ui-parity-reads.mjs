// 고정된 로컬 합성 DB를 읽기만 한다. 시드/수정/삭제/외부 발송은 없다.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
const base='http://127.0.0.1:58574/api';let token='';const evidence=[];
async function call(action,body={}){const response=await fetch(base,{method:'POST',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify({action,...body,...(token?{_tk:token}:{})})});return {status:response.status,body:await response.json()};}
async function ok(action,body){const r=await call(action,body);assert.equal(r.status,200,action);assert.ok(!r.body.error,r.body.error);return r.body;}
const login=await ok('verifyLogin',{memberId:'9900000000991',name:'가짜기존사용자',dept:'장년회',pin:'582946'});assert.ok(login.token);token=login.token;
const whole=await ok('getMyActivityPage',{withSequence:true,limit:20}),cards=await ok('getMyActivityPage',{withSequence:true,cards:true,reportStatus:true,limit:20}),old=await ok('getMyActivityPage',{cards:true,limit:20});
assert.deepEqual(cards.rows.map(a=>a.id),whole.rows.map(a=>a.id));assert.equal(cards.total,whole.total);
for(const row of cards.rows){const full=whole.rows.find(a=>a.id===row.id);assert.equal(row.reported,full.tgPosts.some(p=>p.kind==='post'));assert.equal(row.sequence,full.sequence);for(const k of ['tgPosts','reportText','report','aiFeedback'])assert.equal(k in row,false);}
assert.ok(old.rows.every(a=>!('reported' in a)));evidence.push({check:'page-report-markers-and-sequence',rows:cards.rows.length,total:cards.total,passed:true});
const names=[...new Set(whole.rows.map(a=>a.targetName))];for(const targetName of names){const feedback=await ok('getMyActivityPage',{targetName,feedbackOnly:true,limit:20});assert.ok(feedback.rows.every(a=>a.targetName===targetName&&a.aiFeedback));}
evidence.push({check:'target-feedback-history',targets:names.length,passed:true});
assert.equal((await call('getMyActivityPage',{cards:true,reportStatus:true,memberId:'9900000000992'})).status,403);
for(const input of [{limit:200},{page:0},{through:-1}])assert.equal((await call('getMyActivityPage',{cards:true,reportStatus:true,...input})).status,400);
evidence.push({check:'identity-and-page-boundaries',passed:true});
for(const [action,body] of [['getCalendarEvents',{}],['getCalendarAds',{}],['listPlazaPosts',{category:'사례',limit:20,offset:0}],['listPlazaPosts',{category:'질문',limit:20,offset:0}],['getCourseList',{}],['listMyRooms',{}]]){await ok(action,body);evidence.push({check:action,passed:true});}
writeFileSync('artifacts/ui-parity-completion-20261115/read-verification.json',JSON.stringify({environment:'existing synthetic DB via local B only',businessWrites:0,externalRequests:0,checks:evidence},null,2)+'\n');console.log(JSON.stringify({passed:evidence.length,ownRows:cards.rows.length,businessWrites:0}));
