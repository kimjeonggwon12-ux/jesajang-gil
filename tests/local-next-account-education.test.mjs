import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {seed,sql,ids,PIN} from './helpers/local-db.mjs';
const next='http://127.0.0.1:58434',old='http://127.0.0.1:58433';
async function api(action,body={},token,base=next){const r=await fetch(base+'/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...body,...(token?{_tk:token}:{})})});return {status:r.status,body:await r.json()};}
const login=async(id,name,dept='청년회',pin=PIN)=>(await api('verifyLogin',{memberId:id,name,dept,pin})).body.token;
let member,education,evangel;
beforeEach(async()=>{seed();sql('truncate required_education,required_education_log restart identity');member=await login(ids.member,'테스트교사');education=await login(ids.admin,'테스트교육');evangel=await login(ids.evangel,'테스트전도','전도부');assert.ok(member&&education&&evangel);for(const base of [old,next])assert.equal((await api('getTeacherDirectory',{refresh:true},member,base)).body.total,7);});
test('새 계정·이수 관리 정적 화면은 개인정보를 포함하지 않는다',async()=>{
 for(const path of ['/account','/admin/required-education']){const r=await fetch(next+path);assert.equal(r.status,200);assert.doesNotMatch(await r.text(),/테스트교사|9900000000001|010-0000/);}
});
test('본인 PIN 변경은 사칭·틀린 현재 PIN을 거절하고 이전 세션/로그인을 무효화한다',async()=>{
 assert.equal((await api('setPin',{memberId:ids.other,oldPin:PIN,pin:'693857'},member)).status,403);
 assert.ok((await api('setPin',{oldPin:'000000',pin:'693857'},member)).body.error);
 const result=(await api('setPin',{oldPin:PIN,pin:'693857'},member)).body;assert.equal(result.ok,true);assert.ok(result.token);
 for(const base of [old,next]){assert.equal((await api('pinStatus',{},member,base)).status,401);assert.equal((await api('pinStatus',{},result.token,base)).body.hasPin,true);}
 assert.equal(await login(ids.member,'테스트교사','청년회',PIN),undefined);assert.ok(await login(ids.member,'테스트교사','청년회','693857'));
 assert.ok((await api('removePin',{pin:'693857'},result.token)).body.error);
});
test('이수 조회는 기존 응답과 같고 등록은 교육/전도 담당자만 대상별 이수일과 실제 등록자를 기록한다',async()=>{
 const roster=(await api('getRoster',{indexOnly:true},education)).body.rows,target=roster.find(r=>r.name==='테스트대상');assert.ok(target);
 for(const action of ['getRoster','getRequiredEducation','getRequiredEducationLog']){const data=action==='getRoster'?{indexOnly:true}:action==='getRequiredEducation'?{memberId:target.memberId}:{};assert.deepEqual(await api(action,data,education),await api(action,data,education,old));}
 const body={memberId:target.memberId,name:target.name,category:'상담교육',date:'2026-11-10',registrar:'위조등록자'};
 assert.equal((await api('updateRequiredEducation',body,member)).status,403);assert.equal(Number(sql('select count(*) from required_education')),0);
 const first=(await api('updateRequiredEducation',body,education)).body;assert.equal(first['상담교육'],'2026-11-10');
 const second=(await api('updateRequiredEducation',{...body,category:'교사소양교육',date:'2026-11-11'},evangel)).body;assert.equal(second['상담교육'],'2026-11-10');assert.equal(second['교사소양교육'],'2026-11-11');
 const third=(await api('updateRequiredEducation',{...body,date:'2026-11-12'},education)).body;assert.equal(third['상담교육'],'2026-11-12');assert.equal(third['교사소양교육'],'2026-11-11');assert.equal(Number(sql('select count(*) from required_education')),1);
 const logs=(await api('getRequiredEducationLog',{},education)).body.rows;assert.deepEqual(logs.map(l=>l.registrar),['테스트교육','테스트전도','테스트교육']);assert.equal(logs[0].name,target.name);
 assert.deepEqual(await api('getRequiredEducation',{memberId:target.memberId},education),await api('getRequiredEducation',{memberId:target.memberId},education,old));
});
test('일반 관리자의 이수 이력 조회와 등록 거절 및 최신 300건 계약을 보존한다',async()=>{
 sql(`insert into admins(member_id,name,dept,position,region) values('${ids.coach}','테스트교관','청년회','복음방교관','1지역');insert into required_education_log(logged_at,member_id,name,category,completed_on,registrar,kind) select '2026-11-10 10:00:00','${ids.other}','가짜이수'||i,'상담교육','2026-11-10','가짜등록자','등록' from generate_series(1,305) i`);
 const coach=await login(ids.coach,'테스트교관');assert.equal((await api('checkAdmin',{},coach)).body.isAdmin,true);assert.equal((await api('checkAdmin',{},coach)).body.permissions.canManageRoster,false);
 const logs=(await api('getRequiredEducationLog',{},coach)).body.rows;assert.equal(logs.length,300);assert.equal(logs[0].name,'가짜이수305');assert.equal(logs[299].name,'가짜이수6');
 assert.equal((await api('updateRequiredEducation',{memberId:ids.other,name:'테스트대상',category:'상담교육',date:'2026-11-11'},coach)).status,403);
 assert.ok((await api('updateRequiredEducation',{memberId:ids.other,category:'없는교육'},education)).body.error);assert.equal(Number(sql('select count(*) from required_education')),0);
});
test('이수 검색은 번호를 노출하지 않고 원본 부분 일치·부서·명단 순서·8명 계약을 유지한다',async()=>{
 const search=(query,dept='')=>api('getRoster',{indexOnly:true,query,dept},education);
 const result=(await search(ids.other)).body.rows;assert.equal(result.length,1);assert.equal(result[0].name,'테스트대상');assert.match(result[0].memberId,/^r_/);assert.ok(!JSON.stringify(result).includes(ids.other));
 assert.equal((await search(ids.other,'부녀회')).body.rows.length,0);assert.equal((await search('')).body.rows.length,0);
 sql("insert into teachers(member_id,name,dept,region,sort_order) select '980000000'||lpad(i::text,4,'0'),'가짜검색'||i,case when i%2=0 then ' 청년회 ' else '청년회' end,'1지역',100+i from generate_series(1,12)i");
 await api('getTeacherDirectory',{refresh:true},education);
 assert.deepEqual((await search('가짜검색')).body.rows.map(r=>r.name),Array.from({length:8},(_,i)=>'가짜검색'+(i+1)));
 assert.deepEqual((await search('가짜검색','기타')).body.rows.map(r=>r.name),[2,4,6,8,10,12].map(i=>'가짜검색'+i));
 assert.equal((await api('getRoster',{indexOnly:true},education)).body.rows.length,19);
});
