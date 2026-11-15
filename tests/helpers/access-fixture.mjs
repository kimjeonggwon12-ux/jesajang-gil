import {seed,sql,ids} from './local-db.mjs';
export function seedAccess(){
 seed();
 sql(`truncate center_referrals,centers restart identity;
 insert into admins(member_id,name,dept,region,position,phone) values
 ('${ids.coach}','테스트교관','청년회','1지역','복음방교관','01000000004'),
 ('${ids.coach}','테스트교관','장년회','2지역','지역장','01000000004');
 insert into center_referrals(target_id,target_name,teacher_id,teacher_name,dept,region,stage,status,snapshot) values
 ('ACCESS-1','가짜대상1','${ids.other}','테스트대상','청년회','1지역','복음방','요청','{}'),
 ('ACCESS-2','가짜대상2','${ids.other}','테스트대상','장년회','2지역','복음방','요청','{}'),
 ('ACCESS-3','가짜대상3','${ids.other}','테스트대상','청년회','2지역','복음방','요청','{}'),
 ('ACCESS-4','가짜대상4','${ids.other}','테스트대상','장년회','1지역','복음방','요청','{}');`);
}
