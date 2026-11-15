import {seedStatus} from './status-fixture.mjs';
import {sql,ids} from './local-db.mjs';
export function seedRemaining() {
 seedStatus();
 sql(`truncate feedbacks,target_ai_notes,attend_meetings restart identity cascade;
 insert into attend_meetings(meeting_id,title,date,status) values
 ('REMAIN-LIVE','가짜 교육','2026-11-01','열림'),('REMAIN-DELETED','가짜 삭제교육','2026-11-02','삭제'),
 ('REMAIN-FUTURE','가짜 미래교육','2027-02-01','닫힘'),('REMAIN-OLD','가짜 지난교육','2026-10-30','열림');
 insert into attend_records(record_id,meeting_id,member_id,at) values
 ('RM1','REMAIN-LIVE','${ids.member}','2026-11-02'),('RM2','REMAIN-LIVE','${ids.member}','2026-11-03'),
 ('RM3','REMAIN-DELETED','${ids.other}','2026-11-02'),('RM4','REMAIN-FUTURE','${ids.other}','2027-02-02'),
 ('RM5','REMAIN-OLD','${ids.coach}','2026-11-02') on conflict do nothing;
 insert into target_ai_notes(target_id,member_id,kind,input,text,created_at)
 select 'LIST-1','${ids.member}',case when g%3=0 then '파악정보' when g%3=1 then 'AI 종합 피드백' else '가짜 AI 기록' end,
 '가짜 입력 '||g,repeat('가짜😀누적 정보 ',400),'2026-10-01'::timestamp+g*interval '1 minute' from generate_series(1,1205)g;
 insert into target_history(target_id,changed_at,to_stage,memo)
 select 'LIST-1','2026-01-01'::timestamp+g*interval '1 minute','복음방',repeat('가짜😀단계 ',50) from generate_series(1,1005)g;
 insert into feedbacks(member_id,source,situation,ai_coach_text,handler_answer,handler,submitted_at)
 select '${ids.member}','AI셀프코칭',case when g%11=0 then '가짜대상 내용 ' when g%7=0 then '가**상 내용 ' else '관계없는 대상 내용 ' end||g,
 repeat('가짜😀상담 답 ',400),repeat('가짜 교관 답 ',300),'가짜교관','2026-11-01 23:50+09'::timestamptz+g*interval '1 minute' from generate_series(1,1305)g;
 insert into feedbacks(member_id,situation,submitted_at) values('${ids.other}','가짜대상 남의 상담','2026-11-01');
 insert into targets(target_id,creator_id,target_name,stage,leader_id,helper_id) values('RM-T','${ids.member}','특수%_(),이름','알수없는단계','${ids.other}','${ids.member}');
 insert into activities(member_id,name,target_name,activities,roles,submitted_at,today_work)
 values('${ids.member}','테스트교사',' 특수%_(),이름 ',array['친분','만남2','센터소개','   ','알수없는항목'],array['교사','교사'],'2026-11-30 23:59:59.999','가짜 내용'),
 ('${ids.other}','테스트대상','가짜대상',array['복음방'],array['교사'],'2026-11-11','남의 기록 제외');
 analyze activities; analyze feedbacks; analyze attend_records; analyze targets;`);
}
