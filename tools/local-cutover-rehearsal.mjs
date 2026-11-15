// 고정 로컬 클러스터의 새 DB만 사용. 운영 연결/외부 발송/환경 파일 로딩 없음.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,readdirSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const repo=new URL('../',import.meta.url), out=new URL('../../artifacts/cross-check-schema-20261114/',import.meta.url);
const db='jesajang_cutover_20261114', source='jesajang_auth_local', reference='0ea5ac7ea16a67b8ceb5b1848e45e13c0c064872';
const quote=x=>"'"+String(x).replaceAll("'","''")+"'";
const ident=x=>{assert.match(x,/^[a-z_][a-z0-9_]*$/);return '"'+x+'"';};
const hash=x=>createHash('sha256').update(x).digest('hex');
function sql(text,database=db){
  assert.ok([db,source,'postgres'].includes(database));
  try{return execFileSync('/opt/homebrew/bin/psql',['-h','/tmp/jesajang-auth-pg-socket','-p','58431','-U','postgres','-d',database,'-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'],{input:text,encoding:'utf8',maxBuffer:64*1024*1024,stdio:['pipe','pipe','pipe']}).trim();}
  catch(e){const state=String(e.stderr||'').match(/ERROR:\s+([A-Z0-9]{5})/)?.[1]||'unknown';throw Object.assign(new Error('격리 전환 SQL 실패: '+state),{sqlstate:state});}
}
const json=(text,database)=>JSON.parse(sql(text,database));
const save=(name,value)=>writeFileSync(new URL(name,out),JSON.stringify(value,null,2)+'\n');
const query=readFileSync(new URL('tools/schema-review-readonly.sql',repo),'utf8');
const snapshot=()=>json(query);
const production=JSON.parse(readFileSync(new URL('production-schema.json',out),'utf8'));
function structural(rows){return rows.filter(x=>!['environment','default_acl'].includes(x.kind)).map(x=>{
  const p={...x.payload}; delete p.estimated_rows;
  if(p.acl)p.acl=p.acl.slice(1,-1).split(',').sort();
  return {kind:x.kind,payload:p};
}).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));}
function comparable(rows){return structural(rows).map(x=>JSON.stringify(x)).sort();}
const tables=rows=>rows.filter(x=>x.kind==='relation'&&['r','p'].includes(x.payload.kind)).map(x=>x.payload.name).sort();
function contents(names,columns){return Object.fromEntries(names.map(name=>[name,{
  rows:Number(sql('select count(*) from public.'+ident(name))),
  hash:sql(`select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]')::text) from (select ${columns[name].map(ident).join(',')} from public.${ident(name)}) t`)
}]))}
const baselineColumns=Object.fromEntries(tables(production).map(t=>[t,production.filter(x=>x.kind==='column'&&x.payload.table===t).sort((a,b)=>a.payload.position-b.payload.position).map(x=>x.payload.name)]));
const files=readdirSync(new URL('supabase/migrations/',repo)).filter(x=>/^2026.*\.sql$/.test(x)).sort();
// 기존 첫 등록 SQL 자체의 트랜잭션은 파일 경계에서 하나로 감싼다.
// 함수 본문의 BEGIN은 세미콜론이 없으므로 이 독립 문장 제거 대상이 아니다.
function body(file){return readFileSync(new URL('supabase/migrations/'+file,repo),'utf8').replace(/^\s*(?:begin|commit);\s*$/gmi,'');}
const mode=process.argv[2];mkdirSync(out,{recursive:true});
if(mode==='prepare'){
  assert.equal(sql(`select count(*) from pg_database where datname=${quote(db)}`,'postgres'),'0','이미 존재하는 DB는 지우거나 다시 만들지 않습니다.');
  sql('create database '+ident(db),'postgres');
  sql(`create schema cutover_rehearsal; create table cutover_rehearsal.marker(reference text not null); insert into cutover_rehearsal.marker values(${quote(reference)});
    create table cutover_rehearsal.applied(file text primary key,sha256 text not null,elapsed_ms integer not null);
    grant usage on schema public to anon,authenticated,service_role;
    alter default privileges for role postgres in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges for role postgres in schema public grant all on sequences to anon,authenticated,service_role;
    alter default privileges for role postgres in schema public grant execute on functions to anon,authenticated,service_role;`);
  const baseline=readdirSync(new URL('supabase/migrations/',repo)).filter(x=>/^00\d\d_.*\.sql$/.test(x)).sort();
  for(const file of baseline){const code=execFileSync('git',['show',reference+':supabase/migrations/'+file],{cwd:repo,encoding:'utf8'});assert.equal(code,readFileSync(new URL('supabase/migrations/'+file,repo),'utf8'),file+' 원격/로컬 불일치');sql(code);}
}
if(mode==='prepare'||mode==='seed'){
  assert.equal(sql('select reference from cutover_rehearsal.marker'),reference);
  assert.equal(sql('select count(*) from cutover_rehearsal.applied'),'0','변경 적용 후 자료 재준비 금지');
  const before=snapshot();save('rehearsal-baseline-schema.json',before);
  const actual=comparable(before), expected=comparable(production);
  if(JSON.stringify(actual)!==JSON.stringify(expected)){save('baseline-mismatch.json',{onlyBaseline:actual.filter(x=>!expected.includes(x)),onlyProduction:expected.filter(x=>!actual.includes(x))});throw new Error('운영 구조와 재현 구조 불일치. 적용 단계는 실행하지 않습니다.');}
  // 알려진 격리 가짜 자료만 복사한다. 실제 운영 업무 행은 읽지 않는다.
  const edges=json("select coalesce(jsonb_agg(jsonb_build_object('child',conrelid::regclass::text,'parent',confrelid::regclass::text)),'[]') from pg_constraint where contype='f' and connamespace='public'::regnamespace");
  const ordered=[],visiting=new Set();
  function visit(table){if(ordered.includes(table))return;assert.ok(!visiting.has(table),'순환 참조는 별도 복원 설계 필요');visiting.add(table);for(const edge of edges.filter(e=>e.child===table))visit(edge.parent);visiting.delete(table);ordered.push(table);}
  tables(production).forEach(visit);
  const inserts=['begin;','truncate '+ordered.map(x=>'public.'+ident(x)).join(',')+' restart identity;'];
  for(const table of ordered){
    const cols=before.filter(x=>x.kind==='column'&&x.payload.table===table&&x.payload.generated==='').map(x=>x.payload.name);
    const data=sql(`select coalesce(jsonb_agg(to_jsonb(t)),'[]') from (select ${cols.map(ident).join(',')} from public.${ident(table)}) t`,source);
    inserts.push(`insert into public.${ident(table)} (${cols.map(ident).join(',')}) overriding system value select ${cols.map(ident).join(',')} from jsonb_populate_recordset(null::public.${ident(table)},${quote(data)}::jsonb);`);
  }
  inserts.push('commit;');sql(inserts.join('\n'));
  for(const c of before.filter(x=>x.kind==='column'&&x.payload.identity)){const p=c.payload;sql(`select setval(pg_get_serial_sequence(${quote('public.'+p.table)},${quote(p.name)}),coalesce((select max(${ident(p.name)}) from public.${ident(p.table)}),1),exists(select 1 from public.${ident(p.table)}));`);}
  const invariant=contents(tables(production),baselineColumns);save('before-content-hashes.json',invariant);
  save('rehearsal-prepare.json',{ok:true,reference,database:db,productionSchemaObjects:production.length,baselineFiles:40,publicStructureAndAclMatch:true,postgresDefaultPrivilegesReproduced:true,otherOwnerDefaultsReproduced:false,syntheticTables:Object.keys(invariant).length,syntheticRows:Object.values(invariant).reduce((n,x)=>n+x.rows,0),productionBusinessRowsRead:false});
  console.log('운영 public 구조/권한과 일치하는 별도 DB 준비 완료. 가짜 자료만 복사.');
}else if(mode==='apply'){
  assert.equal(sql('select reference from cutover_rehearsal.marker'),reference);
  const before=JSON.parse(readFileSync(new URL('before-content-hashes.json',out),'utf8'));
  const results=[];
  for(const file of files){
    const digest=hash(readFileSync(new URL('supabase/migrations/'+file,repo))),done=json(`select coalesce(jsonb_agg(to_jsonb(t)),'[]') from cutover_rehearsal.applied t where file=${quote(file)}`);
    if(done.length){assert.equal(done[0].sha256,digest,'적용된 파일 변경 금지');const previous=JSON.parse(readFileSync(new URL('rehearsal-migration-results.json',out),'utf8')).find(x=>x.file===file);assert.ok(previous,'이전 검증 근거 필요');results.push(previous);continue;}
    const code=body(file),beforeFailure=snapshot();
    let failure;
    try{sql(`begin; set local lock_timeout='500ms'; set local statement_timeout='5s';\n${code}\nselect 1/0; commit;`);}catch(e){failure=e.sqlstate;}
    assert.equal(failure,'22012','강제 오류까지 DDL이 실행되어야 함: '+file);
    assert.deepEqual(comparable(snapshot()),comparable(beforeFailure),'파일 내 실패 후 전체 구조 롤백: '+file);
    assert.deepEqual(contents(tables(production),baselineColumns),before,'실패 후 기존 자료 유지: '+file);
    const started=performance.now();
    sql(`begin; set local lock_timeout='500ms'; set local statement_timeout='5s';\n${code}\ninsert into cutover_rehearsal.applied values(${quote(file)},${quote(digest)},0); commit;`);
    const elapsedMs=Math.round(performance.now()-started);sql(`update cutover_rehearsal.applied set elapsed_ms=${elapsedMs} where file=${quote(file)}`);
    assert.deepEqual(contents(tables(production),baselineColumns),before,'정상 적용 후 기존 자료 유지: '+file);
    results.push({file,sha256:digest,elapsedMs,forcedFailure:'22012',structureRollback:true,originalContentsMatch:true});
    save('rehearsal-migration-results.json',results); console.log(file+' 적용/강제 실패 복구/기존 자료 보존 통과');
  }
  const after=snapshot();save('rehearsal-after-schema.json',after);
  const oldNames=new Set(production.filter(x=>x.kind==='relation').map(x=>x.payload.name));
  const newSequences=after.filter(x=>x.kind==='relation'&&x.payload.kind==='S'&&!oldNames.has(x.payload.name));
  const publicNewSequences=newSequences.filter(x=>/anon=|authenticated=/.test(x.payload.acl||''));
  const newFunctions=after.filter(x=>x.kind==='function'&&!production.some(y=>y.kind==='function'&&y.payload.name===x.payload.name&&y.payload.identity===x.payload.identity));
  const findings={newSequencesWithBrowserPrivileges:publicNewSequences.map(x=>({name:x.payload.name,acl:x.payload.acl})),newFunctionsWithBrowserExecute:newFunctions.filter(x=>x.payload.anon_execute||x.payload.authenticated_execute).map(x=>x.payload.name),allOriginalContentsMatch:true,filesApplied:results.length};
  save('rehearsal-findings.json',findings);console.log(JSON.stringify(findings,null,2));
}else throw new Error('prepare, seed 또는 apply만 허용합니다. 대상 DB 변경 옵션은 없습니다.');
