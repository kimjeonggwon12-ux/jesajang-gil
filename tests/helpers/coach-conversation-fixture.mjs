import {seed,sql,ids} from './local-db.mjs';
export function seedCoachConversation(){
 seed();
 sql(`begin;
 truncate activities,targets,chat_messages,target_history,target_ai_notes,target_room_invites restart identity cascade;
 update teachers set position='교관' where member_id in ('${ids.member}','${ids.coach}');
 insert into admins(member_id,name,dept,region,position) values
 ('${ids.coach}','중복교관','부녀회','다른지역','총교관'),
 ('${ids.other}','테스트대상','장년회','2지역','총교관');
 insert into teachers(member_id,name,dept,region,position,sort_order) values
 ('9900000000008','가짜자문교관','자문회','3지역','교관',8),
 ('9900000000009','가짜부녀교관','부녀회','4지역','교관',9),
 ('9900000000010','가짜청년교관','청년회','9지역','교관',10),
 ('9900000000011','제외전도교관','전도부','1지역','교관',11),
 ('9900000000012','제외명단총교관','청년회','1지역','총교관',12);
 insert into targets(target_id,creator_id,leader_id,target_name,stage,goal_cohort)
 values('COACH-TARGET','${ids.member}','${ids.coach}','가짜대상','복음방','2027-01');
 insert into activities(member_id,name,submitted_at,activities,roles,target_name,target_stage,special_note,today_work,next_work)
 values('${ids.member}','테스트교사','2026-11-13 09:00',array['복음방'],array['교사'],'가짜대상','복음방','가짜 특이사항','가짜 오늘 활동','가짜 다음 약속');
 insert into target_room_invites(code,target_id,created_by,expires_at,max_uses)
 values('COACHG29','COACH-TARGET','${ids.member}',now()+interval '1 day',5);
 commit;`);
}
