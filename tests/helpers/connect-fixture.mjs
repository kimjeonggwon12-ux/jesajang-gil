import {seed,sql,ids} from './local-db.mjs';
export const connectChat=[ids.member,ids.other].sort().join('__');
export function seedConnect(){seed();sql(`begin;
 truncate connect_cards,help_posts,matches,chat_messages,coop_requests restart identity;
 insert into connect_cards(member_id,name,phone,intro,career,one_liner,roles,langs,targets,fields,sched_type,dept,region,updated_at) values
 ('${ids.member}','테스트교사','010-0000-0101','가짜 내 소개','가짜 숨은 경력','가짜 내 한 줄',array['교사','동행교사','기타'],array['영어'],array['청년 대상'],array['인문학'],'언제나','청년회','1지역','2026-11-12 11:00'),
 ('${ids.other}','테스트대상','010-0000-0005','가짜 다른 소개','','함께하는 가짜 교사',array['인도자','복음방'],array['중국어'],array['장년 대상'],array['운동'],'상의','청년회','1지역','2026-11-12 10:00');
 insert into connect_cards(member_id,name,phone,one_liner,roles,langs,targets,sched_type,from_date,to_date,dept,region,updated_at)
 select (9910000000000+g)::text,'가짜명함'||g,'010-0000-9000','가짜 소개 '||g,case when g%2=0 then array['교사','상담1'] else array['협력교사','동아리'] end,array['영어'],array['전 연령'],case when g%3=0 then '등록' else '언제나' end,'2026-01-01',case when g%5=0 then '2020-01-01' else '2099-12-31' end,(array['교역자','자문회','장년회','부녀회','청년회'])[g%5+1],'1지역','2026-11-01'::timestamp+g*interval '1 minute' from generate_series(1,203)g;
 insert into help_posts(help_id,member_id,name,type,dept,start_date,end_date,one_liner,status,created_at,target,need) values
 ('CONNECT-MY','${ids.member}','테스트교사','교사 · 복음방','청','2020-01-01','2020-02-01','가짜 지난 내 요청','진행','2026-11-10','가짜 상황','가짜 도움'),
 ('CONNECT-OTHER','${ids.other}','테스트대상','협력교사 · 동아리','청','2026-01-01','2099-12-31','가짜 동아리 요청','진행','2026-11-11','가짜 동아리 상황','가짜 동행 도움'),
 ('CONNECT-CLOSED','${ids.other}','테스트대상','동행 교사 필요','청','2020-01-01','2020-02-01','가짜 마감 요청','마감','2026-11-09','가짜 상황','가짜 도움');
 insert into chat_messages(chat_id,from_id,to_id,message,sent_at,is_read) select '${connectChat}','${ids.other}','${ids.member}','가짜 개인 대화 '||g,'2026-11-12 09:00',g<=1200 from generate_series(1,1205)g;
 insert into chat_messages(chat_id,from_id,to_id,message,sent_at,is_read) values('${[ids.coach,ids.other].sort().join('__')}','${ids.coach}','${ids.other}','타인끼리 비공개 가짜 대화','2026-11-12 09:00',false);
 insert into matches(match_id,kind,ref_id,from_id,from_name,to_id,to_name,status,requested_at) values('CONNECT-MATCH','명함','${ids.other}','${ids.member}','테스트교사','${ids.other}','테스트대상','요청','2026-11-12');
 commit;`);}
