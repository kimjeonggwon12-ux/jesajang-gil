// 이 프로세스의 시각만 바꾸고 실제 API handler + 고정 로컬 DB를 사용한다.
import {readFileSync} from 'node:fs';
import {seedAttendance,today} from './attendance-fixture.mjs';
import {sql,quote,ids,jwt,PIN} from './local-db.mjs';
const RealDate=Date;let clock=RealDate.now();
export function at(hm){clock=RealDate.parse(day+'T'+hm+':00+09:00');}
export const day=today(),MEETING='MT-SLOT-LOCAL';
globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
const runtime=JSON.parse(readFileSync(new URL('../../../.local-auth-20261111/runtime.json',import.meta.url),'utf8'));
for(const k of Object.keys(process.env))if(/SUPABASE|TELEGRAM|TEACHERSQUARE|ATT_BOT|R2_|GEMINI|VERCEL|AUTH_SIGNING/.test(k))delete process.env[k];
process.env.SUPABASE_URL='http://127.0.0.1:58433';
process.env.SUPABASE_SERVICE_ROLE_KEY=jwt('service_role');
process.env.AUTH_SIGNING_KEY=runtime.authSigningKey;
const originalFetch=globalThis.fetch;
export const blocked=[];
globalThis.fetch=async(input,init)=>{const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(u.hostname!=='127.0.0.1'||!['58432','58433'].includes(u.port)){blocked.push(u.origin);throw Error('외부 연결 차단');}return originalFetch(input,{...init,redirect:'error'});};
const {default:handler}=await import('../../api/index.js');
const {forgetRoster}=await import('../../server/actions/roster.js');
const {findMeeting}=await import('../../server/actions/attendance.js');
const {settled}=await import('../../server/lib/background.js');
export async function request(action,body={},token){let status=200,value;await handler({method:'POST',body:{action,...body,...(token?{_tk:token}:{})}},{setHeader(){},status(s){status=s;return this;},json(b){value=b;return this;},end(){}});await settled();return{status,body:value};}
export async function prepare(){
 at('09:00');seedAttendance();forgetRoster();
 sql(`insert into attend_meetings(meeting_id,title,date,start_time,end_time,open_before,slots,questions,org,district)
 values('${MEETING}','[TEST] 두 타임 출석','${day}','09:00','20:00',30,'[{"start":"09:00","end":"11:00"},{"start":"18:00","end":"20:00"}]','[{"id":"q1","label":"참석 방식","type":"text","required":true,"options":[]}]','청년','1');
 insert into education_delegations(scope_type,scope_id,nid,permissions,actor_nid) values('meeting','${MEETING}','${ids.admin}','{attendance,reports}','${ids.admin}');`);
 await findMeeting(MEETING,{fresh:true});
 const login=await request('verifyLogin',{memberId:ids.member,name:'테스트교사',dept:'청년회',pin:PIN});
 if(!login.body.token)throw Error('로컬 로그인 실패');
 return login.body.token;
}
export const body=(answer='오전 답변')=>({meetingId:MEETING,memberId:ids.member,name:'테스트교사',answers:{q1:answer}});
export {sql,quote,ids};
