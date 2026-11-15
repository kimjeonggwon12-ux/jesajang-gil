import {readFileSync} from 'node:fs';
import {seed,sql,ids} from './local-db.mjs';
// 제품의 기존 앱 관리자 판정을 검증하되 인물 정보·실제 PIN은 사용하지 않는다.
export const OWNER=readFileSync(new URL('../../server/actions/roster.js',import.meta.url),'utf8').match(/const OWNER_NID = '([0-9]+)'/)[1];
export const A='CH990001', B='CH990002', MA='MT990001', MB='MT990002', FREE='MT990003', SERIES='RS990001';
export function seedEducation() {
  seed();
  sql(`truncate telegram_update_receipts,education_delegations,education_access_events,education_telegram_links,education_telegram_challenges,cohorts,cohort_members,cohort_assignments,cohort_exams,cohort_scores,cohort_submissions,cohort_schedule,cohort_tg_chats,cohort_tg_links,attend_meetings,attend_records,attend_series restart identity;
  insert into teachers(member_id,name,dept,region) values('${OWNER}','테스트앱관리','청년회','1지역');
  insert into member_pins(nid,pin_hash,salt,ver) select '${OWNER}',pin_hash,salt,'education-owner' from member_pins where nid='${ids.member}';
  insert into cohorts(cohort_id,title,start_date,end_date,start_time,end_time,tg_chat) values('${A}','가짜 교육 A','2026-11-01','2026-11-30','09:00','18:00','-990001'),('${B}','가짜 교육 B','2026-11-01','2026-11-30','09:00','18:00','-990002');
  insert into cohort_members(cohort_id,member_id,name,church,seq) values('${A}','${ids.member}','테스트교사','가짜부서',1),('${B}','${ids.other}','테스트대상','가짜부서',1);
  insert into cohort_assignments(assignment_id,cohort_id,title) values('AS990001','${A}','가짜 과제 A'),('AS990002','${B}','가짜 과제 B');
  insert into cohort_exams(exam_id,cohort_id,subject,date) values('EX990001','${A}','가짜시험','2026-11-12'),('EX990002','${B}','가짜시험','2026-11-12');
  insert into attend_series(series_id,title,weekdays,slots) values('${SERIES}','가짜 정기교육','[1,2,3,4,5,6,0]','[{"start":"09:00","end":"18:00"}]');
  insert into attend_meetings(meeting_id,title,date,cohort_id,series_id) values('${MA}','가짜 A 출석','2026-11-12','${A}',''),('${MB}','가짜 B 출석','2026-11-12','${B}',''),('${FREE}','가짜 단독출석','2026-11-12','',''),('MT990004','가짜 정기출석','2026-11-12','','${SERIES}');
  insert into attend_records(record_id,meeting_id,member_id,name) values('AT990001','${MA}','${ids.member}','테스트교사'),('AT990002','${MB}','${ids.other}','테스트대상');`);
}
