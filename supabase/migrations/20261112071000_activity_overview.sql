-- 본인 누적 활동은 기록 전체 대신 대상자별 요약을 반환한다. 기록/피드백 원문은 별도 페이지.
-- 본인 최대 ID/조회 상한을 다른 사람의 PK 범위까지 훑지 않고 찾는다.
create index if not exists activities_owner_id_idx on public.activities(nid,id);
create index if not exists activities_feedback_owner_idx on public.activities(nid,id) include(submitted_at,ai_feedback_at) where ai_feedback<>'';

create or replace function public.my_activity_overview(p_nid text,p_year integer,p_edu text[])
returns jsonb language sql stable security invoker set search_path = '' as $$
 with feedback as materialized (
  select id,ai_feedback_at from public.activities where nid=p_nid and ai_feedback<>''
 ), base as materialized (
  select a.id,date_trunc('second',a.submitted_at) at,a.activities,a.roles,
   public.app_trim(a.target_name) nm,a.target_name raw_name,a.target_stage,
   f.id is not null has_fb,f.ai_feedback_at,
   (select x from jsonb_array_elements(coalesce(a.tg_posts,'[]')) x where x->>'kind'='post' limit 1) post
  from public.activities a left join feedback f on f.id=a.id where a.nid=p_nid
 ), people as (
  select nm,count(*) total,count(*) filter(where activities && p_edu) edu,
   count(*) filter(where has_fb) fb_n,count(post) posted_n,max(at) last_at
  from base where nm<>'' group by nm
 ), stages as (
  select nm,jsonb_agg(distinct st) candidates from base
   cross join lateral unnest(activities || array[target_stage]) st where nm<>'' and st is not null group by nm
 ), latest as (
  select distinct on(nm) nm,id,at from base where nm<>'' order by nm,at desc nulls last,id desc
 ), first_recent as (
  select distinct on(nm) nm,id from base where nm<>'' order by nm,at desc nulls last,id asc
 ), latest_fb as (
  select distinct on(nm) nm,ai_feedback_at from base where nm<>'' and has_fb order by nm,at desc nulls last,id desc
 ), latest_post as (
  select distinct on(nm) nm,post from base where nm<>'' and post is not null order by nm,at desc nulls last,id desc
 ), year_rows as materialized (
  select * from base where at>=make_date(p_year,1,1) and at<make_date(p_year+1,1,1)
 ), role_counts as (
  select role,count(*) n from year_rows cross join lateral unnest(roles) role group by role
 ), role_items as (
  select role,jsonb_object_agg(item,n) items from (
   select role,item,count(*) n from year_rows cross join lateral unnest(roles) role
    cross join lateral unnest(activities) item where item is not null and item<>'' group by role,item
  ) s group by role
 ), raw_names as (
  select raw_name,count(*) n from base group by raw_name
 ), raw_roles as (
  select raw_name,jsonb_agg(distinct role) roles from base cross join lateral unnest(roles) role group by raw_name
 )
 select jsonb_build_object('total',(select count(*) from base),
  'people',coalesce((select jsonb_agg(jsonb_build_object(
    'name',p.nm,'total',p.total,'edu',p.edu,'feedbackCount',p.fb_n,'postedCount',p.posted_n,
    'stageCandidates',coalesce(s.candidates,'[]'),'last',coalesce(to_char(p.last_at,'YYYY-MM-DD HH24:MI:SS'),''),
    'lastFeedbackAt',coalesce(to_char(f.ai_feedback_at,'YYYY-MM-DD HH24:MI:SS'),''),'lastPost',lp.post,
    'latest',jsonb_build_object('id',a.id,'submittedAt',coalesce(to_char(date_trunc('second',a.submitted_at),'YYYY-MM-DD HH24:MI:SS'),''),
     'activities',a.activities,'roles',a.roles,'targetName',a.target_name,'targetStage',a.target_stage,
     'tgPosts',coalesce(a.tg_posts,'[]'),'hasReportText',coalesce(a.report_text,'')<>'',
     'hasAiFeedback',coalesce(a.ai_feedback,'')<>'','aiFeedbackAt',coalesce(to_char(a.ai_feedback_at,'YYYY-MM-DD HH24:MI:SS'),''),'_summary',true)
   ) order by p.last_at desc nulls last,fr.id) from people p join latest l on l.nm=p.nm
    join public.activities a on a.id=l.id join first_recent fr on fr.nm=p.nm
    left join stages s on s.nm=p.nm left join latest_fb f on f.nm=p.nm left join latest_post lp on lp.nm=p.nm),'[]'),
  'roleCounts',coalesce((select jsonb_object_agg(role,n) from role_counts),'{}'),
  'roleItemCounts',coalesce((select jsonb_object_agg(role,items) from role_items),'{}'),
  'names',coalesce((select jsonb_agg(jsonb_build_object('name',n.raw_name,'total',n.n,'roles',coalesce(r.roles,'[]'))) from raw_names n left join raw_roles r on r.raw_name=n.raw_name),'[]'),
  'coopRecords',coalesce((select jsonb_agg(jsonb_build_object('id',id,'submittedAt',to_char(at,'YYYY-MM-DD HH24:MI:SS'),'activities',activities,'targetName',raw_name) order by at desc nulls last,id)
    from year_rows where '협력교사'=any(roles)),'[]'));
