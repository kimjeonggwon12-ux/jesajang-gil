// 기존 4B2 DB/파일은 읽기 전용 기준으로 보존하고 새 격리 DB에만 최신 두 SQL을 적용한다.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync,cpSync} from 'node:fs';
import assert from 'node:assert/strict';
import {OWNER} from '../tests/helpers/education-fixture.mjs';
const base='jesajang_compat_after_20261114',target='jesajang_recovery_current_20261114';
const recordsOnly=process.argv[2]==='resume-records',resume=process.argv[2]==='resume-clone'||recordsOnly;assert.ok(!process.argv[2]||resume);
function sql(text,db=target){assert.ok([base,target,'postgres'].includes(db));try{return execFileSync('/opt/homebrew/bin/psql',['-h','/tmp/jesajang-auth-pg-socket','-p','58431','-U','postgres','-d',db,'-qAt','-v','ON_ERROR_STOP=1'],{input:text,encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:16*1024*1024}).trim();}catch{throw Error('고정 가짜 DB 준비 실패. 입력/응답 원문은 출력하지 않음');}}
const dir=new URL('../../.local-current-recovery-20261114/',import.meta.url);
assert.ok(!existsSync(dir),'기존 준비 폴더는 덮어쓰지 않습니다.');
assert.equal(sql(`select count(*) from pg_database where datname='${target}'`,'postgres'),resume?'1':'0');
assert.equal(sql('select reference from compat_local.marker',base),'0ea5ac7ea16a67b8ceb5b1848e45e13c0c064872');
assert.equal(sql("select count(*) from teachers where member_id not like '990800000000_'",base),'0');
assert.equal(sql("select count(*) from information_schema.columns where table_name='attend_records' and column_name='additional_records'",base),'0');
const tables=JSON.parse(sql("select json_agg(tablename order by tablename) from pg_tables where schemaname='public'",base));
const hashes=db=>Object.fromEntries(tables.map(t=>{const row=t==='attend_records'?"(to_jsonb(x)-'additional_records')":'to_jsonb(x)';return[t,sql(`select md5(coalesce(jsonb_agg(${row} order by ${row}::text),'[]')::text) from public."${t}" x`,db)];}));
const before=hashes(base);
if(!resume){
 sql(`create database ${target} template ${base}`,'postgres');
 for(const file of ['20261113215031_attendance_sessions.sql','20261113222343_telegram_update_receipts.sql'])sql(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
}else if(!recordsOnly){
 assert.equal(sql('select reference from compat_local.marker'),'0ea5ac7ea16a67b8ceb5b1848e45e13c0c064872');
 assert.equal(sql("select count(*) from information_schema.columns where table_name='attend_records' and column_name='additional_records'"),'1');
 assert.equal(sql('select count(*) from telegram_update_receipts'),'0');
}
if(!recordsOnly)assert.deepEqual(hashes(target),before,'새 구조 적용 뒤 기존 표 내용 유지');
if(recordsOnly)assert.equal(sql('select reference from compat_local.marker'),'current-recovery-5A4');
if(!recordsOnly)sql(`begin;
update compat_local.marker set reference='current-recovery-5A4';
insert into teachers(member_id,name,dept,region) values('${OWNER}','테스트앱관리','청년회','1지역');
insert into member_pins(nid,pin_hash,salt,ver) select '${OWNER}',pin_hash,salt,'current-recovery-owner' from member_pins where nid='9908000000001';
insert into attend_meetings(meeting_id,title,date,start_time,end_time,status,slots,questions) values('RECOVERY-SLOTS','가짜 복구 두 타임','2026-11-14','09:00','20:00','열림','[{"start":"09:00","end":"10:00"},{"start":"19:00","end":"20:00"}]','[{"id":"q1","text":"가짜 응답","type":"text"}]');
commit;`);
for(const [record,at,answer] of [['RECOVERY-AM','09:00:00','가짜 오전'],['RECOVERY-PM','19:00:00','가짜 저녁']]){
 const result=JSON.parse(sql(`select public.attendance_session_submit(jsonb_build_object('record_id','${record}','meeting_id','RECOVERY-SLOTS','member_id','9908000000001','name','가짜전환교사','dept','청년회','position','교사','pick_org','','pick_district','','dept24','','at','2026-11-14 ${at}','answers',jsonb_build_object('q1','${answer}'),'method','qr','late','정상 출석'),(select jsonb_object_agg(key,value) from attend_meetings m,jsonb_each(to_jsonb(m)) where meeting_id='RECOVERY-SLOTS' and key=any(array['date','start_time','end_time','open_before','questions','status','slots','cohort_id','series_id','org','district','ask_district','ask_dept','start2'])))`));
 assert.ok(result.record&&!result.errorCode,'실제 원자 저장 함수로 두 타임 기록 생성');
}
assert.equal(sql("select jsonb_array_length(additional_records) from attend_records where meeting_id='RECOVERY-SLOTS'"),'1');
sql("insert into edu_delivery_log(delivery_key,meeting_id,phase,room_key,part_no,mode,status) values('recovery-unknown','RECOVERY-SLOTS','최종','가짜 복구방',0,'auto','unknown'),('recovery-sending','RECOVERY-SLOTS','오전','가짜 복구방',0,'auto','sending'),('recovery-sent','RECOVERY-SLOTS','저녁','가짜 복구방',0,'auto','sent');");
assert.deepEqual(hashes(base),before,'기존 4B2 원본 내용 보존');
mkdirSync(dir,{mode:0o700});cpSync(new URL('../../.local-compat-20261114/private-storage/',import.meta.url),new URL('private-storage/',dir),{recursive:true,errorOnExist:true});
const conf=readFileSync(new URL('../../.local-compat-20261114/after.conf',import.meta.url),'utf8');assert.match(conf,/server-port\s*=\s*58436/);assert.ok(conf.includes(base));
writeFileSync(new URL('after.conf',dir),conf.replaceAll(base,target),{mode:0o600});
writeFileSync(new URL('../../artifacts/recovery-current-20261114/setup.json',import.meta.url),JSON.stringify({ok:true,sourceDb:base,targetDb:target,sourceTableHashes:before,sourcePreserved:true,cloneExistingContentsPreserved:true,migrationsAdded:2,attendanceRows:1,attendanceSessions:2,originalStoragePreserved:true,productionChanged:false},null,2));
console.log(JSON.stringify({ok:true,sourcePreserved:true,targetDb:target,migrationsAdded:2,attendanceSessions:2,productionChanged:false}));
