// 운영 접근 없음. tools/local-cutover-rehearsal.mjs가 만든 고정 DB 전용.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
const args=['-h','/tmp/jesajang-auth-pg-socket','-p','58431','-U','postgres','-d','jesajang_cutover_20261114','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'];
function sql(text){try{return execFileSync('/opt/homebrew/bin/psql',args,{input:text,encoding:'utf8',maxBuffer:8*1024*1024,stdio:['pipe','pipe','pipe']}).trim();}catch(e){throw Object.assign(new Error('격리 검증 실패'),{state:String(e.stderr||'').match(/ERROR:\s+([A-Z0-9]{5})/)?.[1]});}}
const json=text=>JSON.parse(sql(text)), q=x=>"'"+String(x).replaceAll("'","''")+"'";
const old=JSON.parse(readFileSync(new URL('../../artifacts/cross-check-schema-20261114/production-schema.json',import.meta.url),'utf8'));
const current=json(readFileSync(new URL('../tools/schema-review-readonly.sql',import.meta.url),'utf8'));
const oldRelations=new Set(old.filter(x=>x.kind==='relation').map(x=>x.payload.name));
const added=current.filter(x=>x.kind==='relation'&&!oldRelations.has(x.payload.name)).map(x=>x.payload);
const newFunctions=current.filter(x=>x.kind==='function'&&!old.some(y=>y.kind==='function'&&x.payload.name===y.payload.name&&x.payload.identity===y.payload.identity)).map(x=>x.payload);
assert.equal(sql('select reference from cutover_rehearsal.marker'),'0ea5ac7ea16a67b8ceb5b1848e45e13c0c064872');
test('운영 기본 권한을 재현하고 새 함수 39개를 서비스 역할로 한정',()=>{
  assert.equal(newFunctions.length,39);
  for(const f of newFunctions){assert.equal(f.anon_execute,false,f.name);assert.equal(f.authenticated_execute,false,f.name);assert.equal(f.service_execute,true,f.name);assert.equal(f.definer,false,f.name);}
});
test('새 업무 표 14개·뷰 2개는 브라우저 DB 역할에 비공개',()=>{
  const relations=added.filter(x=>['r','v'].includes(x.kind));assert.equal(relations.length,16);
  for(const t of relations){if(t.kind==='r')assert.equal(t.rls,true,t.name);
    for(const role of ['anon','authenticated'])assert.equal(sql(`select has_table_privilege(${q(role)},${q('public.'+t.name)},'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')`),'f',t.name+' '+role);
    assert.equal(sql(`select has_table_privilege('service_role',${q('public.'+t.name)},'SELECT')`),'t',t.name);
  }
});
test('새 번호 생성기 7개는 일반 역할 사용 거절·서버 사용 허용',()=>{
  const sequences=added.filter(x=>x.kind==='S');assert.equal(sequences.length,7);
  for(const s of sequences){
    for(const role of ['anon','authenticated']){
      assert.equal(sql(`select has_sequence_privilege(${q(role)},${q('public.'+s.name)},'USAGE,SELECT,UPDATE')`),'f',s.name);
      assert.throws(()=>sql(`begin;set local role ${role};select nextval(${q('public.'+s.name)});rollback;`),e=>e.state==='42501');
    }
    assert.ok(Number(sql(`begin;set local role service_role;select nextval(${q('public.'+s.name)});rollback;`))>0);
  }
});
test('기존 65개 표의 모든 원래 열과 행 내용 보존',()=>{
  const baseline=JSON.parse(readFileSync(new URL('../../artifacts/cross-check-schema-20261114/before-content-hashes.json',import.meta.url),'utf8'));
  for(const [name,expected] of Object.entries(baseline)){
    const cols=old.filter(x=>x.kind==='column'&&x.payload.table===name).sort((a,b)=>a.payload.position-b.payload.position).map(x=>'"'+x.payload.name+'"').join(',');
    assert.equal(Number(sql('select count(*) from public."'+name+'"')),expected.rows,name);
    assert.equal(sql(`select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]')::text) from (select ${cols} from public."${name}") t`),expected.hash,name);
  }
});
async function locked(table,mode,operation){
  const holder=spawn('/opt/homebrew/bin/psql',args,{stdio:['pipe','pipe','pipe']});let text='';
  const exited=new Promise(resolve=>holder.once('exit',resolve));
  try{
    await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('격리 잠금 획득 시간 초과')),3000);holder.stdout.on('data',chunk=>{text+=chunk;if(text.includes('LOCK_READY')){clearTimeout(timeout);resolve();}});holder.once('error',e=>{clearTimeout(timeout);reject(e);});holder.stdin.write(`begin;lock table public.${table} in ${mode} mode;\n\\echo LOCK_READY\n`);});
    const start=performance.now();assert.throws(()=>sql(`begin;set local lock_timeout='500ms';set local statement_timeout='3s';${operation};rollback;`),e=>e.state==='55P03');
    const elapsed=performance.now()-start;assert.ok(elapsed>=450&&elapsed<3000,'잠금 대기 제한 확인');
  }finally{holder.stdin.end('rollback;\n\\q\n');await exited;}
}
test('기존 조회와 충돌하는 열 추가는 짧게 중단하고 부분 구조를 남기지 않음',async()=>{
  await locked('targets','access share','alter table public.targets add column cutover_lock_probe boolean');
  assert.equal(sql("select count(*) from information_schema.columns where table_schema='public' and table_name='targets' and column_name='cutover_lock_probe'"),'0');
});
test('기존 쓰기와 충돌하는 일반 색인 생성은 중단하고 색인을 남기지 않음',async()=>{
  await locked('activities','row exclusive','create index cutover_index_probe on public.activities(nid)');
  assert.equal(sql("select to_regclass('public.cutover_index_probe') is null"),'t');
});
test('실행 시간 제한도 같은 변경 묶음의 앞선 저장을 취소',()=>{
  const before=sql('select to_jsonb(t)::text from public.center_approval_policy t');
  assert.throws(()=>sql("begin;set local statement_timeout='100ms';update public.center_approval_policy set version=version+1;select pg_sleep(1);commit;"),e=>e.state==='57014');
  assert.equal(sql('select to_jsonb(t)::text from public.center_approval_policy t'),before);
});
