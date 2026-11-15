import {seedLists} from './lists-fixture.mjs';
import {sql,ids} from './local-db.mjs';
export function seedInsights(){
  seedLists();
  sql(`truncate target_ai_notes,feedbacks,report_rooms,target_room_messages,target_room_members,target_room_invites restart identity;
    update targets set leader_id='${ids.coach}',helper_id='${ids.evangel}',goal_cohort='2027-01',stage='센터수강',report_profile='{"course":"중등","center":"가짜센터","enroll":"11"}',goal_plan='보존할 현재 계획',goal_plan_at='2026-11-12',goal_plan_basis='가짜 기존 근거' where target_id='LIST-1';
    insert into targets(target_id,creator_id,target_name,stage) values('PRIVATE','${ids.other}','타인비공개','섭외');
    insert into target_ai_notes(target_id,member_id,kind,input,text,created_at)
      select 'LIST-1','${ids.member}','파악정보',case when g%2=0 then '가족, 관심사·취미' else '기타' end,'가짜 파악 기록 '||g,'2026-11-01'::timestamp+g*interval '1 minute' from generate_series(1,42) g;
    insert into target_ai_notes(target_id,member_id,kind,input,text,created_at)
      select 'LIST-1','${ids.member}','개강 인도 계획','가짜 계획 근거 '||g,'가짜 과거 계획 '||g,'2026-11-01'::timestamp+g*interval '1 minute' from generate_series(1,25) g;
    insert into target_ai_notes(target_id,member_id,kind,input,text,created_at) values
      ('LIST-2','${ids.member}','파악정보','기타','다른 대상자 정보','2026-11-01'),
      ('PRIVATE','${ids.other}','파악정보','기타','타인비공개내용','2026-11-01'),
      ('LIST-1','${ids.member}','AI 파악정보 피드백','가짜 기존 근거','보존할 기존 피드백','2026-11-01'),
      ('LIST-1','${ids.member}','AI 종합 피드백','가짜 기존 근거','보존할 종합 피드백','2026-11-01');
    insert into feedbacks(member_id,name,source,situation,ai_coach_text,handler,handler_answer,status,submitted_at)
      select '${ids.member}','테스트교사','교관요청','대상자: 가짜대상 / 가짜 상황 '||g,'가짜 상담 '||g,'테스트교관','가짜 교관 답변 '||g,'완료','2026-11-01'::timestamptz+g*interval '1 minute' from generate_series(1,25) g;
    insert into target_room_invites(code,target_id,created_by,expires_at,max_uses) values('INSIGHTG','LIST-1','${ids.member}',now()+interval '1 day',5);`);
}
