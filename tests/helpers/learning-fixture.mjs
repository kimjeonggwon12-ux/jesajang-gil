import {seed,sql,ids} from './local-db.mjs';
export function seedLearning(bulk=false){seed();sql(`begin;
 truncate courses,videos,video_transcripts,textbook_wishes,request_comments,lectures,lecture_progress,work_locks restart identity;
 insert into admins(member_id,name,dept,position,region) values('${ids.coach}','테스트교관','청년회','복음방교관','1지역');
 insert into courses(course_id,course_name,unit_name,sort_no,content,minutes,category) values
 ('G1-01','가짜 복음방 교재','성경 첫걸음',1,'제 1 과 성경 첫걸음\n□ 학습 목표\n하나님 말씀과 사랑을 배웁니다.\n[요 3:16] 하나님이 세상을 이처럼 사랑하사\n1. 질문\n① 무엇을 배웠나요?',15,'복음방'),
 ('G2-01','가짜 상담 교재','마음 듣기',1,'상담은 질문과 경청으로 시작합니다. <script>실행되지 않는 원문</script>',20,'상담'),
 ('G9-01','가짜 소양 교재','교사 소양',1,'교사의 자세와 역할을 배웁니다.',10,'교사소양');
 insert into videos(video_key,youtube_id,title,parts,description,upload_date,status,created_by_id,created_by,phone) values
 ('VD-ONE','FAKEVID0001','[TEST] 가짜 상담 영상',array['소양','상담'],'가짜 설명','2026-11-12','','${ids.admin}','테스트교육',''),
 ('VD-TWO','FAKEVID0002','[TEST] 가짜 밭갈기 영상',array['밭갈기'],'가짜 설명','2026-11-11','','${ids.admin}','테스트교육',''),
 ('VD-STALE','FAKEVID0003','[TEST] 바뀐 영상 주소',array['소양'],'','2026-11-10','','${ids.admin}','테스트교육',''),
 ('VD-PENDING','FAKEVID0004','[TEST] 내 신청',array['상담'],'가짜 신청','2026-11-10','신청','${ids.member}','테스트교사','01000000001'),
 ('VD-OTHER','FAKEVID0005','[TEST] 다른 사람 신청',array['복음방'],'','2026-11-10','신청','${ids.other}','테스트대상','01000000005');
 insert into video_transcripts(video_key,youtube_id,status,duration,segs,done,summary,texts,pkg) values
 ('VD-ONE','FAKEVID0001','완료',100,1,1,'## 가짜 요약\n경청으로 돕는 상담입니다.',array['## [00:10] 가짜 녹취\n하나님 말씀과 경청에 관한 가짜 기록'], jsonb_build_object('lesson','## 1. 가짜 교안\n- 질문과 경청','share','## 나눔 질문\n어떻게 도울까요?','quiz','## 퀴즈\n1. 가짜 질문','outreach','## 짧은 초대\n가짜 초대 문구 [영상 링크]')),
 ('VD-STALE','OLDFAKE0003','완료',100,1,1,'옛 영상의 자료',array['옛 영상 녹취'],'{}'),
 ('VD-PENDING','FAKEVID0004','완료',100,1,1,'미게시 자료',array['미게시 녹취'],'{}');
 insert into textbook_wishes(wish_id,member_id,name,title,part,note,requested_at,phone) values('TW-MINE','${ids.member}','테스트교사','[TEST] 상담 교재 신청','상담','가짜 희망 내용',now(),'01000000001'),('TW-OTHER','${ids.other}','테스트대상','[TEST] 다른 사람 교재','소양','가짜 내용',now(),'01000000005');
 insert into request_comments(comment_id,request_id,member_id,name,body,created_at) values('C1','TW-MINE','${ids.member}','테스트교사','가짜 신청 댓글',now());
 insert into lectures(lecture_id,title,part,instructor,description,lessons,featured,status,updated_at) values
 ('LC-ONE','[TEST] 상담 입문 강좌','상담','가짜 강사','두 강을 듣는 가짜 교육','["VD-ONE","VD-TWO"]',true,'',now()),
 ('LC-HIDDEN','[TEST] 준비 중인 강좌','소양','가짜 강사','','["VD-ONE"]',false,'숨김',now()),
 ('LC-STALE','[TEST] 자료 갱신 강좌','소양','','','["VD-STALE"]',false,'',now());
 insert into lecture_progress(member_id,name,lecture_id,video_key,buckets,duration,last_pos,completed,updated_at) values('${ids.member}','테스트교사','LC-ONE','VD-ONE','[0,1,2]',100,30,false,now());
 ${bulk?`insert into courses(course_id,course_name,unit_name,sort_no,content,minutes,category) select 'BULK-'||g,'가짜 대량 교재','가짜 단원 '||g,g,'검색용 가짜 내용',1,'소양' from generate_series(1,1005)g;
 insert into request_comments(comment_id,request_id,member_id,name,body,created_at) select 'BC-'||g,'TW-MINE','${ids.member}','테스트교사','가짜 댓글 '||g,now() from generate_series(1,1005)g;
 insert into lecture_progress(member_id,name,lecture_id,video_key,buckets,duration,last_pos,completed,updated_at) select '970'||lpad(g::text,10,'0'),'가짜 수강자 '||g,'LC-ONE','VD-ONE','[0,1,2]',100,30,false,now() from generate_series(1,1005)g;`:''}
 commit;`);}
