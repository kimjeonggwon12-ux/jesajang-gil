// 기존 운영 코드를 실행할 격리 사본과 DB 두 개. 대상 변경/운영 접속 옵션 없음.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync,symlinkSync,readdirSync} from 'node:fs';
import {scryptSync,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const repo=new URL('../',import.meta.url),base=new URL('../../.local-compat-20261114/',import.meta.url),out=new URL('../../artifacts/cross-check-compat-20261114/',import.meta.url);
const ref='0ea5ac7ea16a67b8ceb5b1848e45e13c0c064872',before='jesajang_compat_before_20261114',after='jesajang_compat_after_20261114';
const q=x=>"'"+String(x).replaceAll("'","''")+"'";
function sql(text,db='postgres'){assert.ok(['postgres',before,after].includes(db));try{return execFileSync('/opt/homebrew/bin/psql',['-h','/tmp/jesajang-auth-pg-socket','-p','58431','-U','postgres','-d',db,'-qAt','-v','ON_ERROR_STOP=1'],{input:text,encoding:'utf8',maxBuffer:16*1024*1024,stdio:['pipe','pipe','pipe']}).trim();}catch{throw new Error('격리 호환 DB 준비 실패 — 입력 원문은 출력하지 않습니다.');}}
mkdirSync(base,{recursive:true,mode:0o700});mkdirSync(out,{recursive:true});
if(process.argv[2]==='prepare'){
  assert.equal(sql(`select count(*) from pg_database where datname in (${q(before)},${q(after)})`),'0','기존 호환 DB를 초기화하지 않습니다.');
  const source=new URL('upstream/',base);assert.equal(existsSync(source),false,'기존 원격 사본을 덮어쓰지 않습니다.');mkdirSync(source);
  const tar=execFileSync('git',['archive','--format=tar',ref,'api','server','app.html','package.json'],{cwd:repo,maxBuffer:64*1024*1024});
  execFileSync('/usr/bin/tar',['-xf','-','-C',fileURLToPath(source)],{input:tar});symlinkSync(fileURLToPath(new URL('node_modules/',repo)),new URL('node_modules',source));
  sql('create database '+before);
  sql(`create schema compat_local;create table compat_local.marker(reference text);insert into compat_local.marker values(${q(ref)});
    grant usage on schema public to anon,authenticated,service_role;
    alter default privileges for role postgres in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges for role postgres in schema public grant all on sequences to anon,authenticated,service_role;
    alter default privileges for role postgres in schema public grant execute on functions to anon,authenticated,service_role;`,before);
  const files=readdirSync(new URL('supabase/migrations/',repo)).filter(x=>/^00\d\d_.*\.sql$/.test(x)).sort();
  for(const f of files)sql(execFileSync('git',['show',ref+':supabase/migrations/'+f],{cwd:repo,encoding:'utf8'}),before);
  const salt='cd'.repeat(16),pin=scryptSync('582946',salt,32).toString('hex');
  const people=[['1','가짜전환교사','청년회'],['2','가짜전환회장','청년회'],['3','가짜전환타부서','부녀회'],['4','가짜전환교육','교육부'],['5','가짜전환미등록','청년회']];
  sql(`begin;${people.map(([i,name,dept])=>`insert into teachers(member_id,name,dept,region,position) values('990800000000${i}',${q(name)},${q(dept)},'1지역',${q(i==='2'?'회장':'')});`).join('\n')}
    ${people.slice(0,4).map(([i])=>`insert into member_pins(nid,pin_hash,salt,ver) values('990800000000${i}',${q(pin)},${q(salt)},'compat-v1');`).join('\n')}
    insert into admins(member_id,name,dept,region,position) values('9908000000002','가짜전환회장','청년회','1지역','회장'),('9908000000004','가짜전환교육','교육부','','교육부장');
    insert into targets(target_id,creator_id,target_name,stage) values('COMPAT-TARGET','9908000000001','가짜전환대상','복음방');
    insert into activities(member_id,name,submitted_at,activities,roles,target_name,target_stage,today_work,report_text) values('9908000000001','가짜전환교사','2026-11-01 09:00',array['복음방'],array['교사'],'가짜전환대상','복음방','보존할 기존 활동','보존할 기존 보고');
    insert into target_room_members(target_id,member_id,name,role) values('COMPAT-TARGET','9908000000001','가짜전환교사','담당');
    insert into target_room_messages(target_id,from_id,from_name,body,created_at) values('COMPAT-TARGET','9908000000001','가짜전환교사','보존할 기존 대화','2026-11-01 09:00');
    insert into attend_meetings(meeting_id,title,date,start_time,end_time,open_before,org,created_by) values('COMPAT-MEETING','가짜전환교육',to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD'),'00:00','23:59',0,'청년','9908000000004');
    insert into attend_records(record_id,meeting_id,member_id,name,dept,answers,at,method) values('COMPAT-OLD-ATTEND','COMPAT-MEETING','9908000000002','가짜전환회장','청년회','{"old":"보존할 답변"}','2026-11-01 09:00','QR');
    insert into cohorts(cohort_id,title,created_by) values('COMPAT-COURSE','가짜전환과정','9908000000004');
    insert into cohort_members(cohort_id,member_id,name) values('COMPAT-COURSE','9908000000001','가짜전환교사');commit;`,before);
  sql('create database '+after+' template '+before);
  const conf=readFileSync(new URL('../../.local-auth-20261111/postgrest.conf',import.meta.url),'utf8');
  for(const [name,db,port]of [['before',before,58435],['after',after,58436]]){
    assert.match(conf,/jesajang_auth_local/);assert.match(conf,/server-port\s*=\s*58432/);
    writeFileSync(new URL(name+'.conf',base),conf.replaceAll('jesajang_auth_local',db).replace(/server-port\s*=\s*58432/,'server-port = '+port),{mode:0o600});
  }
  writeFileSync(new URL('setup.json',out),JSON.stringify({reference:ref,before,after,baselineFiles:files.length,syntheticPeople:5,externalDataCopied:false},null,2)+'\n');
  console.log('격리 원격 사본과 같은 가짜 자료의 변경 전/후 DB 준비 완료');
}else if(process.argv[2]==='retry-fixture'){
  // 실패한 테스트를 다시 실행할 때만 사용한다. 이 도구의 가짜 DB 중 after 하나만 재준비한다.
  assert.equal(sql('select reference from compat_local.marker',before),ref);assert.equal(sql('select reference from compat_local.marker',after),ref);
  assert.equal(sql(`select count(*) from pg_stat_activity where datname in (${q(before)},${q(after)})`),'0','두 로컬 REST/검사 프로세스를 먼저 종료해야 합니다.');
  assert.equal(sql("select count(*) from teachers where member_id not like '990800000000_'",after),'0','예상 밖 자료가 있으면 중단');
  sql('drop database '+after);sql('create database '+after+' template '+before);console.log('실패한 가짜 자료 검사만 다시 준비했습니다.');
}else if(process.argv[2]==='migrate'){
  assert.equal(sql('select reference from compat_local.marker',after),ref);
  assert.equal(sql("select to_regclass('public.room_attachments') is null",after),'t','이미 변경한 DB에 재적용하지 않습니다.');
  const manifest=JSON.parse(readFileSync(new URL('../../artifacts/cross-check-schema-20261114/candidate.json',import.meta.url),'utf8'));
  for(const f of manifest.pendingFiles){const text=readFileSync(new URL('supabase/migrations/'+f.file,repo),'utf8');assert.equal(createHash('sha256').update(text).digest('hex'),f.sha256);sql("begin;set local lock_timeout='500ms';set local statement_timeout='5s';\n"+text.replace(/^\s*(?:begin|commit);\s*$/gmi,'')+'\ncommit;',after);}
  sql("notify pgrst,'reload schema'",after);console.log('격리 후속 DB에 검증한 22개 변경 적용 완료');
}else throw new Error('prepare, migrate 또는 retry-fixture만 허용합니다.');
