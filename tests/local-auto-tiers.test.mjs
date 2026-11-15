import {test,beforeEach} from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {ids,sql,api,login,jwt,quote} from './helpers/local-db.mjs';
import {seedAutoTiers,addRecords,autoInputs,tierSnapshot} from './helpers/auto-tier-fixture.mjs';
import {legacyAutoPlan} from './helpers/legacy-auto-tiers.mjs';
process.env.SUPABASE_URL='http://127.0.0.1:58433';process.env.SUPABASE_SERVICE_ROLE_KEY=jwt('service_role');
const {automaticTiersAt,promoteOnRecord,promoteOnAttend}=await import('../server/actions/tiers.js');
const {forgetRoster}=await import('../server/actions/roster.js');
const at=day=>new Date(day+'T12:00:00+09:00'),today=()=>new Date(Date.now()+9*3600e3).toISOString().slice(0,10);
const rpc=async(mode,nid=ids.member,day='2026-11-13',once=false)=>{const r=await fetch('http://127.0.0.1:58432/rpc/auto_tier_apply',{method:'POST',headers:{authorization:'Bearer '+jwt('service_role'),'content-type':'application/json'},body:JSON.stringify({p_mode:mode,p_nid:nid,p_day:day,p_once:once})});return {status:r.status,body:await r.json()};};
beforeEach(()=>{seedAutoTiers();forgetRoster();});
test('운영 원본 계산과 시작일·월말·연말·윤일·이름 보정·과거 미래 기록 결과가 같다',async()=>{
 sql(`insert into teachers(member_id,name,dept,tier,tier_changed_at,month_stats,sort_order) values
 ('9700000000101','가짜유일이름','장년회','휴교사',null,'{}',101),
 ('9700000000102','가짜동명이인','장년회','휴교사',null,'{}',102),
 ('9700000000103','가짜동명이인','부녀회','기타',null,'{}',103),
 ('9700000000104','가짜기타','청년회','휴교사','2026-11-05','{"tierRaw":"기타"}',104),
 ('9700000000105','가짜최근변경','청년회','휴교사','2026-11-06','{"tierRaw":"기타"}',105),
 ('9700000000106','가짜활동','청년회','활동교사',null,'{}',106),
 ('9700000000107','가짜월중변경','청년회','활동교사','2026-11-06','{}',107),
 ('9700000000108','가짜월첫날변경','청년회','활동교사','2026-11-05','{}',108),
 ('9700000000109','가짜월3회','청년회','활동교사',null,'{}',109),
 ('9700000000110','가짜월4회','청년회','활동교사',null,'{}',110);`);
 for(const [id,n,date,name,raw] of [[ids.member,3,'2026-11-05'],[ids.member,1,'2026-11-30 23:59:59.999999'],['9700000000101',4,'2026-11-13',' 가짜유일이름 ','999999991'],['9700000000102',4,'2026-11-13','가짜동명이인','999999992'],['9700000000109',3,'2026-11-05'],['9700000000110',4,'2026-11-06'],[ids.member,1,'2026-12-01'],[ids.member,1,'2027-01-01'],[ids.member,1,'2026-11-04 23:59:59.999999']])addRecords(id,n,date,name,raw);
 sql("insert into attend_records(record_id,meeting_id,member_id,at)select 'AUTO-'||n||'-'||i,'AUTO-'||i,'9700000000'||n,'2026-11-05' from generate_series(104,105)n cross join generate_series(1,2)i");
 const data=autoInputs(),before=tierSnapshot();
 const dates=['2024-02-29','2026-10-31','2026-11-04','2026-11-05','2026-11-30','2026-12-01','2026-12-31','2027-01-01','2027-02-28'];
 for(const day of dates){const expected=await legacyAutoPlan(data.teachers,data.activities,data.attend_records,day);assert.deepEqual(await automaticTiersAt({dryRun:true},at(day)),expected,day);}
 assert.equal(tierSnapshot(),before);
 const dec=await automaticTiersAt({dryRun:true},at('2026-12-01'));
 assert.ok(dec.toRest.some(p=>p.memberId==='9700000000108'));assert.ok(!dec.toRest.some(p=>p.memberId==='9700000000107'));assert.ok(!dec.toRest.some(p=>p.memberId==='9700000000110'));
});
test('즉시 활동은 원래 직접 번호 기준과 4회 문턱·1000행 표시 한도·미래 상한 없음을 유지한다',async()=>{
 addRecords(ids.member,3);assert.deepEqual(await promoteOnRecord(ids.member,at('2026-11-13')),{restCount:3,restGoal:4});
 addRecords(ids.member,1,'2026-12-01');assert.equal((await promoteOnRecord(ids.member,at('2026-11-13'))).tierNow,'활동교사');
 assert.equal(await promoteOnRecord(ids.member,at('2026-11-13')),null);assert.equal(sql('select count(*) from tier_history'),'1');
 sql(`update teachers set tier='휴교사' where nid='${ids.member}';truncate activities`);addRecords(ids.member,1005);
 const r=await promoteOnRecord(ids.member,at('2026-11-13'));assert.equal(r.restCount,1000);assert.equal(r.tierNow,'활동교사');
});
test('기타 출석은 서로 다른 모임 2회·시작일·첫 전환 상태를 보존한다',async()=>{
 sql(`update teachers set tier='기타' where nid='${ids.member}';insert into attend_records(record_id,meeting_id,member_id,at)values('AU1','AU1','${ids.member}','2026-11-04 23:59:59.999999'),('AU2','AU2','${ids.member}','2026-11-05')`);
 assert.deepEqual(await promoteOnAttend(ids.member,at('2026-11-13')),{otherAttend:1,otherGoal:2});
 sql(`insert into attend_records(record_id,meeting_id,member_id,at)values('AU3','AU3','${ids.member}','2026-11-06')`);
 assert.equal((await promoteOnAttend(ids.member,at('2026-11-13'))).tierNow,'활동교사');assert.equal(await promoteOnAttend(ids.member,at('2026-11-13')),null);assert.equal(sql('select count(*) from tier_history'),'1');
});
test('동시 즉시 전환 12건은 등급/이력/작업 기록을 한 번만 바꾼다',async()=>{
 addRecords(ids.member,4);const rs=await Promise.all(Array.from({length:12},()=>promoteOnRecord(ids.member,at('2026-11-13'))));
 assert.equal(rs.filter(r=>r?.tierNow).length,1);assert.equal(sql('select count(*) from tier_history'),'1');assert.equal(sql('select count(*) from roster_changes'),'1');
});
test('동시 하루 실행은 하나만 완료하고 이전 완료 표가 있으면 기존 기록을 존중한다',async()=>{
 addRecords(ids.member,4);const rs=await Promise.all(Array.from({length:8},()=>automaticTiersAt({once:true},at('2026-11-13'))));
 assert.equal(rs.filter(Boolean).length,1);assert.equal(sql('select count(*) from tier_history'),'1');assert.equal(sql("select count(*) from alert_log where dedup_key='tierAuto:2026-11-13'"),'1');
 sql(`update teachers set tier='휴교사' where nid='${ids.member}'`);const before=tierSnapshot();assert.equal(await automaticTiersAt({once:true},at('2026-11-13')),null);assert.equal(tierSnapshot(),before);
});
test('개별 이력·작업 이력·하루 완료 표 실패는 전부 취소하고 다음 실행으로 복구한다',async()=>{
 addRecords(ids.member,4);for(const table of ['tier_history','roster_changes','alert_log']){
  const before=tierSnapshot();sql(`alter table ${table} add constraint local_auto_failure check(false) not valid`);
  try{await assert.rejects(automaticTiersAt({once:true},at('2026-11-13')));assert.equal(tierSnapshot(),before);}finally{sql(`alter table ${table} drop constraint local_auto_failure`);}
 }
 assert.equal((await automaticTiersAt({once:true},at('2026-11-13'))).toActive.length,1);assert.equal(sql('select count(*) from tier_history'),'1');
});
async function withTeacherLock(change,work){
 const child=spawn('/opt/homebrew/bin/psql',['-h','/tmp/jesajang-auth-pg-socket','-p','58431','-U','postgres','-d','jesajang_auth_local','-v','ON_ERROR_STOP=1','-At'],{stdio:['pipe','pipe','pipe']});
 let output='',stderr='';child.stderr.on('data',x=>stderr+=x);const exited=new Promise((resolve,reject)=>child.on('exit',code=>code===0?resolve():reject(Error('local lock helper failed'))));
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('local lock not acquired')),3000);child.stdout.on('data',x=>{output+=x;if(output.includes('LOCAL_LOCKED')){clearTimeout(timer);resolve();}});child.stdin.write("begin;lock table teachers in share row exclusive mode;select 'LOCAL_LOCKED';\n");});
 try{const pending=work();await new Promise(r=>setTimeout(r,80));child.stdin.end(change+';commit;\n');await exited;return await pending;}
 finally{if(child.exitCode===null){child.stdin.end('rollback;\n');await exited;}}
}
test('수동 정교사 변경이 먼저 잠금을 잡으면 자동 전환이 최신 값을 읽어 덮어쓰지 않는다',async()=>{
 addRecords(ids.member,4);const r=await withTeacherLock(`update teachers set tier='정교사' where nid='${ids.member}'`,()=>promoteOnRecord(ids.member,at('2026-11-13')));
 assert.equal(r,null);assert.equal(sql(`select tier from teachers where nid='${ids.member}'`),'정교사');assert.equal(sql('select count(*) from tier_history'),'0');
});
test('전환 잠금 대기 중 추가된 기록도 계산 전에 확인한다',async()=>{
 addRecords(ids.member,4);const r=await withTeacherLock(`insert into activities(member_id,name,submitted_at)values('${ids.member}','테스트교사','2026-11-13')`,()=>promoteOnRecord(ids.member,at('2026-11-13')));
 assert.equal(r.tierNow,'활동교사');assert.equal(r.restCount,5);
});
test('예약 API는 운영 키가 필요하고 클라이언트가 지정한 날짜를 사용하지 않는다',async()=>{
 const token=(await login()).body.token;for(const body of [{},{key:'wrong'},{day:'2027-01-01'}])assert.equal((await api('tierAutoRest',body,token)).status,401);
 const r=(await api('tierAutoRest',{key:'local-only-education-webhook-key',dryRun:true,day:'1900-01-01',now:'1900-01-01'})).body;assert.equal(r.ok,true);assert.ok(r.month.start.startsWith(today().slice(0,7)));
});
test('새 함수는 비공개 invoker이며 실행 실패 시 완료 표가 없다',async()=>{
 for(const name of ['auto_tier_plan','auto_tier_apply']){
  assert.equal(sql(`select prosecdef from pg_proc where proname=${quote(name)}`),'f');
  for(const role of ['anon','authenticated']){const r=await fetch('http://127.0.0.1:58432/rpc/'+name,{method:'POST',headers:{authorization:'Bearer '+jwt(role),'content-type':'application/json'},body:JSON.stringify({p_mode:'daily',p_nid:'',p_day:today(),...(name==='auto_tier_apply'?{p_once:true}:{})})});assert.ok([401,403].includes(r.status));}
 }
 const r=await rpc('record','0');assert.ok(r.status>=400);assert.equal(sql('select count(*) from alert_log'),'0');
});
test('200명 단위 중간 저장 없이 2105명을 함께 바꾸고 계산/쓰기 시간을 기록한다',async()=>{
 sql("insert into teachers(member_id,name,dept,tier,sort_order)select '96000000'||lpad(i::text,5,'0'),'가짜일괄'||i,'청년회','휴교사',i+100 from generate_series(1,2105)i;insert into activities(member_id,name,submitted_at)select '96000000'||lpad(i::text,5,'0'),'가짜일괄'||i,'2026-11-13' from generate_series(1,2105)i cross join generate_series(1,4)n;analyze teachers;analyze activities;");
 const before=tierSnapshot(),start=performance.now(),preview=await automaticTiersAt({dryRun:true},at('2026-11-13')),readMs=performance.now()-start;assert.equal(preview.toActive.length,2105);assert.equal(tierSnapshot(),before);
 const writeStart=performance.now(),result=await automaticTiersAt({once:true},at('2026-11-13')),writeMs=performance.now()-writeStart;assert.equal(result.toActive.length,2105);assert.equal(sql('select count(*) from tier_history'),'2105');assert.equal(sql('select count(*) from roster_changes'),'1');
 writeFileSync('../artifacts/cross-check-auto-tier-20261113/bulk-timing.json',JSON.stringify({syntheticOnly:true,teachers:2112,changed:2105,readMs,writeMs,operationalLatencyClaim:false},null,2));
});

