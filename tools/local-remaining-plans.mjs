// 가짜 DB에만 연결하며 RPC 실행 계획과 대상자 본문 첫 페이지를 측정한다.
import {readFileSync,writeFileSync} from 'node:fs';
import {sql,quote,jwt,ids} from '../tests/helpers/local-db.mjs';
process.env.SUPABASE_URL='http://127.0.0.1:58433';process.env.SUPABASE_SERVICE_ROLE_KEY=jwt('service_role');
const originalFetch=globalThis.fetch,captured=new Map();
globalThis.fetch=async(input,init)=>{
 const u=new URL(typeof input==='string'?input:input.url);
 if(u.hostname!=='127.0.0.1'||u.port!=='58433')throw Error('Only local verification API allowed');
 if(u.pathname.includes('/rpc/'))captured.set(u.pathname.split('/').at(-1),JSON.parse(init?.body||await input.clone().text()));
 return originalFetch(input,init);
};
const tiers=(await import('../server/actions/tiers.js')).default,targets=await import('../server/actions/targets.js');
await tiers.getSettlementReport({asOf:'2026-11-12'});await tiers.getNonParticipants({});
await targets.default.getActivityItemDistribution({});await targets.default.getTargetStageDistribution({role:'교사'});
const target=JSON.parse(sql("select row_to_json(t) from targets t where target_id='LIST-1'"));await targets.targetDossier(target,ids.member);
const source=readFileSync('supabase/migrations/20261112080001_remaining_read_optimization.sql','utf8');
const directory='../artifacts/remaining-20261112',summaries=[];
function explain(name,body) {
 const plan=JSON.parse(sql('explain(analyze,buffers,format json) '+body));writeFileSync(directory+'/'+name+'-plan.json',JSON.stringify(plan,null,2));
 const nodes=[];function walk(n){nodes.push({node:n['Node Type'],relation:n['Relation Name'],index:n['Index Name'],rows:n['Actual Rows'],loops:n['Actual Loops']});(n.Plans||[]).forEach(walk);}walk(plan[0].Plan);
 summaries.push({name,executionMs:plan[0]['Execution Time'],tempWritten:plan[0].Plan['Temp Written Blocks'],sharedHits:plan[0].Plan['Shared Hit Blocks'],nodes});
}
for(const [name,args]of captured){
 const start=source.indexOf('function public.'+name+'(');if(start<0)continue;
 const middle=source.indexOf('as $$',start)+5,end=source.indexOf('$$;',middle);
 const types=Object.fromEntries([...source.slice(start,middle).matchAll(/\b(p_\w+)\s+(text\[\]|text|boolean|integer|bigint|timestamp|jsonb)/g)].map(m=>[m[1],m[2]]));
 const body=source.slice(middle,end).replace(/\bp_\w+\b/g,key=>{
  const v=args[key];if(!(key in args))throw Error('Missing parameter '+key);
  return (v===null?'null':Array.isArray(v)?`array[${v.map(quote).join(',')}]`:quote(typeof v==='object'?JSON.stringify(v):v))+'::'+types[key];
 });explain(name,body);
}
explain('dossier-activity-page',`select * from public.target_dossier_activities where nid=${quote(ids.member)} and target_key='가짜대상' order by submitted_at desc nulls first,id desc limit 100`);
writeFileSync(directory+'/plans-summary.json',JSON.stringify(summaries,null,2));console.log(JSON.stringify(summaries.map(({nodes,...s})=>s),null,2));
