import {seed,sql,ids} from './local-db.mjs';
export function seedCoaching(){seed();sql(`begin;
 truncate feedbacks,target_ai_notes,target_history,targets,activities restart identity cascade;
 insert into admins(member_id,name,dept,position,region) values
 ('${ids.coach}','테스트교관','청년회','복음방교관','1지역'),('${ids.coach}','테스트교관','부녀회','복음방교관','2지역');
 update teachers set dept='부녀회',region='2지역' where member_id='${ids.other}';
 insert into teachers(member_id,name,dept,region,sort_order) values('9800000000011','가짜교차범위','청년회','2지역',30),('9800000000012','가짜다른부서','부녀회','1지역',31);
 insert into feedbacks(receipt_no,member_id,name,source,situation,status,submitted_at) select 'COACH-'||lpad(g::text,4,'0'),'${ids.member}','테스트교사','교관요청','가짜 요청 '||g,case when g=1 then '접수' else '완료' end,'2026-11-01'::timestamptz+g*interval '1 minute' from generate_series(1,1005)g;
 insert into feedbacks(receipt_no,member_id,name,source,situation,ai_coach_text,status,submitted_at) values
 ('AI-ESC','${ids.member}','테스트교사','사람에스컬레이션','가짜 AI 전달','전달할 가짜 AI 답','접수',now()),
 ('OTHER-ESC','${ids.other}','테스트대상','사람에스컬레이션','겸직 담당 요청','겸직 AI','접수',now()),
 ('CROSS-1','9800000000011','가짜교차범위','교관요청','교차 범위 요청','','접수',now()),
 ('CROSS-2','9800000000012','가짜다른부서','교관요청','다른 부서 요청','','접수',now());
 insert into targets(target_id,creator_id,target_name,gender,age_group,stage,goal_cohort) values('COACH-TARGET','${ids.member}','가짜대상','여','20대','상담2','2027-01'),('COACH-PRIVATE','${ids.other}','타인대상','남','40대','친분','2027-01');
 insert into target_ai_notes(target_id,member_id,kind,input,text,created_at) values('COACH-TARGET','${ids.member}','파악정보','관심사·취미','가짜 취미 기록',now());
 insert into activities(member_id,name,submitted_at,activities,roles,target_name,target_stage,today_work,next_work) values('${ids.member}','테스트교사','2026-11-12 09:00',array['상담1','만남1'],array['교사','인도자'],'가짜대상','상담2','가짜 누적 활동','가짜 계획');
 commit;`);}
