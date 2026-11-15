// 지정된 격리 DB에서만 실행 계획을 저장한다. 운영 연결 옵션은 받지 않는다.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {sql,quote,jwt,ids} from '../tests/helpers/local-db.mjs';
process.env.SUPABASE_URL='http://127.0.0.1:58433';process.env.SUPABASE_SERVICE_ROLE_KEY=jwt('service_role');
const originalFetch=globalThis.fetch;let reportArgs;
globalThis.fetch=async(input,init)=>{
 const url=new URL(typeof input==='string'?input:input.url);
 if(url.hostname!=='127.0.0.1'||url.port!=='58433')throw Error('Only local verification API allowed');
 if(url.pathname.endsWith('/teacher_report_facts'))reportArgs=JSON.parse(init?.body||await input.clone().text());
 return originalFetch(input,init);
};
const {teacherListReportAt}=await import('../server/actions/tiers.js');await teacherListReportAt(new Date('2026-11-12T06:30:12.345+09:00'));
const src=readFileSync('supabase/migrations/20261112070000_report_aggregates.sql','utf8')+readFileSync('supabase/migrations/20261112071000_activity_overview.sql','utf8');
const dir='../artifacts/db-aggregates-20261112';mkdirSync(dir,{recursive:true});const summaries=[];
function plan(name,args,label=name){
 const begin=src.indexOf('function public.'+name+'('),start=src.indexOf('as $$',begin)+5,end=src.indexOf('$$;',start);
 const body=src.slice(start,end).replace(/\bp_\w+\b/g,key=>{if(!(key in args))throw Error('Missing local parameter '+key);return args[key];});
 const result=JSON.parse(sql('explain (analyze,buffers,format json) '+body));writeFileSync(dir+'/'+label+'-plan.json',JSON.stringify(result,null,2));
 const nodes=[];function walk(p){nodes.push({node:p['Node Type'],relation:p['Relation Name'],index:p['Index Name'],rows:p['Actual Rows'],loops:p['Actual Loops']});(p.Plans||[]).forEach(walk);}walk(result[0].Plan);
 summaries.push({label,executionMs:result[0]['Execution Time'],sharedHits:result[0].Plan['Shared Hit Blocks'],tempWritten:result[0].Plan['Temp Written Blocks'],nodes});
}
plan('teacher_report_facts',Object.fromEntries(Object.entries(reportArgs).map(([k,v])=>[k,Array.isArray(v)?`array[${v.map(quote).join(',')}]::text[]`:quote(JSON.stringify(v))+'::jsonb'])));
plan('my_activity_overview',{p_nid:quote(ids.member),p_year:'2026',p_edu:"array['상담1','상담2','복음방']::text[]"});
for(const feedback of [false,true])plan('my_activity_detail_page',{p_nid:quote(ids.member),p_query:"''::text",p_target:quote('가짜대상'),p_page:'1',p_limit:'20',p_through:'null::bigint',p_feedback:String(feedback)},feedback?'feedback-page':'report-page');
writeFileSync(dir+'/plans-summary.json',JSON.stringify(summaries,null,2));console.log(JSON.stringify(summaries.map(({nodes,...s})=>s)));
