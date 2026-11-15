-- 원본을 바꾸지 않는 읽기 전용 집계. JS trim/월 넘김 규칙을 그대로 유지한다.
create or replace function public.app_trim(v text) returns text language sql immutable strict
security invoker set search_path = '' as $$
 select btrim(v,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
$$;
create or replace function public.app_add_months(v timestamp,n integer) returns timestamp language sql immutable strict
security invoker set search_path = '' as $$
 select date_trunc('month',v) + make_interval(months=>n) + (extract(day from v)::int-1)*interval '1 day' + (v-v::date);
$$;
revoke all on function public.app_trim(text),public.app_add_months(timestamp,integer) from public,anon,authenticated;
grant execute on function public.app_trim(text),public.app_add_months(timestamp,integer) to service_role;

create index if not exists attend_records_at_nid_idx on public.attend_records(at,nid);

create or replace function public.teacher_report_facts(p_bounds jsonb,p_aliases jsonb,p_groups jsonb,p_rest text[])
returns jsonb language sql stable security invoker set search_path = '' as $$
 with bounds as (
  select (p_bounds->>'now')::timestamp as now_at,(p_bounds->>'monthStart')::timestamp as month_start,
   (p_bounds->>'monthEnd')::timestamp as month_end,(p_bounds->>'prevStart')::timestamp as prev_start,
   (p_bounds->>'prevEnd')::timestamp as prev_end,(p_bounds->>'recentStart')::timestamp as recent_start,
   (p_bounds->>'yearStart')::timestamp as year_start,(p_bounds->>'leadYearStart')::date as lead_year_start
 ), known as (select distinct nid from public.teachers), names as (
  select name,min(nid) nid from public.teachers group by name having count(*)=1
 ), normalized as (
  select case when k.nid is not null then a.nid else coalesce(n.nid,a.nid) end nid,
   date_trunc('milliseconds',a.submitted_at) submitted_at,coalesce(p_aliases->>public.app_trim(raw),public.app_trim(raw)) type
  from public.activities a left join known k on k.nid=a.nid
  left join names n on n.name=public.app_trim(a.name) and k.nid is null
  cross join lateral unnest(a.activities) raw
  where a.submitted_at is not null and isfinite(a.submitted_at)
 ), types as materialized (
  select nid,type,count(*) total,max(submitted_at) last_at,
   count(*) filter(where submitted_at between b.month_start and b.month_end) month_n,
   count(*) filter(where submitted_at between b.prev_start and b.prev_end) prev_n,
   count(*) filter(where submitted_at>=b.recent_start and type=any(p_rest)) recent_n
  from normalized,bounds b where nid<>'0' and type<>'' group by nid,type
 ), activity as (
  select nid,sum(total) total,max(last_at) last_at,sum(month_n) month_n,sum(prev_n) prev_n,sum(recent_n) recent_n,
   jsonb_object_agg(type,total order by type) act_types from types group by nid
 ), groups as (
  select nid,p_groups->>type g,sum(total) total,sum(month_n) month_n,sum(prev_n) prev_n
  from types where p_groups ? type group by nid,p_groups->>type
 ), group_maps as (
  select nid,jsonb_object_agg(g,total order by g) groups,
   coalesce(jsonb_object_agg(g,month_n order by g) filter(where month_n>0),'{}') month_groups,
   coalesce(jsonb_object_agg(g,prev_n order by g) filter(where prev_n>0),'{}') prev_groups from groups group by nid
 ), leads as (
  select nid,count(*) filter(where lead_date>=b.lead_year_start) year_n,
   count(*) filter(where lead_date::timestamp>=b.year_start) condition_n,
   count(*) filter(where lead_date::timestamp between b.year_start and b.now_at) recent_n
  from public.center_leads,bounds b where nid<>'0' and lead_date is not null group by nid
 ), reviews as (
  select t.member_id,
   count(l.id) n from public.teachers t cross join bounds b
   left join public.center_leads l on l.nid=t.nid and l.nid<>'0'
    and l.lead_date::timestamp between coalesce(t.tier_changed_at::timestamp,b.year_start)
     and coalesce(public.app_add_months(t.tier_changed_at::timestamp,12),b.now_at)
   group by t.member_id,t.tier_changed_at,b.now_at
 ), profiles as (
  select distinct on(nid) nid,available,schedule_type,avail_to,avail_from,avail_roles,avail_days,avail_times,avail_hours,affil,gender
  from public.teacher_profiles order by nid,id desc
 ), cases as (
  select public.norm_id(member_id) nid,count(*) n from public.plaza_posts
  where category in ('사례','성공사례','실패사례') and status<>'삭제' group by public.norm_id(member_id)
 ), cards as (select distinct nid from public.connect_cards where member_id<>''), attends as (
  select nid,count(*) n from public.attend_records,bounds b where at>=date_trunc('second',b.recent_start) group by nid
 )
 select coalesce(jsonb_agg(jsonb_build_object(
  'memberId',t.member_id,'monthlyCount',coalesce(a.month_n,0),'actTotal',coalesce(a.total,0),
  'prevCount',coalesce(a.prev_n,0),'recentActivity',coalesce(a.recent_n,0),
  'actTypes',coalesce(a.act_types,'{}'),'lastActivityDate',coalesce(a.last_at::date::text,''),
  'groups',coalesce(g.groups,'{}'),'groupsMonth',coalesce(g.month_groups,'{}'),'groupsPrev',coalesce(g.prev_groups,'{}'),
  'leads1y',coalesce(l.year_n,0),'recentLeads',coalesce(l.recent_n,0),'conditionLeads',coalesce(l.condition_n,0),
  'reviewLeads',r.n,'profile',case when p.nid is null then null else to_jsonb(p)-'nid' end,
  'visits',coalesce(v.visits,0),'lastVisit',v.last_at,'card',c.nid is not null,'cases',coalesce(ca.n,0),'attend1m',coalesce(at.n,0)
 ) order by t.sort_order,t.member_id),'[]') from public.teachers t
 left join activity a on a.nid=t.nid left join group_maps g on g.nid=t.nid
 left join leads l on l.nid=t.nid left join reviews r on r.member_id=t.member_id
 left join profiles p on p.nid=t.nid left join public.app_visits v on v.nid=t.nid
 left join cards c on c.nid=t.nid left join cases ca on ca.nid=t.nid left join attends at on at.nid=t.nid
 where a.nid is not null or l.nid is not null or p.nid is not null or v.nid is not null or c.nid is not null or ca.nid is not null or at.nid is not null;
$$;
revoke all on function public.teacher_report_facts(jsonb,jsonb,jsonb,text[]) from public,anon,authenticated;
grant execute on function public.teacher_report_facts(jsonb,jsonb,jsonb,text[]) to service_role;
