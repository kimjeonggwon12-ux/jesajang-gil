import {seed,sql,quote,ids} from './local-db.mjs';
export const today=()=>new Date(Date.now()+9*3600e3).toISOString().slice(0,10);
export const ATT={auto:'MT140001',survey:'MT140002',closed:'MT140003',history:'MT140004',cohort:'MT140005',series:'RS140001',paused:'RS140002',offday:'RS140003',course:'CH140001',guest:'9900000000080',student:'9900000000081'};
export const questions=[{id:'q1',label:'참석 방식',type:'choice',required:true,options:['현장','온라인']},{id:'q2',label:'도움이 된 내용',type:'multi',required:true,options:['경청','질문','기록']},{id:'q3',label:'나눌 내용',type:'text',required:false,options:[]}];
export function seedAttendance(bulk=false){seed();const date=today(),yesterday=new Date(Date.now()+9*3600e3-864e5).toISOString().slice(0,10),tomorrow=new Date(Date.now()+9*3600e3+864e5).toISOString().slice(0,10),day=new Date(date+'T00:00:00Z').getUTCDay();
 sql(`truncate education_delegations,education_access_events,education_telegram_links,education_telegram_challenges,cohorts,cohort_members,cohort_assignments,cohort_exams,cohort_scores,cohort_submissions,cohort_schedule,cohort_tg_chats,cohort_tg_links,attend_meetings,attend_records,attend_series,attend_notify_queue restart identity;
 insert into cohorts(cohort_id,title,start_date,end_date) values('${ATT.course}','[TEST] 출석 교육','${date}','${date}');
 insert into cohort_members(cohort_id,member_id,name,church) values('${ATT.course}','${ATT.student}','가짜교육생','가짜교육부서');
 insert into attend_meetings(meeting_id,title,date,questions,org,district,cohort_id,status,start_time,end_time) values
 ('${ATT.auto}','[TEST] 오늘 모임','${date}','[]','청년','1','','열림','',''),
 ('${ATT.survey}','[TEST] 경청과 나눔','${date}',${quote(JSON.stringify(questions))},'부녀','유아모','','열림','',''),
 ('${ATT.closed}','[TEST] 마감된 모임','${date}','[]','','','','닫힘','',''),
 ('${ATT.history}','[TEST] 지난 교육','${yesterday}',${quote(JSON.stringify(questions))},'청년','1','','열림','09:00','18:00'),
 ('${ATT.cohort}','[TEST] 교육생 출석','${date}','[]','','','${ATT.course}','열림','',''),
 ('MT140006','[TEST] 미래 모임','${tomorrow}','[]','','','','열림','',''),
 ('MT140007','[TEST] 삭제된 모임','${yesterday}','[]','','','','삭제','','');
 insert into attend_records(record_id,meeting_id,member_id,name,dept,position,answers,at,late,pick_org,pick_district) values
 ('AT140001','${ATT.history}','${ids.member}','테스트교사','청년회','교사','{"q1":"현장","q2":["경청"],"q3":"내 지난 답변"}','${yesterday} 09:02:30','2분 지각','청년','1'),
 ('AT140002','${ATT.history}','${ids.other}','테스트대상','청년회','교사','{"q3":"다른 사람 비공개 답변"}','${yesterday} 09:00:00','정상','청년','2'),
 ('AT140003','MT140006','${ids.member}','테스트교사','청년회','교사','{}','${tomorrow} 09:00:00','','청년','1'),
 ('AT140004','MT140007','${ids.member}','테스트교사','청년회','교사','{}','${yesterday} 09:00:00','','청년','1');
 insert into attend_series(series_id,title,weekdays,slots,status,org,district) values
 ('${ATT.series}','[TEST] 매일 출석','[0,1,2,3,4,5,6]','[{"start":"00:00","end":"23:59"}]','열림','청년','1'),
 ('${ATT.paused}','[TEST] 멈춘 반복','[0,1,2,3,4,5,6]','[{"start":"00:00","end":"23:59"}]','멈춤','',''),
 ('${ATT.offday}','[TEST] 다른 요일','[${(day+1)%7}]','[{"start":"00:00","end":"23:59"}]','열림','','');
 ${bulk?`insert into attend_meetings(meeting_id,title,date,start_time,end_time) select 'MT14B'||i,'[TEST] 누적 모임 '||i,'${yesterday}','08:00','18:00' from generate_series(1,1005)i;
 insert into attend_records(record_id,meeting_id,member_id,name,dept,at,late) select 'AT14B'||i,'MT14B'||i,'${ids.member}','테스트교사','청년회','${yesterday} 08:00:00'::timestamp,'정상' from generate_series(1,1005)i;`:''}`);
}
