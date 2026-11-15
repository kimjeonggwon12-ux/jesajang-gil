import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {fork,execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const out=new URL('../../artifacts/cross-check-compat-20261114/',import.meta.url),repo=new URL('../',import.meta.url);
const ids={owner:'9908000000001',chair:'9908000000002',other:'9908000000003',edu:'9908000000004',fresh:'9908000000005'};
const names={owner:'가짜전환교사',chair:'가짜전환회장',other:'가짜전환타부서',edu:'가짜전환교육',fresh:'가짜전환미등록'};
const q=x=>"'"+String(x).replaceAll("'","''")+"'",hash=x=>createHash('sha256').update(x).digest('hex');
function sql(text,which='after'){assert.ok(['before','after'].includes(which));return execFileSync('/opt/homebrew/bin/psql',['-h','/tmp/jesajang-auth-pg-socket','-p','58431','-U','postgres','-d','jesajang_compat_'+which+'_20261114','-qAt','-v','ON_ERROR_STOP=1'],{input:text,encoding:'utf8',maxBuffer:16*1024*1024,stdio:['pipe','pipe','pipe']}).trim();}
const save=(name,value)=>writeFileSync(new URL(name,out),JSON.stringify(value,null,2)+'\n');
const workers=[],tokens={},readReference=[],facts={};let serial=0;
async function worker(mode){
  const child=fork(new URL('../tools/local-compat-worker.mjs',import.meta.url),[mode],{stdio:['ignore','ignore','ignore','ipc']});workers.push(child);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(mode+' 시작 시간 초과')),10000);child.once('message',x=>{clearTimeout(timer);x.ready?resolve():reject(new Error('시작 신호 없음'));});child.once('error',reject);});
  const send=(op,body)=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{child.off('message',listener);reject(new Error(mode+' 응답 시간 초과'));},15000);const listener=x=>{if(x.id!==id)return;clearTimeout(timer);child.off('message',listener);x.error?reject(new Error(x.error)):resolve(x.value);};child.on('message',listener);child.send({id,op,body});});
  send.stop=async()=>{const exited=new Promise(resolve=>child.once('exit',resolve));child.send({op:'stop'});await exited;};return send;
}
let oldBefore,oldAfter,candidate;
const call=(worker,action,body={},token)=>worker('api',{action,...body,...(token?{_tk:token}:{})});
const login=(worker,key='owner',pin='582946')=>call(worker,'verifyLogin',{memberId:ids[key],name:names[key],dept:key==='other'?'부녀회':key==='edu'?'교육부':'청년회',pin});
const reads=[['getRoster',{}],['getMyActivities',{}],['getMyTargets',{includeHistory:false}],['getTargetJournal',{targetId:'COMPAT-TARGET'}],['getMyAttendance',{}],['getRequiredEducation',{}],['getTargetRoom',{targetId:'COMPAT-TARGET'}]];
before(async()=>{
  assert.equal(sql('select reference from compat_local.marker'),'0ea5ac7ea16a67b8ceb5b1848e45e13c0c064872');
  assert.equal(sql("select to_regclass('public.room_attachments') is null"),'t','이 순서 검사는 새로 준비한 기준 DB에서 한 번만 실행합니다.');
  [oldBefore,oldAfter,candidate]=await Promise.all([worker('old-before'),worker('old-after'),worker('candidate')]);
  tokens.oldBefore=(await login(oldBefore)).body.token;tokens.oldAfter=(await login(oldAfter)).body.token;assert.ok(tokens.oldBefore&&tokens.oldAfter);
});
after(async()=>{
  for(const child of workers){if(child.connected){const done=new Promise(resolve=>child.once('exit',resolve));child.send({op:'stop'});await done;}}
  save('workflow-facts.json',facts);
});
test('같은 운영 구조·가짜 자료에서 원격 코드 두 사본의 조회 7종이 일치',async()=>{
  for(const [action,body] of reads){const input={memberId:ids.owner,name:names.owner,...body};const a=await call(oldBefore,action,input,tokens.oldBefore),b=await call(oldAfter,action,input,tokens.oldAfter);assert.equal(a.status,200,action);assert.equal(a.body.error,undefined,action);assert.deepEqual(a,b,action);readReference.push({action,input,response:a});}
  facts.baselineReads=readReference.map(x=>({action:x.action,sha256:hash(JSON.stringify(x.response))}));
});
test('DB 추가 변경 뒤에도 원격 코드의 기존 조회 결과가 그대로 유지',async()=>{
  execFileSync(process.execPath,['tools/local-compat-setup.mjs','migrate'],{cwd:repo,stdio:['ignore','pipe','pipe']});
  for(const x of readReference){const result=await call(oldAfter,x.action,x.input,tokens.oldAfter);assert.deepEqual(result,x.response,x.action);}
  facts.oldCodeAfterMigrations={reads:readReference.length,identical:true};
});
test('새 로그인은 기존 PIN을 유지하고 이전 로그인 표는 다시 로그인하도록 거절',async()=>{
  const r=await login(candidate);assert.equal(r.body.ok,true,r.body.error);tokens.new=r.body.token;
  assert.equal((await call(candidate,'getMyActivities',{},tokens.oldAfter)).status,401);
  assert.equal((await call(oldAfter,'getMyActivities',{memberId:ids.owner},tokens.new)).body.auth,false);
  for(const x of readReference.filter(x=>!['getTargetRoom','getRoster'].includes(x.action))){const result=await call(candidate,x.action,x.input,tokens.new);assert.equal(result.body.error,undefined,x.action);}
  facts.login={existingPinAccepted:true,oldTokenRequiresLogin:true,newTokenNotAcceptedByOldCode:true};
});
test('새 코드에서 활동·출석·최초 PIN을 저장한 뒤 기존 코드에서도 내용이 남음',async()=>{
  const activity=await call(candidate,'submitActivity',{memberId:ids.owner,name:names.owner,date:'2026-11-14',roles:['교사'],activities:['복음방'],target:{name:'가짜전환대상',stage:'복음방',todayWork:'전환 후 보존할 새 활동'},reportText:'전환 후 보존할 새 보고'},tokens.new);
  assert.equal(activity.body.ok,true,activity.body.error);facts.newActivityId=activity.body.id;
  const attend=await call(candidate,'submitAttendance',{meetingId:'COMPAT-MEETING',memberId:ids.owner,name:names.owner,answers:{}},tokens.new);assert.equal(attend.body.ok,true,attend.body.error);
  const enrolled=await call(candidate,'registerPin',{memberId:ids.fresh,name:names.fresh,dept:'청년회',phone:'01000000085',pin:'582946'});assert.equal(enrolled.body.ok,true,enrolled.body.error);
  const oldActivities=await call(oldAfter,'getMyActivities',{memberId:ids.owner},tokens.oldAfter);assert.ok(oldActivities.body.rows.some(r=>r.id===facts.newActivityId&&r.todayWork==='전환 후 보존할 새 활동'));
  const oldAttend=await call(oldAfter,'getMyAttendance',{memberId:ids.owner},tokens.oldAfter);assert.equal(oldAttend.body.error,undefined);assert.ok(JSON.stringify(oldAttend.body).includes('COMPAT-MEETING'));
  assert.equal((await login(oldAfter,'fresh')).body.ok,true);
  assert.equal(sql("select count(*) from member_registration_contacts where nid='"+ids.fresh+"' and source='self_reported'"),'1');
  facts.newBusinessRecords={activityReadableByOld:true,attendanceReadableByOld:true,newPinReadableByOld:true,registrationContactPreserved:true};
});
test('새 비공개 첨부 원본은 보존되지만 이전 코드 응답은 새 참조를 그대로 노출',async()=>{
  const data=Buffer.from('%PDF-1.4\n% synthetic cutover document\n%%EOF\n');
  const upload=await call(candidate,'roomFileUpload',{targetId:'COMPAT-TARGET',fileName:'가짜전환문서.pdf',data:data.toString('base64')},tokens.new);assert.match(upload.body.url,/^room-private:/);
  const sent=await call(candidate,'sendRoomMessage',{targetId:'COMPAT-TARGET',text:'전환 후 보존할 첨부',file:{url:upload.body.url,name:upload.body.name}},tokens.new);assert.equal(sent.body.ok,true,sent.body.error);facts.newMessageId=sent.body.message.id;
  const downloaded=await candidate('download',{_tk:tokens.new,targetId:'COMPAT-TARGET',id:facts.newMessageId,kind:'file'});assert.equal(downloaded.status,200);assert.equal(hash(Buffer.from(downloaded.bytes,'base64')),hash(data));
  const old=await call(oldAfter,'getTargetRoom',{memberId:ids.owner,name:names.owner,targetId:'COMPAT-TARGET'},tokens.oldAfter);assert.equal(old.body.error,undefined);assert.match(JSON.stringify(old.body),/room-private:/);
  assert.equal(existsSync(new URL('../../.local-compat-20261114/upstream/api/room-attachment.js',import.meta.url)),false);
  assert.equal(sql('select count(*) from room_attachments where message_id='+facts.newMessageId),'1');
  facts.attachment={sha256:hash(data),candidateAuthenticatedRead:true,oldResponseLeaksUnsupportedPrivateReference:true,oldAuthenticatedRouteAbsentInSource:true,metadataPreserved:true};
});
test('원격 코드로 복귀하면 본인 확인·담당 범위가 다시 넓어지는 것을 재현',async()=>{
  const oldEdu=(await login(oldAfter,'edu')).body.token,newEdu=(await login(candidate,'edu')).body.token;assert.ok(oldEdu&&newEdu);
  const denied=await call(candidate,'getTargetRoom',{targetId:'COMPAT-TARGET'},newEdu);assert.ok(denied.body.error);
  const oldAccess=await call(oldAfter,'getTargetRoom',{memberId:ids.edu,name:names.edu,targetId:'COMPAT-TARGET'},oldEdu);assert.equal(oldAccess.body.error,undefined);assert.match(JSON.stringify(oldAccess.body),/전환 후 보존할 첨부/);
  const stillDenied=await call(candidate,'getTargetRoom',{targetId:'COMPAT-TARGET'},newEdu);assert.ok(stillDenied.body.error,'예전 자동 입장 행으로 새 권한을 우회할 수 없어야 함');
  const oldSpoof=await call(oldAfter,'getMyActivities',{memberId:ids.owner},oldEdu);assert.ok(oldSpoof.body.rows.some(r=>r.id===facts.newActivityId));
  assert.equal((await call(candidate,'getMyActivities',{memberId:ids.owner},newEdu)).status,403);
  const oldPublic=await call(oldAfter,'getMyAttendance',{memberId:ids.owner});assert.equal(oldPublic.body.error,undefined);
  assert.equal((await call(candidate,'getMyAttendance',{memberId:ids.owner})).status,401);
  facts.unsafeOldRollback={outOfScopeRoomAllowed:true,identityOverrideAllowed:true,unauthenticatedAttendanceReadAllowed:true,candidateRejectsAll:true};
});
test('후보 서버를 다시 시작해도 세션·새 기록·비공개 첨부 원본을 유지',async()=>{
  assert.deepEqual((await candidate('metrics')).blocked,[]);await candidate.stop();candidate=await worker('candidate');
  const record=await call(candidate,'getMyActivity',{id:facts.newActivityId},tokens.new);assert.equal(record.body.row.todayWork,'전환 후 보존할 새 활동');
  const file=await candidate('download',{_tk:tokens.new,targetId:'COMPAT-TARGET',id:facts.newMessageId,kind:'file'});assert.equal(file.status,200);assert.equal(hash(Buffer.from(file.bytes,'base64')),facts.attachment.sha256);
  facts.candidateRestart={sessionAccepted:true,newActivityReadable:true,attachmentOriginalHashMatches:true,dbRollbackPerformed:false,localDiskStorageFixture:true};
});
test('호환 점검 뒤 새 기록·기존 기록이 남고 외부 서비스 호출 없음',async()=>{
  assert.equal(sql("select count(*) from activities where today_work in ('보존할 기존 활동','전환 후 보존할 새 활동')"),'2');
  assert.equal(sql("select count(*) from attend_records where meeting_id='COMPAT-MEETING'"),'2');
  assert.equal(sql("select count(*) from target_room_messages where body in ('보존할 기존 대화','전환 후 보존할 첨부')"),'2');
  for(const w of [oldBefore,oldAfter,candidate]){const metrics=await w('metrics');assert.deepEqual(metrics.blocked,[]);}
  facts.productionChanged=false;facts.realExternalCalls=false;facts.rollbackToUnmodifiedOldCodeSafe=false;facts.compatibleRollbackUiVerified=false;
});
