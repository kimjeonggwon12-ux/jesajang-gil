-- 앞선 현황 함수를 확장한다. 원본·등급 전환 정책은 변경하지 않는다.
create or replace function public.scope_tier_facts(p_scope jsonb,p_bounds jsonb,p_aliases jsonb,p_rest text[])
returns jsonb language sql stable security invoker set search_path = '' as $$
 with bounds as (
  select (p_bounds->>'now')::timestamp now_at,(p_bounds->>'monthStart')::timestamp month_start,
   (p_bounds->>'monthEnd')::timestamp month_end,(p_bounds->>'yearStart')::timestamp year_start,
   (p_bounds->>'recentStart')::timestamp recent_start,
   (p_bounds->>'monthStart')::timestamp+interval '1 month' month_next
 ), members as materialized (
  select member_id,nid,name,dept,region,affiliation,tier,tier_changed_at,sort_order from public.teachers t
  where (p_scope->>'dept' is null or case when p_scope->>'otherBucket'='true'
    then not (public.app_trim(t.dept)=any(array['교역자','자문회','장년회','부녀회','청년회'])) else t.dept=p_scope->>'dept' end)
   and (p_scope->>'region' is null or t.region=p_scope->>'region')
 ), known as (select distinct nid from public.teachers), names as (
  select name,min(nid) nid from public.teachers group by name having count(*)=1
 ), normalized as materialized (
  select a.member_id<>'' has_member,case when k.nid is not null then a.nid else coalesce(n.nid,a.nid) end nid,
   date_trunc('milliseconds',a.submitted_at) at,a.activities,a.roles
  from public.activities a left join known k on k.nid=a.nid
   left join names n on k.nid is null and n.name=public.app_trim(a.name)
  where case when k.nid is not null then a.nid else coalesce(n.nid,a.nid) end in(select nid from members)
 ), seen as (
  select distinct nid from normalized where nid<>'0' and at is not null and isfinite(at)
 ), items as (
  select nid,at,coalesce(p_aliases->>public.app_trim(raw),public.app_trim(raw)) type
  from normalized cross join lateral unnest(activities) raw where nid<>'0' and at is not null and isfinite(at)
 ), activity as (
  select nid,count(*) filter(where at between b.month_start and b.month_end) monthly_count,max(at) last_at,max(at) filter(where at<=b.now_at) last_before,
   count(*) filter(where at>=b.recent_start and type=any(p_rest)) recent_n
  from items,bounds b where type<>'' group by nid
 ), leads as materialized (
  select l.* from public.center_leads l where l.nid in(select nid from members where nid<>'0') and lead_date is not null
 ), lead_counts as (
  select nid,count(*) filter(where lead_date::timestamp between year_start and now_at) recent_n,
   count(*) filter(where lead_date::timestamp>=year_start) condition_n from leads,bounds group by nid
 ), reviews as (
  select m.member_id,count(l.id) n from members m cross join bounds b left join leads l on l.nid=m.nid
   and l.lead_date::timestamp between coalesce(m.tier_changed_at::timestamp,b.year_start)
    and coalesce(public.app_add_months(m.tier_changed_at::timestamp,12),b.now_at)
  group by m.member_id
 ), roles as (
  select nid,role,count(*) n from normalized,bounds cross join lateral unnest(roles) role
  where has_member and at>=month_start and at<month_next and role=any(array['인도자','교사','섬김이','협력교사']) group by nid,role
 ), role_maps as (
  select nid,jsonb_object_agg(role,n order by role) counts from roles group by nid
 ), stage_counts as (
  select stage,count(*) n from public.targets t where p_scope->>'kind'='report' and not completed
   and exists(select 1 from members m where m.nid in(t.creator_nid,coalesce(t.leader_nid,'0'),coalesce(t.helper_nid,'0'))) group by stage
 ), chart_source as (
  -- 기존 화면은 원문 번호 trim 일치, 활동 이름 원문을 사용한다. 등급용 이름 보정과 섞지 않는다.
  select public.app_trim(a.member_id) mid,a.activities,a.roles,
   row_number() over(order by date_trunc('second',a.submitted_at) desc,a.id) seq
  from public.activities a where p_scope->>'analysis'='true' and a.member_id<>''
   and a.submitted_at>=(p_scope->>'analysisMonth'||'-01')::date
   and a.submitted_at<(p_scope->>'analysisMonth'||'-01')::date+interval '1 month'
   and exists(select 1 from members m where public.app_trim(m.member_id)=public.app_trim(a.member_id))
 ), chart_groups as (
  select mid,activities,roles,count(*) n,min(seq) first_seq from chart_source group by mid,activities,roles
 )
 select jsonb_build_object(
  'rows',coalesce((select jsonb_agg(to_jsonb(m)||jsonb_build_object(
   'monthlyCount',coalesce(a.monthly_count,0),'lastActivityAt',a.last_at,'recentActivity',coalesce(a.recent_n,0),
   'recentLeads',coalesce(l.recent_n,0),'conditionLeads',coalesce(l.condition_n,0),'reviewLeads',r.n,
   'hasRecords',s.nid is not null or l.nid is not null,'roleCounts',coalesce(ro.counts,'{}')
  ) || case when p_scope->>'kind'='settlement' then jsonb_build_object('lastActivityBefore',a.last_before) else '{}'::jsonb end order by m.sort_order,m.member_id) from members m left join activity a on a.nid=m.nid
   left join seen s on s.nid=m.nid left join lead_counts l on l.nid=m.nid left join reviews r on r.member_id=m.member_id
   left join role_maps ro on ro.nid=m.nid),'[]'),
  'targetStageCounts',coalesce((select jsonb_object_agg(stage,n order by stage) from stage_counts),'{}'),
  'analysisRows',case when p_scope->>'analysis'='true' then coalesce((select jsonb_agg(jsonb_build_object(
    'memberId',mid,'activities',activities,'roles',roles,'count',n) order by first_seq) from chart_groups),'[]') else null end
 );
