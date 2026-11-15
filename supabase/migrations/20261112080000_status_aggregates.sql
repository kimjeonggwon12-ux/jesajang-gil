-- 개인 등급·지역·전체 현황의 읽기 집계. 기존 원본/자동 등급 전환은 변경하지 않는다.
create or replace function public.personal_tier_facts(p_nid text,p_bounds jsonb,p_aliases jsonb)
returns jsonb language sql stable security invoker set search_path = '' as $$
 with bounds as (
  select (p_bounds->>'monthStart')::timestamp month_start,
   (p_bounds->>'monthEnd')::timestamp month_end,
   (p_bounds->>'ruleStart')::date rule_start,(p_bounds->>'ruleEnd')::date rule_end
 ), own as materialized (
  select date_trunc('milliseconds',submitted_at) at,activities from public.activities where nid=p_nid
 ), items as (
  select at,coalesce(p_aliases->>public.app_trim(raw),public.app_trim(raw)) type
  from own cross join lateral unnest(activities) raw where p_nid<>'0' and at is not null and isfinite(at)
 )
 select jsonb_build_object(
  'monthlyCount',(select count(*) from items,bounds where type<>'' and at between month_start and month_end),
  'lastActivityAt',(select max(at) from items where type<>''),
  'recentRecords',(select count(*) from own,bounds where at::date between rule_start and rule_end)
 );
$$;
revoke all on function public.personal_tier_facts(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.personal_tier_facts(text,jsonb,jsonb) to service_role;

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
  select nid,count(*) filter(where at between b.month_start and b.month_end) monthly_count,max(at) last_at,
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
  ) order by m.sort_order,m.member_id) from members m left join activity a on a.nid=m.nid
   left join seen s on s.nid=m.nid left join lead_counts l on l.nid=m.nid left join reviews r on r.member_id=m.member_id
   left join role_maps ro on ro.nid=m.nid),'[]'),
  'targetStageCounts',coalesce((select jsonb_object_agg(stage,n order by stage) from stage_counts),'{}'),
  'analysisRows',case when p_scope->>'analysis'='true' then coalesce((select jsonb_agg(jsonb_build_object(
    'memberId',mid,'activities',activities,'roles',roles,'count',n) order by first_seq) from chart_groups),'[]') else null end
 );
$$;
revoke all on function public.scope_tier_facts(jsonb,jsonb,jsonb,text[]) from public,anon,authenticated;
grant execute on function public.scope_tier_facts(jsonb,jsonb,jsonb,text[]) to service_role;
