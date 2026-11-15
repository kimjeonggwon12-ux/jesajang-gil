// 지정된 가짜 DB의 조회 실행 계획만 저장한다. 운영 연결 옵션을 받지 않는다.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {sql,quote,jwt,ids} from '../tests/helpers/local-db.mjs';
process.env.SUPABASE_URL='http://127.0.0.1:58433';
process.env.SUPABASE_SERVICE_ROLE_KEY=jwt('service_role');
const originalFetch=globalThis.fetch;
let captured;
globalThis.fetch=async(input,init)=>{
 const url=new URL(typeof input==='string'?input:input.url);
 if(url.hostname!=='127.0.0.1'||url.port!=='58433')throw Error('Only local verification API allowed');
 if(/\/(personal|scope)_tier_facts$/.test(url.pathname))captured={name:url.pathname.split('/').at(-1),args:JSON.parse(init?.body||await input.clone().text())};
 return originalFetch(input,init);
};
const actions=await import('../server/actions/tiers.js');
const source=readFileSync('supabase/migrations/20261112080000_status_aggregates.sql','utf8');
const dir='../artifacts/status-20261112';mkdirSync(dir,{recursive:true});
const now=new Date('2026-11-12T07:00:10.234+09:00'),summaries=[];
for(const [label,method,body] of [
 ['personal','myTierStatusAt',{memberId:ids.member}],
 ['district','districtViewAt',{memberId:ids.member}],
 ['department-charts','districtReportAt',{dept:'청년회',analysis:true,analysisMonth:'2026-11'}],
 ['organization','orgSummaryAt',null],
]){
 captured=null;await actions[method](...(body?[body,now]:[now]));
 if(!captured)throw Error('Missing local RPC capture '+label);
 const {name,args}=captured;
 const begin=source.indexOf('function public.'+name+'('),start=source.indexOf('as $$',begin)+5,end=source.indexOf('$$;',start);
 const query=source.slice(start,end).replace(/\bp_\w+\b/g,key=>{
  if(!(key in args))throw Error('Missing parameter '+key);
  const value=args[key];
  return Array.isArray(value)?`array[${value.map(quote).join(',')}]::text[]`:typeof value==='object'?quote(JSON.stringify(value))+'::jsonb':quote(value)+'::text';
 });
 const result=JSON.parse(sql('explain (analyze,buffers,format json) '+query));
 writeFileSync(dir+'/'+label+'-plan.json',JSON.stringify(result,null,2));
 const nodes=[];
 function walk(p){nodes.push({node:p['Node Type'],relation:p['Relation Name'],index:p['Index Name'],rows:p['Actual Rows'],loops:p['Actual Loops']});(p.Plans||[]).forEach(walk);}
 walk(result[0].Plan);
 summaries.push({label,executionMs:result[0]['Execution Time'],sharedHits:result[0].Plan['Shared Hit Blocks'],tempWritten:result[0].Plan['Temp Written Blocks'],nodes});
}
writeFileSync(dir+'/plans-summary.json',JSON.stringify(summaries,null,2));
console.log(JSON.stringify(summaries.map(({nodes,...s})=>s),null,2));
