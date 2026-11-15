import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {seedEduReport,ER,today} from './helpers/edu-report-fixture.mjs';
import {ids,sql,PIN,jwt} from './helpers/local-db.mjs';
import {OWNER} from './helpers/education-fixture.mjs';
const base='http://127.0.0.1:58434',second='RS190004',otherDay='2026-10-01';
const scope=()=>({kind:'목사교',date:today()});
export function seedExcused(){
 seedEduReport();sql(`truncate edu_excused_changes restart identity;
 update attend_series set roster_key='목요사명자' where series_id='${ER.series}';
 update edu_roster set roster_key='목요사명자',affiliation=case when dept='24부서' then '가짜기획부' else affiliation end;
 update edu_roster_policy set roster_key='목요사명자';
 insert into edu_roster(roster_key,member_id,name,dept,affiliation,district,position,sort_order) values('목요사명자','9900000000201','가짜공무후보','24부서','가짜행서부','01','담당',20);
 insert into attend_series(series_id,title,roster_key) values('${second}','가짜 공유 교육','목요사명자');
 insert into attend_meetings(meeting_id,title,date) values('MT190004','가짜 화전단','${today()}');
 insert into education_delegations(scope_type,scope_id,nid,permissions,actor_nid) values
 ('series','${second}','${ids.admin}','{reports}','${OWNER}'),('series','${second}','${ids.evangel}','{attendance}','${OWNER}'),
 ('meeting','MT190004','${ids.evangel}','{attendance}','${OWNER}');
 insert into cohort_summary_log(cohort_id,kind,ref_id,date) values
 ('#excused','목사교','9900000000106','${today()}'),('#excused','화전단','9900000000201','${today()}'),
 ('#excused','목사교','9900000000201','${otherDay}'),('#jungjin','최종','MT-OTHER','${today()}');`);
}
async function api(action,data={},token){const r=await fetch(base+'/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...data,...(token?{_tk:token}:{})})});return{status:r.status,body:await r.json()};}
async function ok(action,data,token){const r=await api(action,data,token);assert.equal(r.status,200,action+': '+r.body.error);assert.ok(!r.body.error,action+': '+r.body.error);return r.body;}
async function deny(action,data,token){const r=await api(action,data,token);assert.ok(r.status>=400||r.body.error,action);return r;}
let writer,reader,member;
beforeEach(async()=>{seedExcused();[writer,reader,member]=await Promise.all([[ids.evangel,'테스트전도','전도부'],[ids.admin,'테스트교육','청년회'],[ids.member,'테스트교사','청년회']].map(async([memberId,name,dept])=>(await ok('verifyLogin',{memberId,name,dept,pin:PIN})).token));});
async function change(token=writer,extra={}){const d=await ok('getEduExcused',scope(),token),p={...scope(),revision:d.revision,people:d.people.filter(x=>!x.on).map(({memberId})=>({memberId})),reason:'가짜 공무 변경 확인',...extra},review=await ok('previewEduExcused',p,token);return{d,p,review};}
const logs=()=>sql("select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]'::jsonb) from cohort_summary_log x");
test('공유 교육의 명시 위임과 번호 가림을 확인하고 방 관리자/사칭/미로그인을 거절한다',async()=>{
 const d=await ok('getEduExcused',scope(),reader);assert.equal(d.canEdit,false);assert.equal(d.people.length,2);assert.equal(d.scopes.length,2);assert.ok(d.people.every(p=>p.memberId.startsWith('r_')));assert.ok(!JSON.stringify(d).includes('9900000000106'));
 const legacy=await ok('reportRoomsAdmin',{op:'excusedGet',...scope()},reader);assert.ok(legacy.people.every(p=>p.nid.startsWith('r_')&&p.nid===p.memberId));
 for(const token of [undefined,member])await deny('getEduExcused',scope(),token);
 await deny('getEduExcused',{...scope(),memberId:ids.admin},member);
 await deny('previewEduExcused',{...scope(),revision:d.revision,people:[],reason:'가짜'},reader);
 sql(`update education_delegations set revoked=true where nid='${ids.evangel}' and scope_id='${second}'`);
 await deny('getEduExcused',scope(),writer);
 const x=await ok('getEduExcused',{kind:'화전단',date:today()},writer);assert.equal(x.scopes.length,1);assert.equal(x.scopes[0].type,'meeting');assert.equal(x.canEdit,true);
});
test('검토·확인한 명단만 원자적으로 바꾸고 다른 날짜·교육과 출석 원본을 보존한다',async()=>{
 const attendance=sql('select md5(jsonb_agg(to_jsonb(r) order by id)::text) from attend_records r'),before=logs(),{p,review}=await change();
 assert.deepEqual(review.summary,{before:1,after:1,added:1,removed:1});await deny('applyEduExcused',{...p,review:review.review},writer);assert.equal(logs(),before);
 await deny('reportRoomsAdmin',{op:'excusedSet',...scope(),nids:[]},writer);assert.equal(logs(),before);
 const r=await ok('applyEduExcused',{...p,review:review.review,confirmed:true},writer);assert.equal(r.count,1);
 assert.equal(sql(`select ref_id from cohort_summary_log where cohort_id='#excused' and kind='목사교' and date='${today()}'`),'9900000000201');
 assert.equal(sql(`select count(*) from cohort_summary_log where not(cohort_id='#excused' and kind='목사교' and date='${today()}')`),'3');
 assert.equal(sql('select count(*) from edu_excused_changes'),'1');assert.equal(sql('select before_nids::text||after_nids::text from edu_excused_changes'),'{9900000000106}{9900000000201}');assert.equal(sql('select md5(jsonb_agg(to_jsonb(r) order by id)::text) from attend_records r'),attendance);assert.equal(sql('select count(*) from edu_delivery_log'),'0');
 await deny('applyEduExcused',{...p,review:review.review,confirmed:true},writer);
});
test('검토 뒤 선택·명단·권한·교육 범위가 바뀌거나 검토 내용을 바꾸면 저장을 거절한다',async()=>{
 for(const mutate of [()=>sql("update edu_roster set affiliation='가짜변경부' where member_id='9900000000201'"),()=>sql(`delete from cohort_summary_log where cohort_id='#excused' and kind='목사교' and date='${today()}'`),()=>sql(`update education_delegations set revoked=true where nid='${ids.evangel}' and scope_id='${second}'`),()=>sql("insert into attend_series(series_id,title,roster_key) values('RS190005','가짜 새 공유교육','목요사명자')")]){
  seedExcused();const {p,review}=await change();mutate();const before=logs();await deny('applyEduExcused',{...p,review:review.review,confirmed:true},writer);assert.equal(logs(),before);assert.equal(sql('select count(*) from edu_excused_changes'),'0');
 }
 seedExcused();const {p,review}=await change();await deny('applyEduExcused',{...p,people:[],review:review.review,confirmed:true},writer);
});
test('동시에 같은 변경/빈 명단을 저장하면 한 번만 반영한다',async()=>{
 for(const empty of [false,true]){seedExcused();if(empty)sql(`delete from cohort_summary_log where cohort_id='#excused' and kind='목사교' and date='${today()}'`);const {p,review}=await change(writer,empty?{people:[]}:{}),payload={...p,review:review.review,confirmed:true};const results=await Promise.all([api('applyEduExcused',payload,writer),api('applyEduExcused',payload,writer)]);assert.equal(results.filter(r=>r.status===200&&!r.body.error).length,1);assert.equal(sql('select count(*) from edu_excused_changes'),'1');}
});
test('삽입 중 오류가 나면 삭제와 이력도 되돌린다',async()=>{
 const {p,review}=await change(),before=logs();sql("create function public.fake_excused_failure() returns trigger language plpgsql as $$ begin if new.cohort_id='#excused' then raise exception 'fake failure'; end if; return new; end $$; create trigger fake_excused_failure before insert on public.cohort_summary_log for each row execute function public.fake_excused_failure();");
 try{await deny('applyEduExcused',{...p,review:review.review,confirmed:true},writer);assert.equal(logs(),before);assert.equal(sql('select count(*) from edu_excused_changes'),'0');}finally{sql('drop trigger fake_excused_failure on public.cohort_summary_log;drop function public.fake_excused_failure();');}
});
test('잘못된 날짜/명단·중복/미확인을 거절하고 DB 직접 공개 접근을 차단한다',async()=>{
 const {d,p}=await change();for(const date of ['2026-02-30','2026-2-01','bad'])await deny('getEduExcused',{kind:'목사교',date},writer);
 for(const people of [[{memberId:ids.member}],[{memberId:d.people[0].memberId},{memberId:d.people[0].memberId}],null])await deny('previewEduExcused',{...p,people},writer);
 for(const role of ['anon','authenticated']){
  const headers={authorization:'Bearer '+jwt(role),'content-type':'application/json'};
  for(const path of ['/edu_excused_changes?select=*','/rpc/edu_excused_state','/rpc/edu_excused_apply']){const r=await fetch('http://127.0.0.1:58432'+path,{headers,...(path.includes('/rpc/')?{method:'POST',body:JSON.stringify(path.endsWith('state')?{p_kind:'목사교',p_date:today()}:{p:{}})}:{})});assert.ok(r.status>=400,path);}
 }
});
test('1,000명 이후도 읽고 선택하며 중진 방은 지역 없는 특별 대상으로 연결한다',async()=>{
 sql("insert into edu_roster(roster_key,member_id,name,dept,sort_order) select '목요사명자',(9900023000000+i)::text,'가짜공무'||i,'24부서',100+i from generate_series(1,1005)i;");
 const d=await ok('getEduExcused',scope(),writer);assert.equal(d.people.length,1007);const p={...scope(),revision:d.revision,people:[{memberId:d.people.at(-1).memberId}],reason:'가짜 마지막 대상 확인'},v=await ok('previewEduExcused',p,writer);assert.equal((await ok('applyEduExcused',{...p,review:v.review,confirmed:true},writer)).count,1);
 const rooms=await ok('reportRoomsAdmin',{op:'list'},reader);assert.ok(rooms.specials.some(s=>s.key==='#중진'));
 const r=await ok('reportRoomsAdmin',{op:'set',dept:'#중진',region:'무시할지역',chatId:'-990234',requireReview:true,review:rooms.revision,confirmed:true},reader);assert.ok(r.rooms.some(s=>s.key==='#중진'));assert.ok(!r.rooms.some(s=>s.key.startsWith('#중진/')));
});
