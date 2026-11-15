import {seedConnect} from './connect-fixture.mjs';
import {sql,ids} from './local-db.mjs';
export function seedHomeNotices(){seedConnect();sql(`begin;
truncate encouragements,feedbacks,plaza_posts,calendar_events,calendar_ads,courses,videos restart identity cascade;
insert into encouragements(from_id,from_name,to_id,message,sent_at) values
('${ids.admin}','테스트교육','${ids.member}','첫 번째 가짜 격려','2026-11-13 12:00:00'),
('${ids.other}','테스트대상','${ids.member}','같은 초 두 번째 격려','2026-11-13 12:00:00'),
('${ids.member}','테스트교사','${ids.other}','다른 사람의 비공개 격려','2026-11-13 12:00:00');
insert into feedbacks(receipt_no,member_id,name,source,situation,status,handler_answer,submitted_at) values
('HOME-R1','${ids.member}','테스트교사','교관요청','가짜 요청','완료','첫 가짜 답변',now()),
('HOME-R2','${ids.member}','테스트교사','사람에스컬레이션','가짜 요청','완료','둘째 가짜 답변',now()),
('HOME-OTHER','${ids.other}','테스트대상','교관요청','타인 요청','완료','비공개 답변',now()),
('HOME-AI','${ids.member}','테스트교사','AI','AI 요청','완료','AI 답변',now()),
('HOME-EMPTY','${ids.member}','테스트교사','교관요청','가짜 요청','완료','',now());
insert into plaza_posts(post_id,member_id,name,category,title,body,created_at,updated_at) select 'HOME-POST-'||g,case when g%5=0 then '${ids.member}' else '${ids.other}' end,'테스트대상',(array['사례','성공사례','전도부','나눔'])[g%4+1],'가짜 글 '||g,'알림에 노출하면 안 되는 원문',now()-(35-g)*interval '1 second',now() from generate_series(1,35)g;
insert into calendar_events(event_id,title,start_date,end_date,category,created_by) values
('HOME-E1','가짜 오늘 행사',current_date,current_date,'공식','${ids.admin}'),
('HOME-PRIVATE','다른 사람 일정',current_date,current_date,'내일정','${ids.other}');
insert into calendar_ads(ad_id,title,body,sort_no,updated_at,end_date) values
('HOME-A1','가짜 공지','알림에 노출하면 안 되는 광고 원문',1,now(),null),
('HOME-EXPIRED','지난 공지','숨김 원문',2,now(),'2000-01-01');
insert into courses(course_id,course_name,unit_name,sort_no,content,minutes,category) values('HOME-C1','가짜 교재','가짜 단원',1,'읽기 내용',10,'소양');
insert into videos(video_key,youtube_id,title,status,created_by_id) values('HOME-V1','FAKEVID0001','가짜 영상','','${ids.other}'),('HOME-PENDING','FAKEVID0002','준비 영상','신청','${ids.other}');
commit;`);}
