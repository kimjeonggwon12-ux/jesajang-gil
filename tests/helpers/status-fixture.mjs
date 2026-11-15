import {seedAggregates} from './aggregates-fixture.mjs';
import {sql,ids} from './local-db.mjs';
export function seedStatus() {
 seedAggregates();
 sql(`
 update teachers set dept='장년회' where member_id='${ids.other}';
 update teachers set region='' where member_id='${ids.coach}';
 update teachers set tier='기타' where member_id='${ids.fresh}';
 insert into teachers(member_id,name,dept,region,tier,sort_order) values
 ('0','가짜영번호','청년회','1지역','휴교사',9001),
 ('0${ids.member}','가짜번호다른표기','부녀회','1지역','우수교사',9002),
 (' ${ids.member} ','가짜공백번호','청년회','3지역','정교사',9003),
 ('98000001','가짜부서공백',' 청년회 ','1지역','활동교사',9004),
 ('98000002','가짜지역공란','교육부','','',9005);
 insert into activities(member_id,name,submitted_at,activities,roles) values
 ('0','가짜영번호','2026-11-12',array['복음방'],array['교사']),
 ('${ids.member}','테스트교사','2026-11-30 23:59:59.000999',array['복음방 교육',' 복음방 ','','알수없는활동','알수없는활동'],array['교사','교사','인도자']),
 ('0${ids.member}','가짜번호다른표기','2026-11-30 23:59:59.999',array['상담','복음방'],array['협력교사']),
 (' ${ids.member} ','가짜공백번호','2026-11-05',array['복음방'],array['교사']),
 ('98000001','가짜부서공백','2026-11-12',array['복음방'],array['인도자']),
 ('98000002','가짜지역공란','2026-11-12',array[''],array['교사']);
 insert into center_leads(member_id,lead_date) select '${ids.other}',case when g<=1000 then '2000-01-01'::date else '2026-11-12'::date end from generate_series(1,1005)g;
 insert into attend_records(record_id,meeting_id,member_id,at) values
 ('STAT-1','STAT-1','${ids.fresh}','2026-11-05'),('STAT-2','STAT-2','${ids.fresh}','2026-11-04 23:59:59.999'),('STAT-3','STAT-3','${ids.fresh}','2026-11-06');
 insert into targets(target_id,target_name,creator_id,leader_id,helper_id,stage,completed) values
 ('STAT-1','가짜현황대상1','${ids.member}','${ids.other}','${ids.member}','상담1',false),
 ('STAT-2','가짜현황대상2','${ids.other}','${ids.member}','','센터수강',false),
 ('STAT-3','가짜현황대상3','${ids.member}','','','복음방',true),
 ('STAT-4','가짜현황대상4','0','','','만남1',false),
 ('STAT-5','가짜현황대상5','98000002','','','친분',false);
 analyze teachers; analyze activities; analyze center_leads; analyze targets;
 `);
}
