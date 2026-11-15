import {seedLists} from './lists-fixture.mjs';
import {sql,ids} from './local-db.mjs';
export function seedAggregates() {
 seedLists();
 sql(`
 update teachers set name='동명이인' where member_id in ('9700000000010','9700000000011');
 update teachers set tier_changed_at='2024-02-29' where tier='정교사';
 update teachers set tier_changed_at='2025-11-12' where tier='우수교사';
 insert into activities(member_id,name,submitted_at,activities,roles,target_name,report_text,ai_feedback,ai_feedback_at,tg_posts)
 select '97'||lpad((g%2340+1)::text,11,'0'),'가짜대량기록',
   '2026-11-12'::timestamp-(g%2200)*interval '1 day',array['복음방','만남1'],array['교사'],'가짜대량대상','가짜 보고 원문','',null,'[]'::jsonb
 from generate_series(1,12000) g;
 insert into activities(member_id,name,submitted_at,activities,roles,target_name,report_text,ai_feedback,ai_feedback_at,tg_posts)
 select '${ids.member}','테스트교사','2024-02-29 09:00'::timestamp-(g%700)*interval '1 day',array['상담1','복음방'],array['교사','인도자'],
   case when g%2=0 then '가짜대상' else '가짜다른대상' end,repeat('가짜 누적 보고 ',300),
   case when g%5=0 then repeat('가짜 과거 피드백 ',300) else '' end,'2026-11-01',
   case when g%7=0 then '[{"kind":"post","at":"2026-10-01","messageId":1}]'::jsonb else '[]'::jsonb end
 from generate_series(1,4000) g;
 insert into activities(member_id,name,submitted_at,activities,roles,target_name,target_stage,today_work,ai_feedback,ai_feedback_at,tg_posts)
 values
 ('123','테스트교사','2026-11-12',array['  복음방  ','피드백','피드백'],array['교사'],'오타번호','복음방','','',null,'[]'),
 ('124','동명이인','2026-11-12',array['복음방'],array['교사'],'동명이인','복음방','','',null,'[]'),
 ('${ids.other}','테스트교사','2026-11-12',array['복음방'],array['교사'],'알려진번호우선','복음방','','',null,'[]'),
 ('','테스트교사','2026-11-12',array['복음방'],array['교사'],'빈번호이름보정','복음방','','',null,'[]'),
 ('${ids.member}','테스트교사','2026-11-30 23:59:59.000',array['상담1'],array['교사','교사'],'가짜대상','상담1','','',null,'[]'),
 ('${ids.member}','테스트교사','2026-11-30 23:59:59.000999',array['상담1'],array['교사'],'가짜대상','상담1','','',null,'[]'),
 ('${ids.member}','테스트교사','2026-11-30 23:59:59.001',array['상담2'],array['교사'],'가짜대상','상담2','','',null,'[]'),
 ('${ids.member}','테스트교사','2026-10-31 23:59:59.001',array['복음방'],array['인도자'],'가짜대상','복음방','','',null,'[]'),
 ('${ids.member}','테스트교사','2024-02-29 00:00',array['복음방'],array['교사'],'가짜대상','복음방','','',null,'[]'),
 ('${ids.member}','테스트교사','2026-11-12 06:30:12.999',array['복음방'],array['교사'],'　가짜대상　','센터수강','특수%_(),검증','가짜 검색 전용 피드백','2026-11-12','[{"kind":"edit","at":"2026-11-12"},{"kind":"post","at":"2026-10-30"}]'),
 ('${ids.member}','테스트교사','2026-11-12 06:30:12.001',array['상담1','상담1'],array['교사'],'가짜대상','복음방','','',null,'[]'),
 ('${ids.member}','테스트교사',null,array['복음방'],array['교사'],'가짜대상','복음방','','가짜 날짜없는 피드백',null,'[]');
 insert into center_leads(member_id,lead_date)
 select member_id,d from teachers cross join (values('2024-02-29'::date),('2025-03-01'),('2025-11-12'),('2026-11-12'),('2027-01-01')) x(d)
 where sort_order%17=0;
 insert into tier_approvals(member_id,suggested_tier,coach_approver,type,reason)
 select member_id,'우수교사','가짜승인자','reason','가짜사유' from teachers where sort_order%17=0;
 insert into plaza_posts(post_id,member_id,category,status)
 select 'FAKE-'||g,'97'||lpad((g%4+1)::text,11,'0'),'사례',case when g%7=0 then '삭제' else '게시' end from generate_series(1,100)g;
 insert into connect_cards(member_id) values('${ids.member}');
 insert into app_visits(nid,visits,last_at) values('${ids.member}',25,'2026-11-11 23:59:59.999') on conflict(nid) do update set visits=25;
 insert into teacher_profiles(member_id,available,schedule_type,avail_to,affil,gender)
 values('${ids.member}',true,'직접','2026-11-11','가짜 소속','여');
 insert into attend_records(record_id,meeting_id,member_id,at)
 select 'AGG-'||g,'AGG-'||g,'97'||lpad((g%2340+1)::text,11,'0'),'2026-11-12'::timestamp-(g%40)*interval '1 day' from generate_series(1,5000)g;
 analyze activities; analyze center_leads; analyze attend_records;
 `);
}
