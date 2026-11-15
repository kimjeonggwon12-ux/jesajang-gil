// 실제 handler/DB와 가짜 Telegram 응답만 사용한다. 운영 자격·외부 연결 금지.
import assert from 'node:assert/strict';
import {jwt,sql,ids} from './local-db.mjs';
import {seedEducation,A,MA,FREE} from './education-fixture.mjs';
const RealDate=Date, day=new RealDate().toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'});
let clock=RealDate.parse(day+'T13:00:00+09:00');
globalThis.Date=class extends RealDate{constructor(...a){super(...(a.length?a:[clock]));}static now(){return clock;}};
export const atInstant=value=>{clock=RealDate.parse(value);assert.ok(Number.isFinite(clock));};
export const at=hm=>{clock=RealDate.parse(day+'T'+hm+':00+09:00');};
for(const k of Object.keys(process.env))if(/SUPABASE|TEACHERSQUARE|TELEGRAM|ATT_|BOT_TOKEN|R2_|GEMINI|VERCEL|AUTH_SIGNING/.test(k))delete process.env[k];
Object.assign(process.env,{SUPABASE_URL:'http://127.0.0.1:58433',SUPABASE_SERVICE_ROLE_KEY:jwt('service_role'),ATT_BOT_TOKEN:'990123:local-only',ATT_ADMIN_CHAT:'-990000',TEACHERSQUARE_CRON_KEY:'local-only-delivery-key'});
const originalFetch=fetch;
export const calls=[],blocked=[];let fault=()=>'';
export const setFault=fn=>{fault=fn;};
globalThis.fetch=async(input,init={})=>{
 const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);
 if(u.origin==='https://api.telegram.org'){
  assert.ok(u.pathname.startsWith('/bot990123:local-only/'));
  const b=init.body instanceof FormData?Object.fromEntries(init.body):JSON.parse(init.body||'{}');
  assert.match(String(b.chat_id),/^-?990\d+$/);
  const c={method:u.pathname.split('/').at(-1),chat:String(b.chat_id),text:String(b.text||b.caption||'')};calls.push(c);
  const f=fault(c,calls.length);if(f==='network')throw Error('가짜 전송 응답 중단');
  if(f==='invalid')return new Response('invalid');
  if(f==='reject')return Response.json({ok:false,description:'가짜 거절'},{status:400});
  return Response.json({ok:true,result:{message_id:calls.length}});
 }
 if(u.hostname!=='127.0.0.1'||!['58432','58433','58434'].includes(u.port)){blocked.push(u.origin);throw Error('외부 연결 차단');}
 return originalFetch(input,{...init,redirect:'error'});
};
export async function prepare(){
 at('13:00');seedEducation();calls.length=0;blocked.length=0;fault=()=>'';
 delete process.env.TEACHERSQUARE_BOT_TOKEN;delete process.env.TEACHERSQUARE_CHAT_ID;
 sql(`truncate edu_delivery_log,cohort_summary_log,report_rooms;update cohorts set status='중지' where cohort_id<>'${A}';update cohorts set start_date='${day}',end_date='${day}',use_attend=true,use_assign=true where cohort_id='${A}';update attend_meetings set date='${day}',start_time='00:00',end_time='00:01',status='열림' where meeting_id='${MA}';update cohort_assignments set due='${day}',due_time='00:01',repeat='한번' where cohort_id='${A}';update cohort_exams set date='${day}',due_time='00:01' where cohort_id='${A}';`);
 const {forgetRoster}=await import('../../server/actions/roster.js');forgetRoster();
}
export const update=(id=99001,text='방번호')=>({update_id:id,message:{message_id:id,chat:{id:-990001,type:'supergroup'},from:{id:990202,first_name:'가짜학생'},text}});
export async function webhook(body,secret){
 const {default:handler}=await import('../../api/tg.js'),{webhookSecret}=await import('../../server/actions/cohort-bot.js');let status=200,value;
 await handler({method:'POST',headers:{'x-telegram-bot-api-secret-token':secret??webhookSecret()},body},{status(s){status=s;return this;},json(b){value=b;return this;}});
 return{status,body:value};
}
export {day,sql,ids,A,MA,FREE};
