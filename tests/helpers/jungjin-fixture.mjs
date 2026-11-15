import {seedEduReport,ER,today} from './edu-report-fixture.mjs';
import {sql,ids} from './local-db.mjs';
import {OWNER} from './education-fixture.mjs';
export {ER,today};
export function seedJungjin(){
 seedEduReport();sql(`update attend_series set roster_key='목요사명자' where series_id='${ER.series}';
 update edu_roster set roster_key='목요사명자';update edu_roster_policy set roster_key='목요사명자';
 update edu_roster set affiliation='가짜기획부',district='01' where member_id='9900000000106';
 insert into edu_roster(roster_key,member_id,name,dept,affiliation,district,position,sort_order) values
 ('목요사명자','9900000000201','가짜참석','24부서','가짜행서부','02','담당',10),
 ('목요사명자','9900000000202','가짜저녁','24부서','가짜행서부','02','담당',11),
 ('목요사명자','9900000000203','가짜불참','24부서','가짜기획부','01','담당',12);
 insert into attend_records(record_id,meeting_id,member_id,name,dept,position,at,late) values
 ('AT193001','${ER.meeting}','9900000000201','가짜참석','24부서','담당','${today()} 09:02:00','2분 지각'),
 ('AT193002','${ER.meeting}','9900000000202','가짜저녁','24부서','담당','${today()} 19:30:00','정상');
 insert into cohort_summary_log(cohort_id,kind,ref_id,date) values('#excused','목사교','9900000000106','${today()}'),('#excused','목사교','9900000000201','${today()}');
 insert into report_rooms(dept,chat_id,title,active) values('#중진','-990301','가짜 중진 대화방',true);
 insert into attend_meetings(meeting_id,title,date,slots) values('MT193001','가짜 화요전도단','${today()}','[{"start":"09:00","end":"10:20"}]');
 insert into education_delegations(scope_type,scope_id,nid,permissions,actor_nid) values('meeting','MT193001','${ids.admin}','{reports}','${OWNER}');`);
}
