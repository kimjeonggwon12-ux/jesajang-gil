// 기존 고정 로컬 DB를 보존하며 책임자/관리자 분리만 검증한다. seed/reset/운영 접속 없음.
import {test,before} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const origin='http://127.0.0.1:58444',ids={owner:'9900000000990',a:'9900000000991',b:'9900000000992',admin:'9900000000993'},tokens={};
const names={owner:'가짜운영자',a:'가짜기존사용자',b:'가짜신규사용자',admin:'가짜시범관리자'};
function sql(q){return execFileSync('/opt/homebrew/bin/psql',['-h','/tmp/jesajang-auth-pg-socket','-p','58431','-U','postgres','-d','jesajang_pilot_20261114','-qAt','-v','ON_ERROR_STOP=1','-c',q],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
async function api(action,body={},who='owner'){const r=await fetch(origin+'/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...body,_tk:tokens[who]||''})});return {status:r.status,body:await r.json()};}
async function state(){return (await api('getPilotAdmin',{query:'가짜시범부서'})).body;}
async function change(operation,targetIds=[]){const s=await state();return api('savePilotAdmin',{operation,targetIds,expectedVersion:s.policy.version,reason:'책임자와 관리자 분리 검증',confirmed:true});}
async function session(who,ownerView,cookie=''){const r=await fetch(origin+'/api/pilot-session',{method:'POST',headers:{'content-type':'application/json',origin,cookie},body:JSON.stringify({token:tokens[who]||'',...(ownerView===undefined?{}:{ownerView})})});return {status:r.status,body:await r.json(),cookies:r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ')};}
async function page(cookie,path='/'){const r=await fetch(origin+path,{headers:{cookie}});return {status:r.status,html:await r.text()};}
before(async()=>{assert.equal(sql('select current_database()'),'jesajang_pilot_20261114');for(const who of Object.keys(ids)){const r=await api('verifyLogin',{memberId:ids[who],name:names[who],dept:'장년회',pin:'582946'},'none');assert.equal(r.body.ok,true);tokens[who]=r.body.token;}});
test('일반 관리자도 B 대상이며 최종 책임자 외에는 조회·배정·개인 화면 선택 불가',async()=>{
 const a=(await api('checkAdmin',{},'admin')).body;assert.equal(a.isAdmin,true);assert.equal(a.permissions.canManagePilot,false);
 const s=await state();assert.equal(s.users.total,3);assert.ok(s.users.rows.some(x=>x.name===names.admin));assert.ok(!s.users.rows.some(x=>x.name===names.owner));
 for(const who of ['a','b','admin','none']){
  assert.equal((await api('getPilotAdmin',{},who)).status,who==='none'?401:403);
  assert.equal((await api('savePilotAdmin',{operation:'start',targetIds:[],expectedVersion:s.policy.version,reason:'위조',confirmed:true,operatorIds:[ids[who]],systemOwnerNid:ids[who],_actor:{nid:ids.owner}},who)).status,who==='none'?401:403);
  assert.equal((await session(who,'B')).status,who==='none'?401:403);
 }
 assert.equal((await state()).policy.version,s.policy.version);
 const self=await change('assign',[ids.owner]);assert.match(self.body.error,/책임자/);assert.equal((await state()).policy.version,s.policy.version);
});
test('관리자 A/B 분기·권한 유지·전체 A 복귀 및 책임자 개인 선택 독립',async()=>{
 assert.equal((await change('assign',[ids.admin])).body.ok,true);assert.equal((await change('start')).body.ok,true);
 assert.equal((await session('admin')).body.site,'B');const access=(await api('checkAdmin',{},'admin')).body;assert.equal(access.permissions.canManagePilot,false);
 const adminCookie=(await session('admin')).cookies;assert.doesNotMatch((await page(adminCookie)).html,/<base href="\/">/);
 const count=(await state()).selectedCount,version=(await state()).policy.version;
 const ownerA=await session('owner','A');assert.equal(ownerA.body.site,'A');assert.match((await page(ownerA.cookies)).html,/<base href="\/">/);
 const ownerB=await session('owner','B',ownerA.cookies);assert.equal(ownerB.body.site,'B');assert.doesNotMatch((await page(ownerB.cookies)).html,/<base href="\/">/);
 assert.equal((await state()).policy.version,version);assert.equal((await state()).selectedCount,count);
 assert.equal((await change('stop')).body.ok,true);assert.equal((await session('admin')).body.site,'A');assert.match((await page(adminCookie)).html,/<base href="\/">/);
 assert.equal((await session('owner',undefined,ownerB.cookies)).body.site,'B');assert.equal((await session('owner',undefined,ownerA.cookies)).body.site,'A');
 assert.equal((await session('b',undefined,'ts_pilot_owner_view='+ids.owner+':B')).body.site,'A');assert.deepEqual((await api('checkAdmin',{},'admin')).body,access);
});
test('책임자의 명단·등급·백업·교육 위임·센터·상담 관리 권한과 일반 관리자 제한',async()=>{
 const access=(await api('checkAdmin')).body;assert.equal(access.isAdmin,true);for(const flag of ['canManagePilot','canManageBackup','canManageRoster','canExportTeachers','canChangeTier'])assert.equal(access.permissions[flag],true,flag);
 const edu=(await api('educationAccess')).body;assert.equal(edu.owner,true);assert.equal(edu.eligible,true);assert.equal((await api('educationAccess',{},'admin')).body.owner,false);
 const desk=(await api('getCenterDesk')).body;assert.equal(desk.me.canConfigure,true);assert.equal(desk.me.approvalGlobal,true);assert.ok(desk.rows.every(r=>r.canReadDocument));
 assert.equal((await api('getCenterPolicy')).status,200);assert.equal((await api('getCenterPolicy',{},'admin')).status,403);
 const feedback=(await api('getAllFeedback')).body;assert.equal(feedback.rows.length,Number(sql('select count(*) from feedbacks')));
 assert.equal((await api('getMyCoach')).body.isCoach,true);const req=(await api('getCoachFeedbacks')).body;assert.ok(Array.isArray(req.pending)&&Array.isArray(req.answered));
});
test('책임자라도 만료·회수한 세션은 화면 선택과 관리 요청을 거절',async()=>{
 const ver=sql("select ver from member_pins where nid='"+ids.owner+"'");const c=(await session('owner','B')).cookies;
 try{sql("update member_pins set ver='owner-revoked' where nid='"+ids.owner+"'");assert.equal((await session('owner','A',c)).status,401);assert.equal((await api('getPilotAdmin')).status,401);}finally{sql("update member_pins set ver='"+ver+"' where nid='"+ids.owner+"'");}
});

test('책임자는 담당이 아닌 새 상담 답변·방 관리를 수행하고 일반 관리자의 사칭은 거절한다',async()=>{
 const tid='OWNER-CHECK-'+Date.now();
 sql(`insert into targets(target_id,creator_id,teacher_name,target_name,stage) values('${tid}','${ids.b}','${names.b}','가짜책임자검증대상-${tid}','친분');`);
 const request=(await api('requestCoach',{content:'가짜 책임자 권한 검증 상담'},'b')).body;assert.ok(request.receiptNo);
 assert.ok((await api('submitCoachReply',{feedbackId:request.receiptNo,reply:'사칭 답변',systemOwnerNid:ids.owner},'admin')).body.error);
 assert.equal((await api('submitCoachReply',{feedbackId:request.receiptNo,reply:'가짜 책임자 확인 답변'})).body.ok,true);
 assert.equal(sql(`select handler_answer from feedbacks where receipt_no='${request.receiptNo}'`),'가짜 책임자 확인 답변');
 assert.ok((await api('getTargetRoom',{targetId:tid,systemOwnerNid:ids.owner},'admin')).body.error);
 const room=(await api('getTargetRoom',{targetId:tid})).body;assert.equal(room.ok,true,room.error);assert.equal(room.isOwner,true);assert.equal(room.canManage,true);
 const sent=(await api('sendRoomMessage',{targetId:tid,text:'가짜 책임자 방 점검'})).body;assert.equal(sent.ok,true,sent.error);
 assert.ok((await api('deleteRoom',{targetId:tid,systemOwnerNid:ids.owner},'admin')).body.error);
 assert.equal((await api('deleteRoom',{targetId:tid})).body.ok,true);
 assert.equal(sql(`select count(*) from target_room_messages where target_id='${tid}'`),'0');
 assert.equal(sql(`select count(*) from targets where target_id='${tid}'`),'1');
});

test('시범 빌드의 익명 로그인·공통 관리 화면에도 접속 분기 코드가 포함된다',async()=>{
 for(const path of ['/','/account','/admin/pilot'])assert.ok((await page('',path)).html.includes('/pilot-bridge.js'),'접속 분기 코드 누락: '+path);
});