$$;
revoke all on function public.my_activity_overview(text,integer,text[]) from public,anon,authenticated;
grant execute on function public.my_activity_overview(text,integer,text[]) to service_role;

-- 회차는 검색 이전 대상자 전체에서 계산한다. 피드백만 보기에도 같은 회차를 유지한다.
create or replace function public.my_activity_detail_page(
 p_nid text,p_query text,p_target text,p_page integer,p_limit integer,p_through bigint,p_feedback boolean
) returns jsonb language sql stable security invoker set search_path = '' as $$
 with bounds as (
  select greatest(1,least(coalesce(p_limit,20),50)) lim,
   coalesce(p_through,(select max(id) from public.activities where nid=p_nid),0) through
 ), ordered as materialized (
  select a.id,date_trunc('second',a.submitted_at) at,
   row_number() over(order by date_trunc('second',a.submitted_at) asc nulls first,a.id) sequence
  from public.activities a,bounds b where a.nid=p_nid and a.id<=b.through
   and (p_target is null or public.app_trim(a.target_name)=p_target)
 ), matches as materialized (
  select o.* from ordered o
  where (not coalesce(p_feedback,false) and coalesce(p_query,'')='') or exists (
   select 1 from public.activities a where a.nid=p_nid and a.id=o.id and (not coalesce(p_feedback,false) or a.ai_feedback<>'')
   and (coalesce(p_query,'')='' or strpos(lower(concat_ws(' ',a.target_name,a.submitted_at::date::text,
    array_to_string(a.activities,' '),array_to_string(a.roles,' '),a.today_work,a.next_work,a.note,
    a.consult_title,a.gospel_subject,a.report_text,case when p_feedback then a.ai_feedback else '' end)),lower(p_query))>0))
 ), counts as (select count(*) total from matches), paging as (
  select total,lim,through,greatest(1,ceil(total::numeric/lim)::int) pages,
   least(greatest(1,coalesce(p_page,1)),greatest(1,ceil(total::numeric/lim)::int)) page from counts,bounds
 ), slice as (
  select * from matches order by at desc nulls last,id asc
   limit (select lim from paging) offset (select (page-1)*lim from paging)
 )
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('sequence',s.sequence) order by s.at desc nulls last,s.id)
  from slice s join public.activities a on a.id=s.id),'[]'),'total',total,'page',page,'pages',pages,'limit',lim,'through',through) from paging;
$$;
revoke all on function public.my_activity_detail_page(text,text,text,integer,integer,bigint,boolean) from public,anon,authenticated;
grant execute on function public.my_activity_detail_page(text,text,text,integer,integer,bigint,boolean) to service_role;