$$;
revoke all on function public.scope_tier_facts(jsonb,jsonb,jsonb,text[]) from public,anon,authenticated;
grant execute on function public.scope_tier_facts(jsonb,jsonb,jsonb,text[]) to service_role;

-- 미활동/교육 불참: 미래 기록 포함, 빈 활동 배열도 활동함으로 보는 기존 규칙을 보존한다.
create or replace function public.participation_facts(p_from timestamp)
returns jsonb language sql stable security invoker set search_path='' as $$
 with known as(select distinct nid from public.teachers), names as(
  select name,min(nid) nid from public.teachers group by name having count(*)=1
 ), acted as(
  select distinct case when k.nid is not null then a.nid else coalesce(n.nid,a.nid) end nid
  from public.activities a left join known k on k.nid=a.nid
  left join names n on k.nid is null and n.name=public.app_trim(a.name) where a.submitted_at>=p_from
 ), live as materialized(
  select meeting_id,title,date from public.attend_meetings where date>=to_char(p_from,'YYYY-MM-DD') and status<>'삭제'
 ), attended as(select distinct r.nid from public.attend_records r join live m using(meeting_id) where r.at>=p_from)
 select jsonb_build_object(
  'rows',(select coalesce(jsonb_agg(jsonb_build_object('memberId',t.member_id,'name',t.name,'dept',t.dept,'region',t.region,'tier',t.tier,
    'inactive',a.nid is null,'noEdu',e.nid is null) order by t.sort_order,t.member_id),'[]')
   from public.teachers t left join acted a on a.nid=t.nid and a.nid<>'0' left join attended e on e.nid=t.nid),
  'meetings',(select coalesce(jsonb_agg(jsonb_build_object('title',title,'date',date) order by date),'[]') from live)
 );
$$;
revoke all on function public.participation_facts(timestamp) from public,anon,authenticated;
grant execute on function public.participation_facts(timestamp) to service_role;

