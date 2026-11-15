import {seed,sql,ids,quote} from './local-db.mjs';
export function seedCenters(){seed();const snapshot={builtAt:'2026-11-13 09:00:00',basis:'가짜 기록 기준',target:{name:'가짜수강생',stage:'복음방',profile:{age:'30',faith:'가짜 배경',phone4:'0000',lessons:['가짜 교육']},goalPlan:'가짜 계획'},teacher:{name:'테스트교사',dept:'청년회',region:'1지역'},sections:{info:['없음','<script>실행되면 안 됨</script>'],acts:['가짜 활동'],history:['섭외 → 복음방'],coaching:['가짜 상담'],notes:[]}};
 sql(`truncate center_referrals,centers,target_history,targets,target_ai_notes,activities,feedbacks,center_leads restart identity cascade;
 insert into admins(member_id,name,dept,region,position) values('${ids.coach}','테스트교관','청년회','1지역','복음방교관'),('${ids.coach}','테스트교관','장년회','2지역','지역장');
 insert into centers(name,cohort_no,open_month,open_date,staff,active) values('가짜센터','18기','2026-11','2026-11-19','[{"memberId":"${ids.other}","name":"테스트대상","role":"담당"},{"memberId":"${ids.coach}","name":"테스트교관","role":"전도사"},{"memberId":"","name":"가짜이름반","role":"전도사"}]',true),('다른센터','19기','2026-12','','[]',true),('닫힌센터','','2026-10','','[]',false);
 insert into targets(target_id,creator_id,target_name,stage,goal_cohort,report_profile) values('C18-OWN','${ids.member}','가짜요청대상','복음방','2026-12','{"phone4":"0000"}'),('C18-EARLY','${ids.member}','가짜이전단계','섭외','','{}'),('C18-PRIVATE','${ids.other}','다른사람대상','복음방','','{}');
 insert into target_ai_notes(target_id,member_id,kind,text) values('C18-OWN','${ids.member}','파악정보','가짜 파악정보'),('C18-OWN','${ids.member}','AI 종합 피드백','가짜 종합피드백');
 insert into center_referrals(target_id,target_name,teacher_id,teacher_name,dept,region,stage,status,center_id,assignee_id,assignee_name,snapshot) values
 ('C18-R1','가짜대기1','${ids.member}','테스트교사','청년회','1지역','복음방','요청',null,'','',${quote(JSON.stringify(snapshot))}),
 ('C18-R2','가짜대기2','${ids.member}','테스트교사','장년회','2지역','복음방','요청',null,'','',${quote(JSON.stringify(snapshot))}),
 ('C18-R3','범위밖대기','${ids.member}','테스트교사','장년회','1지역','복음방','요청',null,'','',${quote(JSON.stringify(snapshot))}),
 ('C18-R4','가짜기존승인','${ids.member}','테스트교사','청년회','1지역','복음방','승인',null,'','',${quote(JSON.stringify(snapshot))}),
 ('C18-R5','가짜받은서류','${ids.member}','테스트교사','청년회','1지역','복음방','전달',1,'${ids.coach}','테스트교관',${quote(JSON.stringify(snapshot))}),
 ('C18-R6','가짜반려','${ids.member}','테스트교사','청년회','1지역','복음방','반려',null,'','',${quote(JSON.stringify(snapshot))});`);
}
