import {seedEducation,OWNER} from './education-fixture.mjs';
import {sql,ids} from './local-db.mjs';
export const ER={series:'RS190001',meeting:'MT190001',previous:'MT190002',other:'MT190003',key:'가짜 사명자 재적'};
export const today=()=>new Date(Date.now()+9*3600e3).toISOString().slice(0,10);
export function seedEduReport(bulk=false){
 seedEducation();const day=today(),previous=new Date(Date.now()+9*3600e3-7*864e5).toISOString().slice(0,10);
 sql(`truncate edu_roster,edu_roster_policy,edu_delivery_log,report_rooms,cohort_summary_log restart identity;
 insert into attend_series(series_id,title,weekdays,slots,roster_key,summary_to) values('${ER.series}','가짜 목요 사명자 교육','[0,1,2,3,4,5,6]','[{"start":"09:00","end":"10:20"},{"start":"19:30","end":"20:49"}]','${ER.key}','live');
 insert into attend_meetings(meeting_id,title,date,start_time,end_time,slots,series_id) values
 ('${ER.meeting}','가짜 목요 사명자 교육','${day}','09:00','20:49','[{"start":"09:00","end":"10:20"},{"start":"19:30","end":"20:49"}]','${ER.series}'),
 ('${ER.previous}','가짜 지난 교육','${previous}','09:00','20:49','[{"start":"09:00","end":"10:20"},{"start":"19:30","end":"20:49"}]','${ER.series}'),
 ('${ER.other}','가짜 별개 조기 모임','${day}','07:00','08:00','[]','');
 insert into edu_roster(roster_key,member_id,name,dept,region,position,sort_order) values
 ('${ER.key}','${ids.member}','테스트교사','청년회','01지역','교사',1),
 ('${ER.key}','${ids.other}','테스트대상','청년회','02지역','교사',2),
 ('${ER.key}','9900000000101','가짜인정자','교회교역','교회','담당',3),
 ('${ER.key}','9900000000102','가짜신학담당','신학교역','신학','담당',4),
 ('${ER.key}','9900000000103','가짜제외자','신학교역','신학','원장',5),
 ('${ER.key}','9900000000104','가짜협력담당','장년회','01지역','담당',6),
 ('${ER.key}','9900000000105','가짜부녀담당','부녀회','01지역','담당',7),
 ('${ER.key}','9900000000106','가짜교육담당','24부서','교육','담당',8);
 insert into edu_roster_policy(roster_key,excluded_positions,always_present_nids,dept_overrides,source_note) values('${ER.key}','{원장}','{9900000000101}','{"9900000000104":"협력교회"}','가짜 운영 규칙');
 insert into attend_records(record_id,meeting_id,member_id,name,dept,position,at,late) values
 ('AT190001','${ER.meeting}','${ids.member}','테스트교사','청년회','교사','${day} 09:01:00','1분 지각'),
 ('AT190002','${ER.meeting}','9900000000901','테스트교사','청년회','교사','${day} 19:30:00','정상'),
 ('AT190003','${ER.meeting}','9900000000102','가짜신학담당','신학교역','담당','${day} 09:00:00','정상'),
 ('AT190004','${ER.meeting}','9900000000103','가짜제외자','신학교역','원장','${day} 09:00:00','정상'),
 ('AT190005','${ER.meeting}','9900000000105','가짜부녀담당','부녀회','담당','${day} 19:35:00','5분 지각'),
 ('AT190006','${ER.meeting}','9900000000199','가짜외부참석','청년회','일반','${day} 09:00:00','정상'),
 ('AT190007','${ER.other}','${ids.member}','테스트교사','청년회','교사','${day} 07:00:00','정상'),
 ('AT190008','${ER.previous}','${ids.member}','테스트교사','청년회','교사','${previous} 09:00:00','정상');
 insert into education_delegations(scope_type,scope_id,nid,permissions,actor_nid) values
 ('series','${ER.series}','${ids.admin}','{reports}','${OWNER}'),
 ('series','${ER.series}','${ids.evangel}','{attendance}','${OWNER}');
 insert into report_rooms(dept,chat_id,title,active) values
 ('#교육:${ER.series}','-990190','가짜 교육 보고방',true),('교역자','-990191','가짜 교역자 방',true),
 ('청년회','-990192','가짜 청년 전체 방',true),('청년회/01지역','-990193','가짜 청년 1지역',true),
 ('청년회/02지역','-990194','가짜 청년 2지역',true),('부녀회/01지역','-990195','가짜 부녀 1지역',true),
 ('청년회#총합','-990196','중복 제외 방',true),('부녀회/기타','-990197','기존 회장단 방',true);
 ${bulk?`insert into edu_roster(roster_key,member_id,name,dept,region,position,sort_order) select '${ER.key}',(9900019000000+i)::text,'가짜대량'||i,'청년회','03지역','담당',100+i from generate_series(1,1005)i;`:''}`);
}
