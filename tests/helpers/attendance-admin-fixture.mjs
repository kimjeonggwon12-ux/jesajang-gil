import {seedEducation,OWNER,A} from './education-fixture.mjs';
import {sql,ids} from './local-db.mjs';
export {OWNER};
export const AD={morning:'MT150001',morning2:'MT150002',evening:'MT150003',foreign:'MT150004',done:'MT150005',course:'MT150006',series:'RS150001',seriesPast:'MT150007',seriesToday:'MT150008',seriesDone:'MT150009',seriesFuture:'MT150010'};
export const day=(offset=0)=>new Date(Date.now()+9*3600e3+offset*864e5).toISOString().slice(0,10);
export function seedAttendanceAdmin(bulk=false){
 seedEducation();
 sql(`truncate attend_meetings,attend_series,attend_records,attend_notify_queue restart identity;
 insert into attend_meetings(meeting_id,title,date,start_time,end_time,org,district,ask_district,ask_dept,questions,status,cohort_id) values
 ('${AD.morning}','가짜 오전 모임','${day()}','09:00','10:00','청년','1',true,true,'[{"id":"q1","label":"방법","type":"choice","options":["현장","온라인"],"required":true}]','열림',''),
 ('${AD.morning2}','가짜 오전 두번째','${day()}','10:00','11:00','청년','1',false,false,'[]','열림',''),
 ('${AD.evening}','가짜 저녁 모임','${day()}','19:00','23:59','청년','1',false,false,'[]','열림',''),
 ('${AD.foreign}','가짜 다른 범위','${day()}','08:00','08:30','부녀','2',false,false,'[]','열림',''),
 ('${AD.done}','[TEST] 집계 완료','${day(-1)}','09:00','10:00','청년','1',false,false,'[]','집계완료',''),
 ('${AD.course}','[TEST] 과정 모임','${day(-2)}','09:00','10:00','청년','1',false,false,'[]','열림','${A}');
 insert into attend_series(series_id,title,weekdays,slots,org,district) values ('${AD.series}','[TEST] 반복 교육','[0,1,2,3,4,5,6]','[{"start":"09:00","end":"10:00"},{"start":"19:00","end":"20:00"}]','청년','1');
 insert into attend_meetings(meeting_id,title,date,start_time,end_time,status,series_id) values
 ('${AD.seriesPast}','[TEST] 반복 지난날','${day(-1)}','09:00','20:00','열림','${AD.series}'),
 ('${AD.seriesToday}','[TEST] 반복 오늘','${day()}','09:00','20:00','열림','${AD.series}'),
 ('${AD.seriesDone}','[TEST] 반복 완료','${day(1)}','09:00','20:00','집계완료','${AD.series}'),
 ('${AD.seriesFuture}','[TEST] 반복 미래','${day(2)}','09:00','20:00','열림','${AD.series}');
 insert into attend_records(record_id,meeting_id,member_id,name,dept,position,at,late,answers,pick_org,pick_district,dept24) values
 ('AT150001','${AD.morning}','${ids.member}','테스트교사','청년회','교사','${day()} 09:01:00','1분 지각','{"q1":"현장"}','청년','1','교육부'),
 ('AT150002','${AD.morning2}','${ids.member}','테스트교사','청년회','교사','${day()} 10:00:00','정상','{}','청년','1',''),
 ('AT150003','${AD.evening}','${ids.member}','테스트교사','청년회','교사','${day()} 19:00:00','정상','{}','청년','1',''),
 ('AT150004','${AD.evening}','${ids.other}','테스트대상','청년회','교사','${day()} 19:05:00','5분 지각','{}','청년','2',''),
 ('AT150005','${AD.foreign}','${ids.other}','비공개범위','부녀회','교사','${day()} 08:00:00','정상','{}','부녀','2',''),
 ('AT150006','${AD.seriesPast}','${ids.member}','테스트교사','청년회','교사','${day(-1)} 09:00:00','정상','{}','청년','1','');
 insert into education_delegations(scope_type,scope_id,nid,permissions,actor_nid) values
 ('meeting','${AD.morning}','${ids.admin}','{attendance}','${OWNER}'),
 ('meeting','${AD.morning2}','${ids.admin}','{reports}','${OWNER}'),
 ('series','${AD.series}','${ids.admin}','{attendance,reports}','${OWNER}'),
 ('meeting','${AD.morning}','${ids.evangel}','{reports}','${OWNER}'),
 ('meeting','${AD.morning2}','${ids.evangel}','{reports}','${OWNER}'),
 ('meeting','${AD.evening}','${ids.evangel}','{reports}','${OWNER}');
 ${bulk?`insert into attend_series(series_id,title) select 'RS15B'||i,'[TEST] 대량 반복 '||i from generate_series(1,1005)i;
 insert into attend_meetings(meeting_id,title,date,series_id) select 'MT15B'||i,'[TEST] 대량 모임 '||i,('${day(3)}'::date+(i-1))::text,'${AD.series}' from generate_series(1,1005)i;
 insert into attend_records(record_id,meeting_id,member_id,name,at) select 'AT15B'||i,'MT15B'||(1006-i),'${ids.member}','대량 가짜교사','${day()} 09:00:00'::timestamp from generate_series(1,1005)i;`:''}`);
}
