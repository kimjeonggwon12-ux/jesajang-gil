import {seedInsights} from './target-insights-fixture.mjs';
import {sql,ids} from './local-db.mjs';
export function seedRooms(){
  seedInsights();
  sql(`insert into admins(member_id,name,dept,region,position)values('${ids.admin}','테스트교육','청년회','1지역','복음방교관');
    truncate target_room_messages,target_room_members,target_room_invites restart identity;
    insert into target_room_members(target_id,member_id,name,role,last_read_id,joined_at) values
      ('LIST-1','${ids.member}','테스트교사','담당',0,'2026-11-01'),('LIST-1','${ids.admin}','테스트교육','관리자',0,'2026-11-01');
    insert into target_room_messages(target_id,from_id,from_name,body,pinned,created_at)
      select 'LIST-1','${ids.admin}','테스트교육','가짜대상 010-0000-0001 가짜 대화 '||g,g=1,'2026-11-01'::timestamp+g*interval '1 minute' from generate_series(1,350) g;
    insert into target_room_invites(code,target_id,created_by,created_name,created_at,expires_at,max_uses)
      values('ROOMTEST','LIST-1','${ids.member}','테스트교사',now(),now()+interval '1 day',5);`);
}
