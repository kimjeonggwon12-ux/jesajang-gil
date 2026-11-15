import { seed, sql, ids } from './local-db.mjs';
export function seedLists() {
  seed();
  sql(`truncate activities,center_leads,tier_approvals,app_visits,connect_cards,plaza_posts,attend_records,target_history,targets restart identity cascade;
    insert into teachers(member_id,name,dept,region,position,tier,sort_order,month_stats)
    select '97'||lpad(g::text,11,'0'),'가짜교사'||lpad(g::text,4,'0'),
      (array['장년회','부녀회','청년회','교역자','자문회','교육부'])[g%6+1],
      (g%12+1)||'지역',case when g%13=0 then '지역장' else '' end,
      (array['활동교사','정교사','우수교사','기타','휴교사'])[g%5+1],g+10,
      '{"2026-10":{"센터등록":2}}'::jsonb from generate_series(1,2340)g;
    update teachers set name='문자%_(),교사' where member_id='9700000000001';
    insert into teacher_profiles(member_id,available,avail_roles,schedule_type)
      select member_id,true,array['교사'],'언제나' from teachers where sort_order%7=0 and member_id like '97%';
    insert into activities(member_id,name,submitted_at,activities,roles,target_name,target_stage,today_work,next_work,report,report_text,ai_feedback)
    select '${ids.member}','테스트교사',case when g=1205 then null else '2026-11-12 09:00:00'::timestamp - ((g/4)||' days')::interval end,
      array[case when g%2=0 then '복음방' else '만남1' end],array[case when g%3=0 then '협력교사' else '교사' end],
      case when g%10=0 then '가짜다른대상' else '가짜대상' end,'복음방','가짜 오늘 내용 '||g,'가짜 다음 계획',
      jsonb_build_object('lesson','가짜 교육 '||g,'photos','[]'::jsonb,'lessons',jsonb_build_array(repeat('이전 가짜 교육 ',250)),'request','가짜 요청'),
      '가짜 보고서 '||g||' '||repeat('가짜 누적 내용 ',300),case when g%11=0 then '가짜 피드백' else '' end from generate_series(1,1205)g;
    update activities set report_text='특수%_(),문자 검색 확인' where id=3;
    insert into activities(member_id,name,submitted_at,activities,target_name,report_text)
      values('${ids.other}','테스트대상','2026-11-12 09:00:00',array['복음방'],'남의비공개대상','남의비공개본문');
    insert into targets(target_id,creator_id,target_name,stage) values('LIST-1','${ids.member}','가짜대상','복음방'),('LIST-2','${ids.member}','가짜다른대상','복음방');
    analyze activities; analyze teachers;`);
}
