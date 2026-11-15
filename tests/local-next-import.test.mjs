import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import vm from 'node:vm';
import * as XLSX from '../next-app/node_modules/xlsx/xlsx.mjs';
import {ids,PIN,sql,jwt,quote} from './helpers/local-db.mjs';
import {seedImport,teacherState,comparable,activitySheet} from './helpers/import-fixture.mjs';
import {OWNER} from './helpers/education-fixture.mjs';
import {defaultKeepIds} from '../next-app/lib/roster-import.ts';
const base='http://127.0.0.1:58434';
async function api(action,body={},token){const r=await fetch(base+'/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...body,...(token?{_tk:token}:{})})});return {status:r.status,body:await r.json()};}
const login=async(id,name,dept='청년회')=>(await api('verifyLogin',{memberId:id,name,dept,pin:PIN})).body.token;
let fixture,teacher,education,evangel;
beforeEach(async()=>{fixture=seedImport();[teacher,education,evangel]=await Promise.all([login(ids.member,'테스트교사'),login(ids.admin,'테스트교육'),login(ids.evangel,'테스트전도','전도부')]);assert.ok(teacher&&education&&evangel);});
const options={applyTiers:true,keepIds:[],renameIds:[]};
const preview=(extra={},token=evangel)=>api('previewRosterImport',{rows:fixture.rows,...options,detailsAll:true,...extra},token);
const apply=(p,extra={},token=evangel)=>api('applyRosterImport',{rows:fixture.rows,...options,source:'가짜 Next 이관 검증',requireReview:true,expectReview:p.review,expectAfter:p.after,...extra},token);
const savedCounts=()=>sql("select (select count(*) from roster_snapshots)||','||(select count(*) from tier_history)||','||(select count(*) from roster_changes)");
test('가져오기 기본 상한과 전체 미리보기의 집계·보존 선택을 유지한다',async()=>{
 const full=(await preview()).body,limited=(await preview({detailsAll:false})).body;assert.equal(full.ok,true);assert.ok(full.removed.count>300);assert.equal(limited.removed.rows.length,300);assert.equal(full.removed.rows.length,full.removed.count);
 assert.equal(full.after,fixture.rows.length);assert.equal(limited.removed.count,full.removed.count);assert.equal(full.review,limited.review);
 const kept=defaultKeepIds(full);assert.ok(kept.length>300);const reviewed=(await preview({keepIds:kept})).body;assert.equal(reviewed.kept.count,kept.length);assert.equal(reviewed.after,full.after+kept.length);
});
test('전도 담당자의 기존 가져오기 계산·명단·등급 이력·관리 도구 복원이 일치한다',async()=>{
 const keepIds=fixture.before.slice(fixture.rows.length).filter(row=>row.position).map(row=>row.member_id),renameIds=[fixture.rows[40].memberId];
 const check=(await preview({keepIds,renameIds})).body;
 // 이전 커밋의 계산을 같은 가짜 자료에 실행해 실제 저장되는 전체 열을 비교한다.
 const original=execFileSync('git',['show','4b8233f:server/actions/roster-import.js'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 const normId=value=>String(value||'').replace(/\D/g,'').replace(/^0+/,'')||'0';
 const admins=JSON.parse(sql("select coalesce(json_agg(a),'[]') from admins a"));
 const query=table=>({table,select(){return this;},order(){return this;}});
 const context={normId,kstDate:()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'}),clip:(value,n)=>String(value??'').trim().slice(0,n),TEACHER_TIERS:['휴교사','기타','활동교사','정교사','우수교사'],db:()=>({from:query}),selectAll:async build=>build().table==='teachers'?fixture.before:admins};
 vm.createContext(context);vm.runInContext(original.slice(original.indexOf('const DENIED'),original.indexOf('const capped')),context);
 context.input=fixture.rows;context.options={...options,keepIds,renameIds};
 const previous=await vm.runInContext('plan(cleanRows(input),options)',context);
 const historyBefore=Number(sql("select count(*) from tier_history where reason='가짜 Next 이관 검증 반영'"));
 const result=(await apply(check,{keepIds,renameIds})).body;assert.equal(result.ok,true);assert.ok(result.snapshotId);
 const expected=new Map(fixture.before.filter(row=>!previous.removeIds.includes(row.member_id)).map(row=>[row.member_id,row]));
 for(const row of previous.upserts)expected.set(row.member_id,row);
 const actual=comparable(teacherState()),expectedRows=JSON.parse(JSON.stringify(comparable([...expected.values()])));assert.equal(actual.length,expectedRows.length);actual.forEach((row,index)=>assert.deepEqual(row,expectedRows[index]));
 assert.equal(Number(sql("select count(*) from tier_history where reason='가짜 Next 이관 검증 반영'"))-historyBefore,previous.upserts.filter(row=>row._history).length);
 assert.equal(JSON.parse(sql('select after from roster_changes where kind=\'엑셀 반영\' order by id desc limit 1'))['이름 변경'],1);
 const env={PATH:process.env.PATH,SUPABASE_URL:'http://127.0.0.1:58433',SUPABASE_SERVICE_ROLE_KEY:jwt('service_role')};
 execFileSync(process.execPath,['tools/restore-roster-snapshot.mjs',String(result.snapshotId)],{env,stdio:['ignore','pipe','pipe']});
 assert.deepEqual(comparable(teacherState()),comparable(fixture.before));
 assert.equal(sql("select actor_name from roster_changes order by id desc limit 1"),'복구 도구');
});
test('교육 담당자는 명단을 가져올 수 있지만 엑셀 등급 변경은 우회할 수 없다',async()=>{
 assert.ok((await preview({},teacher)).body.error);
 assert.match((await preview({},education)).body.error,/전도 담당자/);
 const rows=[...fixture.rows,{...fixture.rows[30],memberId:'9899999999999',name:'가짜신규',tier:'우수교사'}];
 const check=(await preview({rows,applyTiers:false},education)).body;assert.equal(check.ok,true);assert.equal(check.added.rows[0].tier,'활동교사');
 const result=await apply(check,{rows,applyTiers:false},education);assert.equal(result.body.ok,true);
 const before=new Map(fixture.before.map(row=>[row.member_id,row]));
 for(const row of teacherState())assert.equal(row.tier,before.get(row.member_id)?.tier||'활동교사');
 assert.equal(sql("select actor_name from roster_changes where kind='엑셀 반영' order by id desc limit 1"),'테스트교육');
});
test('같은 인원이라도 명단·관리자·선택·파일이 바뀌면 확인한 가져오기를 실행하지 않는다',async()=>{
 const p=(await preview()).body,counts=savedCounts();
 sql("update teachers set note='미리보기 후 수정' where member_id='"+fixture.rows[30].memberId+"'");
 assert.equal((await apply(p)).body.stale,true);assert.equal(savedCounts(),counts);
 const current=(await preview()).body;
 assert.equal((await apply(current,{applyTiers:false})).body.stale,true);
 assert.equal((await apply(current,{rows:fixture.rows.map((r,i)=>i===30?{...r,name:'변경된파일'}:r)})).body.stale,true);
 sql("update admins set region='변경지역' where member_id='"+ids.admin+"'");
 assert.equal((await apply(current)).body.stale,true);assert.equal(savedCounts(),counts);
});
test('동시 반영은 한 건만 성공하고 스냅샷·변경 이력을 중복 생성하지 않는다',async()=>{
 const p=(await preview()).body;
 const results=await Promise.all([apply(p),apply(p)]);assert.equal(results.filter(r=>r.body.ok).length,1);assert.equal(results.filter(r=>r.body.stale).length,1);
 assert.equal(Number(sql('select count(*) from roster_snapshots')),1);assert.equal(Number(sql("select count(*) from roster_changes where kind='엑셀 반영'")),1);
});
test('변경 기록 저장 실패 시 명단·스냅샷·등급 이력까지 모두 되돌린다',async()=>{
 const p=(await preview()).body,counts=savedCounts(),before=comparable(teacherState());
 sql("create or replace function public.local_import_failure() returns trigger language plpgsql as $$ begin if new.kind='엑셀 반영' then raise exception 'fake rollback test'; end if; return new; end $$; create trigger local_import_failure before insert on roster_changes for each row execute function public.local_import_failure();");
 try{assert.equal((await apply(p)).status,503);assert.deepEqual(comparable(teacherState()),before);assert.equal(savedCounts(),counts);}
 finally{sql('drop trigger local_import_failure on roster_changes; drop function public.local_import_failure();');}
});
test('가져오기 DB 함수는 서비스 역할만 실행하며 공개 역할은 직접 호출할 수 없다',async()=>{
 for(const role of ['anon','authenticated'])for(const fn of ['roster_import_state','roster_apply_reviewed']){
  const response=await fetch('http://127.0.0.1:58432/rpc/'+fn,{method:'POST',headers:{authorization:'Bearer '+jwt(role),'content-type':'application/json'},body:JSON.stringify(fn==='roster_apply_reviewed'?{p:{}}:{})});assert.ok([401,403].includes(response.status));
 }
 assert.equal(sql("select count(*) from pg_proc where proname in ('roster_import_state','roster_apply_reviewed') and prosecdef"),'0');
});
test('원본 엑셀 다운로드는 권한·비밀번호·전체 명단·15개 항목과 실행 기록을 확인한다',async()=>{
 assert.equal((await api('exportRosterSheet',{password:'local-only-export-password'},teacher)).status,403);
 assert.match((await api('exportRosterSheet',{password:'wrong'},education)).body.error,/비밀번호/);
 for(const token of [education,evangel]){
  const result=(await api('exportRosterSheet',{password:'local-only-export-password',query:'없는이름',limit:1},token)).body;assert.equal(result.ok,true);
  const workbook=XLSX.read(Buffer.from(result.base64,'base64'),{type:'buffer'}),rows=XLSX.utils.sheet_to_json(workbook.Sheets['교사명단'],{header:1});
  assert.equal(rows.length,fixture.before.length+1);assert.equal(rows[0].length,15);assert.equal(rows[0][0],'고유번호');assert.equal(rows[1][0],fixture.before[0].member_id);
 }
 assert.ok(Number(sql("select count(*) from alert_log where kind='명단엑셀' and summary like '파일 준비 · exportRosterSheet%' "))>=2);
});
test('전체 백업은 가짜 비공개 저장소에 생성하고 서명 링크의 gzip 내용까지 확인한다',async()=>{
 for(const token of [teacher,education,evangel])for(const action of ['createBackup','getBackups'])assert.equal((await api(action,{},token)).status,403);
 sql(`insert into teachers(member_id,name,dept,region)values('${OWNER}','테스트앱관리','청년회','1지역');insert into member_pins(nid,pin_hash,salt,ver)select '${OWNER}',pin_hash,salt,'backup-owner' from member_pins where nid='${ids.member}';`);
 const owner=await login(OWNER,'테스트앱관리'),backupTeachers=teacherState();assert.ok(owner);
 assert.equal((await api('checkAdmin',{},owner)).body.permissions.canManageBackup,true);assert.equal((await api('checkAdmin',{},education)).body.permissions.canManageBackup,false);
 const made=(await api('createBackup',{},owner)).body;assert.equal(made.ok,true);assert.ok(made.tables>=69);assert.match(made.url,/^http:\/\/127\.0\.0\.1:58433\/storage\/v1\/object\/sign\/backups\//);
 const response=await fetch(made.url);assert.equal(response.status,200);const backup=JSON.parse(gunzipSync(Buffer.from(await response.arrayBuffer())));
 assert.equal(backup.counts.teachers,backupTeachers.length);assert.deepEqual(comparable(backup.data.teachers),comparable(backupTeachers));assert.ok(backup.data.member_pins.length>0);
 for(const table of ['edu_roster','edu_roster_policy','edu_delivery_log']){assert.ok(Array.isArray(backup.data[table]));assert.equal(backup.counts[table],Number(sql('select count(*) from '+table)));}
 assert.equal((await fetch(made.url.replace(/token=[^&]+/,'token=invalid'))).status,403);
 const list=(await api('getBackups',{},owner)).body;assert.ok(list.rows.some(row=>row.name===made.name));
 const evidence={fakeOnly:true,fullImportChoices:true,legacyCalculationParity:true,tierScopePreserved:true,staleAndConcurrentWritesProtected:true,atomicRollback:true,originalExport:true,localSignedBackupContent:true,productionTouched:false};
 writeFileSync('../artifacts/next-phase3-20261112/import-check.json',JSON.stringify(evidence,null,2));
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(activitySheet(fixture.rows)),'11월');writeFileSync('../artifacts/next-phase3-20261112/fake-import.xlsx',XLSX.write(book,{type:'buffer',bookType:'xlsx'}));
});
