import {seed,sql,ids} from './local-db.mjs';
export function seedCommunity(){seed();sql(`begin;
 truncate plaza_posts,plaza_comments,connect_cards,activities,targets,target_ai_notes,target_history,feedbacks,report_rooms restart identity cascade;
 update teachers set dept='부녀회' where member_id='${ids.coach}';
 insert into targets(target_id,creator_id,target_name,stage) values('COMM-OWN','${ids.member}','개인가짜대상','복음방'),('COMM-OTHER','${ids.other}','비공개가짜대상','친분');
 insert into activities(member_id,name,submitted_at,activities,reaction,target_name,target_stage,today_work) values
 ('${ids.member}','테스트교사','2026-11-01',array['친분','복음방'],'긍정적','개인가짜대상','복음방','가짜 활동 내용'),
 ('${ids.member}','테스트교사','2026-11-02',array[]::text[],'','별개가짜대상','','가짜 활동 내용'),
 ('${ids.other}','테스트대상','2026-11-01',array['센터수강'],'긍정적','비공개가짜대상','센터수강','가짜 활동 내용'),
 ('${ids.other}','테스트대상','2026-11-02',array['섭외'],'','비공개가짜대상','섭외','가짜 활동 내용'),
 ('${ids.coach}','테스트교관','2026-11-01',array['상담1'],'','가짜부녀대상','상담1','가짜 활동 내용');
 insert into plaza_posts(post_id,member_id,name,category,title,body,tags,created_at,updated_at) select 'COMM-'||g,'${ids.member}','테스트교사',(array['사례','성공사례','실패사례'])[g%3+1],'가짜 사례 '||g,'가짜 본문 '||g,array['기록'],'2026-11-05'::timestamp+g*interval '1 minute','2026-11-05' from generate_series(1,45)g;
 insert into plaza_posts(post_id,member_id,name,category,title,body,likes,created_at,updated_at,status) values
 ('COMM-OWN-POST','${ids.member}','테스트교사','사례','가짜 내 사례','개인가짜대상 관련 가짜 내용',array['a','b','c','d','e'],'2026-11-10','2026-11-10','게시'),
 ('COMM-OTHER-POST','${ids.other}','테스트대상','성공사례','비공개가짜대상 가짜 사례','비공개가짜대상 · 연락처: 010-0000-0005',array['a','b','c','d','e','f','g','h'],'2026-11-11','2026-11-11','게시'),
 ('COMM-ADMIN','${ids.admin}','테스트교육','전도부','가짜 관리자 안내','가짜 안내',array['a','b','c','d'],'2026-11-09','2026-11-09','게시'),
 ('COMM-SHARE','${ids.member}','테스트교사','나눔','가짜 이전 나눔','나눔 호환 본문',array[]::text[],'2026-11-01','2026-11-01','게시'),
 ('COMM-DELETED','${ids.other}','테스트대상','사례','삭제한 가짜 글','삭제 내용',array[]::text[],'2026-11-10','2026-11-10','삭제');
 insert into plaza_posts(post_id,member_id,name,category,title,body,likes,tags,created_at,updated_at) select 'COMM-CONTEST-'||g,'${ids.member}','테스트교사','나눔','[이름 공모] 가짜이름 '||g,'담은 뜻: 가짜 의미 '||g,case when g=52 then array['a','b','c'] else array[]::text[] end,array['이름공모'],'2026-11-06'::timestamp+g*interval '1 minute','2026-11-06' from generate_series(1,55)g;
 insert into plaza_comments(comment_id,post_id,member_id,name,body,created_at) select 'COMM-C-'||g,'COMM-OTHER-POST','${ids.other}','테스트대상','비공개가짜대상 가짜 댓글 '||g,'2026-11-11'::timestamp+g*interval '1 second' from generate_series(1,1005)g;
 insert into plaza_comments(comment_id,post_id,member_id,name,body,created_at) values('COMM-MY-C','COMM-OWN-POST','${ids.member}','테스트교사','가짜 내 댓글','2026-11-10');
 insert into connect_cards(member_id,name,phone,intro,dept,region,roles,fields,updated_at) values('${ids.other}','테스트대상','010-0000-0005','가짜 공개 명함','청년회','1지역',array['교사'],array['교육'],now());
 commit;`);}
