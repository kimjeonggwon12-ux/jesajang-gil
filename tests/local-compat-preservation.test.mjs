// 호환 흐름을 끝낸 두 전용 가짜 DB의 원래 행을 읽기 전용 대조한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
function sql(text,which){assert.ok(['before','after'].includes(which));return execFileSync('/opt/homebrew/bin/psql',['-h','/tmp/jesajang-auth-pg-socket','-p','58431','-U','postgres','-d','jesajang_compat_'+which+'_20261114','-qAt','-v','ON_ERROR_STOP=1'],{input:'begin read only;set local statement_timeout=\'3s\';'+text+';rollback;',encoding:'utf8',maxBuffer:16*1024*1024,stdio:['pipe','pipe','pipe']}).trim();}
const json=(q,db)=>JSON.parse(sql(q,db)),ident=x=>{assert.match(x,/^[a-z_][a-z0-9_]*$/);return '"'+x+'"';};
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
test('업무 전환 뒤 기존 65표의 원래 행을 모두 유지하며 의도한 두 칸만 변경',()=>{
  for(const db of ['before','after'])assert.equal(sql('select reference from compat_local.marker',db),'0ea5ac7ea16a67b8ceb5b1848e45e13c0c064872');
  const columns=json("select jsonb_agg(jsonb_build_object('table',table_name,'column',column_name) order by table_name,ordinal_position) from information_schema.columns where table_schema='public'",'before');
  const keys=json("select jsonb_agg(jsonb_build_object('table',c.relname,'keys',(select jsonb_agg(a.attname order by u.i) from unnest(i.indkey) with ordinality u(n,i) join pg_attribute a on a.attrelid=c.oid and a.attnum=u.n))) from pg_index i join pg_class c on c.oid=i.indrelid where i.indisprimary and c.relnamespace='public'::regnamespace",'before');
  const tables=[...new Set(columns.map(x=>x.table))],checks=[],changes=[];assert.equal(tables.length,65);
  for(const table of tables){
    const fields=columns.filter(x=>x.table===table).map(x=>ident(x.column)).join(','),query=`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from (select ${fields} from public.${ident(table)}) t`;
    const before=json(query,'before'),after=json(query,'after'),pk=keys.find(x=>x.table===table)?.keys;
    if(before.length)assert.ok(pk?.length,table+' 기존 행 대조 키 필요');
    const projected=[];
    for(const row of before){
      const found=after.filter(x=>pk.every(k=>x[k]===row[k]));assert.equal(found.length,1,table+' 기존 행의 삭제/중복 없음');const actual=found[0];
      for(const key of Object.keys(row))if(JSON.stringify(row[key])!==JSON.stringify(actual[key])){
        const field=table+'.'+key;assert.ok(['targets.updated_at','target_room_members.last_read_id'].includes(field),field+' 예상 밖 변경');
        if(field==='target_room_members.last_read_id')assert.equal(actual[key],row[key]+1);else assert.ok(actual[key]&&(!row[key]||actual[key]>=row[key]));
        changes.push(field);actual[key]=row[key];
      }
      assert.ok(JSON.stringify(actual)===JSON.stringify(row),table+' 기존 내용 유지');projected.push(actual);
    }
    checks.push({table,originalRows:before.length,afterRows:after.length,originalHash:hash(before),preservedHash:hash(projected)});
  }
  assert.deepEqual(changes.sort(),['target_room_members.last_read_id','targets.updated_at']);
  writeFileSync(new URL('../../artifacts/cross-check-compat-20261114/original-record-preservation.json',import.meta.url),JSON.stringify({tables:checks.length,originalRows:checks.reduce((n,x)=>n+x.originalRows,0),allOriginalRowsPreserved:true,expectedChangedFields:changes,checks},null,2)+'\n');
});
