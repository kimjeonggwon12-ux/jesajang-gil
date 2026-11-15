import {seedCohortUi,A,B,OWNER,today,day} from './cohort-ui-fixture.mjs';
import {sql,ids} from './local-db.mjs';
export {A,B,OWNER,today,day};
export function seedEducationWork(){seedCohortUi();sql(`
 update education_delegations set permissions='{assignments,exams}' where nid='${ids.admin}';
 update education_delegations set permissions='{reports}' where nid='${ids.evangel}';
 update cohorts set tg_chat='-990001' where cohort_id='${A}';
 update cohort_assignments set repeat='날짜',dates='${day(-1)},${today},${day(2)}',guide='가짜 과제 설명',created_at='${day(-2)} 00:00:00' where cohort_id='${A}';
 insert into cohort_assignments(assignment_id,cohort_id,title,repeat,due,created_at) values('AS170001','${A}','가짜 한번 과제','한번','${today}','${day(-2)} 00:00:00');
 insert into cohort_submissions(assignment_id,cohort_id,member_id,name,content,work_date,submitted_at,source) values('AS990001','${A}','${ids.member}','테스트교사','<script>가짜 원문</script>','${today}','${today} 10:00:00','telegram'),('AS170001','${A}','${ids.other}','테스트대상','가짜 한번 제출','','${today} 11:00:00','telegram');
 insert into cohort_scores(cohort_id,date,subject,member_id,name,score) values('${A}','${today}','가짜시험','${ids.member}','테스트교사',90),('${A}','${today}','가짜시험','${ids.other}','테스트대상',0),('${A}','${day(-1)}','가짜다른과목','${ids.member}','테스트교사',80);
 `);}