test('활동 저장 후 자동 전환 실패는 기록을 보존하고 재등록을 유도하지 않는 상태를 돌려준다',async()=>{
 addRecords(ids.member,3,today());sql('truncate report_rooms restart identity');const token=(await login()).body.token;
 sql('alter table tier_history add constraint local_auto_failure check(false) not valid');
 try{const r=(await api('submitActivity',{roles:['교사'],activities:['피드백'],date:today()},token)).body;
  assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.tierUpdatePending,true);assert.equal(r.tierNow,undefined);
  assert.equal(sql('select count(*) from activities'),'4');assert.equal(sql('select count(*) from tier_history'),'0');assert.equal(sql(`select tier from teachers where nid='${ids.member}'`),'휴교사');
 }finally{sql('alter table tier_history drop constraint local_auto_failure');}
 assert.equal((await automaticTiersAt()).toActive.length,1);assert.equal(sql('select count(*) from activities'),'4');
});
test('출석 저장 후 자동 전환 실패도 기존 출석을 남기고 중복 제출로 등급 완료를 꾸미지 않는다',async()=>{
 sql(`update teachers set tier='기타' where nid='${ids.member}';insert into attend_records(record_id,meeting_id,member_id,at)values('AUTO-OLD','AUTO-OLD','${ids.member}','2026-11-05');
 insert into attend_meetings(meeting_id,title,date,questions,status,start_time,end_time)values('MT390001','[TEST] 자동 전환','${today()}','[]','열림','','')on conflict(meeting_id)do update set date=excluded.date,questions='[]',status='열림',start_time='',end_time='';`);
 const token=(await login()).body.token,body={meetingId:'MT390001',memberId:ids.member,name:'테스트교사'};
 sql('alter table tier_history add constraint local_auto_failure check(false) not valid');
 try{const r=(await api('submitAttendance',body,token)).body;assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.record.tierUpdatePending,true);assert.equal(r.record.tierNow,undefined);assert.equal(sql('select count(*) from tier_history'),'0');assert.equal(sql('select count(*) from attend_records'),'2');}
 finally{sql('alter table tier_history drop constraint local_auto_failure');}
 const duplicate=(await api('submitAttendance',body,token)).body;assert.equal(duplicate.already,true);assert.equal(duplicate.record.tierNow,undefined);assert.equal(sql('select count(*) from attend_records'),'2');
 assert.equal((await automaticTiersAt()).toActive.length,1);
});
