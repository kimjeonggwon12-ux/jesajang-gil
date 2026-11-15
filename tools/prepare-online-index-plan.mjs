// 검토 자료 생성 전용. DB 접속·실행·기존 SQL 수정 기능은 없다.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const repo=fileURLToPath(new URL('../',import.meta.url));
const reviewed=path.resolve(repo,'../artifacts/release-prep-20261115');
export const indexNames=[
 'chat_messages_chat_id_idx','activities_owner_page_idx','activities_owner_target_page_idx',
 'attend_records_at_nid_idx','activities_owner_id_idx','activities_feedback_owner_idx','activities_nid_target_trim_id_idx',
];
export const sha256=value=>createHash('sha256').update(value).digest('hex');
const normalize=value=>String(value).replace(/\s+/g,' ').trim();

export function inspectIndexSql(index){
 assert.ok(indexNames.includes(index.name));
 const dependency=index.name==='activities_nid_target_trim_id_idx'?"to_regprocedure('public.app_trim(text)') is not null":'true';
 return `select json_build_object(
 'exists',c.oid is not null,'name',c.relname,'kind',c.relkind,'table',t.relname,
 'definition',case when i.indexrelid is not null then pg_get_indexdef(i.indexrelid) end,
 'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive,
 'constraintBacked',exists(select 1 from pg_constraint where conindid=c.oid),
 'building',exists(select 1 from pg_stat_progress_create_index where index_relid=c.oid),
 'dependencyReady',${dependency})
 from (select to_regclass('public.${index.name}') oid) x
 left join pg_class c on c.oid=x.oid left join pg_index i on i.indexrelid=c.oid
 left join pg_class t on t.oid=i.indrelid;`;
}
export function indexDecision(index,state){
 if(!state.dependencyReady)throw Error('dependency_missing: '+index.name);
 if(!state.exists)return 'create';
 if(state.kind!=='i'||state.table!==index.table||normalize(state.definition)!==normalize(index.expectedDefinition)||state.constraintBacked)
  throw Error('definition_mismatch: '+index.name);
 if(state.building)throw Error('build_in_progress: '+index.name);
 if(!state.valid||!state.ready||!state.live)throw Error('invalid_index: '+index.name);
 return 'skip_verified';
}
export function createOnlineIndexPlan(){
 const review=JSON.parse(readFileSync(path.join(reviewed,'migrations-review.json'),'utf8'));
 const diff=JSON.parse(readFileSync(path.join(reviewed,'schema-change-review.json'),'utf8'));
 const files=review.files.filter(f=>f.decision==='review-additional-after-approval');assert.equal(files.length,27);
 const found=new Set(),steps=[];
 for(const source of files){
  const original=readFileSync(path.join(repo,source.path),'utf8');assert.equal(sha256(original),source.sha256,'검토 이후 SQL 변경: '+source.path);
  let transactionSql=original;const indexes=[];
  for(const name of indexNames){
   const pattern=new RegExp('create index if not exists '+name+'\\s+on public\\.[\\s\\S]*?;','g');
   const matches=[...original.matchAll(pattern)];assert.ok(matches.length<=1);
   if(!matches.length)continue;
   assert.ok(!found.has(name));found.add(name);
   const match=matches[0][0],expected=diff.index.added.find(i=>i.name===name);assert.ok(expected&&!expected.unique);
   transactionSql=transactionSql.replace(match,'-- 검색 색인은 이 파일의 구조/함수 확정 후 별도 동시 생성 단계에서 처리한다.');
   const index={name,table:expected.table,expectedDefinition:expected.definition,
    sql:"set lock_timeout='500ms';\nset statement_timeout='30s';\n"+match.replace('create index if not exists','create index concurrently')+'\n',
    transaction:false,requires: name==='activities_nid_target_trim_id_idx'?['public.app_trim(text)']:[]};
   index.inspectSql=inspectIndexSql(index);indexes.push(index);
  }
  // 첫 파일의 자체 BEGIN/COMMIT은 한 겹만 유지한다.
  const hasTransaction=/^begin;/m.test(transactionSql);
  if(hasTransaction){assert.ok(/^commit;/m.test(transactionSql));transactionSql=transactionSql.replace(/^begin;/m,"begin;\nset local lock_timeout='500ms';\nset local statement_timeout='30s';");}
  else transactionSql="begin;\nset local lock_timeout='500ms';\nset local statement_timeout='30s';\n"+transactionSql+'\ncommit;\n';
  assert.ok(!/create index(?: if not exists)? (?:chat_messages_chat_id_idx|activities_owner_|activities_feedback_owner_idx|activities_nid_target_trim_id_idx|attend_records_at_nid_idx)/.test(transactionSql));
  steps.push({source:source.path,sourceSha256:source.sha256,transactionSql,transactionSha256:sha256(transactionSql),indexes});
 }
 assert.equal(found.size,7);
 return {version:1,executedOnProduction:false,baselineFilesNotToRerun:40,additionalFiles:27,
  concurrency:'one index at a time; autocommit; verify before and after; stop on failure; no automatic DROP or retry',
  steps};
}
export function writeOnlineIndexPlan(directory){
 assert.ok(!existsSync(directory),'기존 검토 자료 보존');mkdirSync(directory,{recursive:true});
 const plan=createOnlineIndexPlan();
 for(const [number,step]of plan.steps.entries()){
  const prefix=String(number+1).padStart(2,'0');
  step.transactionFile=prefix+'.transaction.review.sql';writeFileSync(path.join(directory,step.transactionFile),'-- 운영 실행 전 별도 승인 필요. plan.json의 순서를 따른다.\n'+step.transactionSql);
  for(const index of step.indexes){
   const base=prefix+'.'+index.name;index.file=base+'.concurrent.review.sql';index.inspectFile=base+'.inspect.sql';
   writeFileSync(path.join(directory,index.file),'-- 단독 실행 금지: 먼저 inspect 결과를 indexDecision으로 검증. BEGIN/COMMIT 또는 psql -1 사용 금지.\n'+index.sql);
   writeFileSync(path.join(directory,index.inspectFile),index.inspectSql+'\n');
  }
 }
 writeFileSync(path.join(directory,'plan.json'),JSON.stringify(plan,null,2)+'\n');return plan;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const out=path.resolve(repo,'../artifacts/index-hosting-fix-20261115/online-index-plan');
 const plan=writeOnlineIndexPlan(out);console.log(JSON.stringify({out,sourceFiles:plan.steps.length,concurrentIndexes:7,productionChanged:false}));
}
