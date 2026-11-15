-- 활동 목록: 본문은 페이지/상세에서, 누적 현황은 가벼운 색인에서 읽는다.
-- 운영에는 별도 검증·승인 후 적용. 기존 표/기록/Telegram 처리 변경 없음.
create index if not exists activities_owner_page_idx
  on public.activities (nid, submitted_at desc nulls last, id asc);
create index if not exists activities_owner_target_page_idx
  on public.activities (nid, btrim(target_name), submitted_at desc nulls last, id asc);

create or replace view public.activity_list_index with (security_invoker = true) as
select id, member_id, nid, name, submitted_at, activities, roles,
  target_name, target_gender, target_age_group, target_stage, target_dept,
  today_work, consult_title, gospel_subject, edited_at, tg_posts, ai_feedback, ai_feedback_at,
  jsonb_build_object('lesson', report->'lesson', 'photos', report->'photos') as report,
  coalesce(report_text, '') <> '' as has_report_text
from public.activities;
revoke all on public.activity_list_index from public, anon, authenticated;
grant select on public.activity_list_index to service_role;

create or replace function public.my_activity_page(
  p_nid text, p_query text default '', p_target text default null,
  p_page integer default 1, p_limit integer default 20, p_through bigint default null
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with bounds as (
    select greatest(1, least(coalesce(p_limit,20),50)) as lim,
      coalesce(p_through, (select max(id) from public.activities where nid = p_nid), 0) as through
  ), matches as materialized (
    select a.id, a.submitted_at from public.activities a, bounds b
    where a.nid = p_nid and a.id <= b.through
      and (p_target is null or btrim(a.target_name) = p_target)
      and (coalesce(p_query,'') = '' or strpos(lower(concat_ws(' ',
        a.target_name, a.submitted_at::date::text, array_to_string(a.activities,' '),
        array_to_string(a.roles,' '), a.today_work, a.next_work, a.note,
        a.consult_title, a.gospel_subject, a.report_text)), lower(p_query)) > 0)
  ), counts as (select count(*) as total from matches), paging as (
    select total, lim, through, greatest(1, ceil(total::numeric/lim)::int) as pages,
      least(greatest(1,coalesce(p_page,1)), greatest(1,ceil(total::numeric/lim)::int)) as page
    from counts, bounds
  ), slice as (
    select id, submitted_at from matches order by submitted_at desc nulls last, id asc
    limit (select lim from paging) offset (select (page-1)*lim from paging)
  )
  select jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(a) order by s.submitted_at desc nulls last,s.id)
    from slice s join public.activities a on a.id=s.id), '[]'::jsonb),
    'total',total,'page',page,'pages',pages,'limit',lim,'through',through) from paging;
$$;
revoke all on function public.my_activity_page(text,text,text,integer,integer,bigint) from public, anon, authenticated;
grant execute on function public.my_activity_page(text,text,text,integer,integer,bigint) to service_role;