create or replace function public.activity_item_counts(p_year integer,p_role text,p_fold jsonb,p_raw boolean default false)
returns jsonb language sql stable security invoker set search_path='' as $$
 with items as (
  select case when p_raw then raw else coalesce(p_fold->>public.app_trim(raw),public.app_trim(raw)) end item
  from public.activities a cross join lateral unnest(a.activities) raw
  where member_id<>'' and submitted_at>=make_date(p_year,1,1) and submitted_at<make_date(p_year+1,1,1)
   and (case when p_role<>'' then p_role=any(roles) else not ('협력교사'=any(roles)) end)
 ), counts as(select item,count(*) n from items where item<>'' group by item)
 select coalesce(jsonb_agg(jsonb_build_object('item',item,'n',n) order by item),'[]') from counts;
$$;
revoke all on function public.activity_item_counts(integer,text,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.activity_item_counts(integer,text,jsonb,boolean) to service_role;

create or replace function public.target_stage_counts(p_role text)
returns jsonb language sql stable security invoker set search_path='' as $$
 with counts as(
  select t.stage,count(*) n from public.targets t where not t.completed and (
   p_role='' or (p_role='인도자' and public.app_trim(t.leader_id)<>'') or (p_role='섬김이' and public.app_trim(t.helper_id)<>'')
   or exists(select 1 from public.activities a where a.member_id<>'' and public.app_trim(a.target_name)<>''
    and public.app_trim(a.target_name)=public.app_trim(t.target_name) and p_role=any(a.roles)
    and ((public.app_trim(t.creator_id)<>'' and a.nid=t.creator_nid)
      or (public.app_trim(t.leader_id)<>'' and a.nid=t.leader_nid)
      or (public.app_trim(t.helper_id)<>'' and a.nid=t.helper_nid)))
  ) group by t.stage
 ) select coalesce(jsonb_agg(jsonb_build_object('stage',stage,'n',n) order by stage),'[]') from counts;
$$;
revoke all on function public.target_stage_counts(text) from public,anon,authenticated;
grant execute on function public.target_stage_counts(text) to service_role;

-- AI가 실제 사용하는 필드만 전달한다. trim 일치/담당자 범위와 기록 순서는 기존과 같다.
create or replace view public.target_dossier_activities with(security_invoker=true) as
 select id,nid,public.app_trim(target_name) target_key,submitted_at,roles,activities,target_stage,
  consult_title,gospel_subject,reaction,reaction_note,today_work,next_work,special_note from public.activities;
revoke all on public.target_dossier_activities from public,anon,authenticated;
grant select on public.target_dossier_activities to service_role;
create index if not exists activities_nid_target_trim_id_idx on public.activities(nid,public.app_trim(target_name),id);

-- 전체 건수는 세되 AI 문자 예산에 필요한 최근 본문만 읽는다.
create or replace function public.target_coaching_page(p_owners text[],p_name text,p_mask text,p_unique boolean,p_offset integer,p_limit integer,p_through bigint)
returns jsonb language sql stable security invoker set search_path='' as $$
 with matched as materialized(
  select id,submitted_at from public.feedbacks where nid=any(p_owners) and p_name<>'' and (p_through is null or id<=p_through)
   and (strpos(coalesce(situation,''),p_name)>0 or (p_unique and length(p_mask)>1 and strpos(coalesce(situation,''),p_mask)>0))
 ), page as(
  select id from matched order by submitted_at desc nulls first,id desc offset greatest(p_offset,0) limit least(greatest(p_limit,1),50)
 ) select jsonb_build_object('total',(select count(*) from matched),'through',(select max(id) from matched),'rows',coalesce((
  select jsonb_agg(jsonb_build_object('submitted_at',f.submitted_at,'source',f.source,'situation',f.situation,
   'ai_coach_text',f.ai_coach_text,'handler_answer',f.handler_answer,'handler',f.handler) order by f.submitted_at desc nulls first,f.id desc)
  from page p join public.feedbacks f on f.id=p.id),'[]'));
$$;
revoke all on function public.target_coaching_page(text[],text,text,boolean,integer,integer,bigint) from public,anon,authenticated;
grant execute on function public.target_coaching_page(text[],text,text,boolean,integer,integer,bigint) to service_role;
