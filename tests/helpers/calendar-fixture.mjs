import {seed,sql,ids} from './local-db.mjs';
export function seedCalendar(){
  seed();
  sql(`begin;
    truncate calendar_events,calendar_weeks,event_staff,event_attendees,event_cheers,calendar_ads,ad_questions,alert_log restart identity;
    update teachers set position='지역장' where member_id='${ids.coach}';
    insert into calendar_events(event_id,type,title,start_date,end_date,dept,region,category,created_by,created_at,host_dept,contact_name,contact_phone,description) values
    ('CAL-EVENT','행사','가짜 가을 행사','2026-11-15','2026-11-15','','','공식','${ids.evangel}',now(),'전도부','테스트전도','010-0000-0003','가짜 행사 안내'),
    ('CAL-COURSE','개강','가짜 개강','2026-11-21','2026-11-21','','','공식','${ids.evangel}',now(),'전도부','테스트전도','010-0000-0003',''),
    ('CAL-YOUTH','부서','가짜 청년 일정','2026-11-15','2026-11-17','청','01지역','부서','${ids.coach}',now(),'청년회','테스트교관','010-0000-0004',''),
    ('CAL-WOMEN','부서','가짜 부녀 일정','2026-11-15','2026-11-15','부','01지역','부서','${ids.evangel}',now(),'부녀회','테스트전도','010-0000-0003',''),
    ('CAL-PRIVATE','내일정','가짜 내 비공개 일정','2026-11-14','2026-11-14','','','내일정','${ids.member}',now(),'','','','개인 메모'),
    ('CAL-OTHER','내일정','다른 사람 비공개 일정','2026-11-14','2026-11-14','','','내일정','${ids.other}',now(),'','','','다른 개인 메모'),
    ('CAL-OLD','행사','가짜 지난 행사','2026-01-01','2026-01-01','','','공식','${ids.evangel}','2026-01-01','','','','');
    insert into calendar_events(event_id,type,title,start_date,end_date,dept,region,category,created_by,repeat_days,repeat_until) values
    ('CAL-REPEAT','부서','가짜 반복 일정','2026-11-01','2026-11-01','청','1지역','부서','${ids.coach}',ARRAY[0,3],'2026-12-31');
    insert into calendar_weeks(week_start,theme,memo,updated_by,updated_at) values('2026-11-08','가짜 종전 주간','이전 형식 메모','테스트교육',now());
    insert into event_staff(signup_id,event_id,member_id,name,dept,note,applied_at) values('ST-SEED','CAL-EVENT','${ids.other}','테스트대상','청','가짜 기능',now());
    insert into event_attendees(signup_id,event_id,applicant_id,applicant_name,applicant_dept,applicant_role,guest_name,guest_dept,guest_age,guest_stage,applied_at)
    select 'AT-SEED-'||g,'CAL-EVENT','${ids.other}','테스트대상',case when g%2=0 then '청' else '부' end,'교','가짜 참석자 '||g,'청','30','친분',now() from generate_series(1,1005)g;
    insert into calendar_ads(ad_id,title,body,sort_no,updated_at,end_date) values
    ('AD-ACTIVE','가짜 안내 공지','새 일정에 관해 질문을 남길 수 있어요.',1,now(),null),
    ('AD-EXPIRED','가짜 지난 공지','종료된 공지',2,now(),'2000-01-01'),
    ('AD-DATE','1월 5일 가짜 공지','제목 날짜 기준',3,'2026-12-20',null);
    insert into ad_questions(question_id,ad_id,author_id,author_name,body,created_at,status,answer,answerer_name) values
    ('AQ-SEED','AD-ACTIVE','${ids.other}','테스트대상','가짜 준비물 질문',now(),'게시','가짜 답변','테스트교육'),
    ('AQ-REMOVED','AD-ACTIVE','${ids.other}','테스트대상','삭제된 질문',now(),'삭제','','');
    commit;`);
}
