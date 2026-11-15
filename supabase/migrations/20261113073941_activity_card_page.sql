-- 활동 카드 전용: 검색·정렬·누적 회차는 기존 상세 페이지와 같고 본문은 전송하지 않는다.
-- 운영 미반영. 기존 상세 함수/호출 계약과 원본 기록은 그대로 유지한다.
create or replace function public.my_activity_card_page(
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
 select jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'submitted_at',a.submitted_at,'activities',a.activities,'roles',a.roles,
   'target_name',a.target_name,'target_stage',a.target_stage,'sequence',s.sequence,
   'lesson',a.report->'lesson','gospel_subject',a.gospel_subject,'consult_title',a.consult_title,
   'today_work',left(a.today_work,160),'has_ai_feedback',coalesce(a.ai_feedback,'')<>'') order by s.at desc nulls last,s.id)
  from slice s join public.activities a on a.id=s.id),'[]'),'total',total,'page',page,'pages',pages,'limit',lim,'through',through) from paging;
$$;
revoke all on function public.my_activity_card_page(text,text,text,integer,integer,bigint,boolean) from public,anon,authenticated;
grant execute on function public.my_activity_card_page(text,text,text,integer,integer,bigint,boolean) to service_role;
