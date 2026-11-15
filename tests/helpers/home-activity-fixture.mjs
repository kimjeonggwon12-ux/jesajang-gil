import {seed,sql,ids} from './local-db.mjs';
export function seedHomeActivity(){
 seed();
 sql(`truncate activities,target_history,targets,target_ai_notes,target_room_messages,target_room_members,target_room_invites,center_leads,tier_approvals restart identity cascade;
 update teachers set tier='휴교사' where member_id='${ids.member}';
 insert into targets(target_id,creator_id,leader_id,helper_id,target_name,stage,completed) values
 ('HOME-A','${ids.member}','${ids.other}','','가짜진행대상','복음방',false),
 ('HOME-B','${ids.other}','00${ids.member}','','가짜인도대상','친분',false),
 ('HOME-C','${ids.member}','','${ids.member}','가짜완료대상','센터수강',true),
 ('HOME-D','${ids.member}','','',' 공백대상 ','섭외',false),
 ('HOME-OTHER','${ids.other}','','','남의비공개대상','친분',false);
 insert into activities(member_id,name,submitted_at,roles,activities,target_name,target_stage,today_work) values
 ('${ids.member}','테스트교사','2025-01-01',array['인도자','교사'],array['복음방'],'가짜진행대상','복음방','지난해 활동도 담당 역할에 반영'),
 ('${ids.member}','테스트교사','2026-11-01',array['교사'],array['만남1'],'가짜완료대상','만남1','완료 대상은 담당 요약 제외'),
 ('${ids.member}','테스트교사','2026-11-02',array['교사'],array['만남1'],'공백대상','만남1','이름 원문 비교'),
 ('${ids.member}','테스트교사','2026-11-03',array['교사'],array['만남1'],'가짜이름기록','만남1','명단 없이 남긴 가짜 활동'),
 ('${ids.member}','테스트교사','2026-11-04',array['협력교사'],array['동아리','만남 동행'],'','친분','올해 협력 활동'),
 ('${ids.member}','테스트교사','2025-11-04',array['협력교사'],array['동아리'],'','친분','작년 협력 활동'),
 ('${ids.other}','테스트대상','2026-11-03',array['교사'],array['만남1'],'가짜이름기록','만남1','다른 사람 동명 기록');`);
}
