import {seedEducation,OWNER,A,B,MA,MB,FREE} from './education-fixture.mjs';
import {sql,ids} from './local-db.mjs';
export {OWNER,A,B,MA,MB,FREE};
export const today=new Date(Date.now()+9*3600e3).toISOString().slice(0,10);
export const day=n=>new Date(Date.parse(today+'T00:00:00Z')+n*864e5).toISOString().slice(0,10);
export function seedCohortUi(big=false){seedEducation();sql(`
 update cohorts set start_date='${day(-2)}',end_date='${day(4)}',days='월화수목금토일',host_dept='가짜 교육부',manager_name='가짜담당',manager_phone='010-0000-0016',tg_chat='';
 update attend_meetings set date='${today}',start_time='09:00',end_time='18:00';
 update attend_records set at='${today} 09:00:00';
 insert into cohort_members(cohort_id,member_id,name,church,seq) values('${A}','${ids.other}','테스트대상','가짜 다른부서',2);
 insert into attend_meetings(meeting_id,title,date,start_time,end_time,status,cohort_id) values('MT160001','가짜 지난 수업','${day(-1)}','09:00','18:00','집계완료','${A}'),('MT160002','가짜 추가 수업','${today}','14:00','18:00','열림','${A}');
 insert into attend_records(record_id,meeting_id,member_id,name,at,late) values('AT160001','MT160001','${ids.member}','테스트교사','${day(-1)} 09:00:00','15:00부터 결석'),('AT160002','MT160002','${ids.member}','테스트교사','${today} 14:00:00','');
 insert into cohort_schedule(item_id,cohort_id,date,start_time,end_time,title,sub,kind) values('SC160001','${A}','${day(-1)}','09:00','10:00','가짜 오전 교육','가짜강사','교육'),('SC160002','${A}','${day(-1)}','15:00','16:00','가짜 오후 교육','','교육'),('SC160003','${A}','${today}','09:00','10:00','가짜 오늘 교육','가짜강사','교육'),('SC160004','${A}','${today}','','','가짜 주간 안내','','주간메모'),('SC160005','${B}','${today}','09:00','10:00','다른 범위 일정','','교육');
 insert into education_delegations(scope_type,scope_id,nid,permissions,actor_nid) values('cohort','${A}','${ids.admin}','{members,schedule,attendance}','${OWNER}'),('cohort','${A}','${ids.evangel}','{settings,reports}','${OWNER}');
 insert into admins(member_id,name,dept,position) values('${ids.coach}','테스트교관','청년회','교관');
 `);if(big)sql(`
 insert into cohort_members(cohort_id,member_id,name,church,seq) select '${B}',(9916000000000+n)::text,'가짜대량'||n,'가짜부서',n+1 from generate_series(1,1005)n;
 insert into attend_meetings(meeting_id,title,date,start_time,end_time,cohort_id) select 'MT16B'||n,'가짜대량수업'||n,'${day(-1)}','09:00','10:00','${B}' from generate_series(1,1005)n;
 insert into attend_records(record_id,meeting_id,member_id,name,at) select 'AT16B'||n,'MT16B'||n,'${ids.other}','테스트대상','${day(-1)} 09:00:00' from generate_series(1,1005)n;
 insert into cohort_schedule(item_id,cohort_id,date,start_time,end_time,title,kind) select 'SC16B'||n,'${B}','${today}','10:00','11:00','가짜대량일정'||n,'교육' from generate_series(1,1005)n;
 `);}
