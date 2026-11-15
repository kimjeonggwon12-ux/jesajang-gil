-- 기존 '#excused' 저장 위치는 유지한다. 명단 교체와 이력은 한 트랜잭션이다.
create table public.edu_excused_changes (
  id bigint generated always as identity primary key,
  kind text not null check(kind in ('화전단','목사교')),
  date text not null,
  actor_id text not null, actor_name text not null, reason text not null,
  before_nids text[] not null, after_nids text[] not null,
  created_at timestamptz not null default now()
);
create index edu_excused_changes_scope_idx on public.edu_excused_changes(kind,date,id desc);
alter table public.edu_excused_changes enable row level security;
revoke all on public.edu_excused_changes from public,anon,authenticated;
grant all on public.edu_excused_changes to service_role;
grant usage,select on sequence public.edu_excused_changes_id_seq to service_role;

create function public.edu_excused_state(p_kind text,p_date text) returns jsonb
language sql stable security invoker set search_path='' as $fn$
  with series as (
    select series_id,title,roster_key from public.attend_series where status<>'삭제'
  ), candidates as (
    -- 날짜 전에 등록하는 경우에도 연결된 정기 교육 전부의 권한을 확인한다.
    select 'series'::text as type,series_id as id,title from series
    where (case when title ~ '화요전도단|화전단' then '화전단'
      when roster_key='목요사명자' then '목사교' end)=p_kind
    union
    select case when coalesce(m.cohort_id,'')<>'' then 'cohort'
      when coalesce(m.series_id,'')<>'' then 'series' else 'meeting' end,
      coalesce(nullif(m.cohort_id,''),nullif(m.series_id,''),m.meeting_id),
      coalesce(c.title,s.title,m.title)
    from public.attend_meetings m
    left join series s on s.series_id=m.series_id
    left join public.cohorts c on c.cohort_id=m.cohort_id
    where m.status<>'삭제' and m.date=p_date
      and (coalesce(m.series_id,'')='' or s.series_id is not null)
      and (coalesce(m.cohort_id,'')='' or c.status<>'삭제')
      and (case when m.title ~ '화요전도단|화전단' then '화전단'
        when s.roster_key='목요사명자' then '목사교' end)=p_kind
  ), scopes as (select type,id,min(title) as title from candidates group by type,id),
  state as (select jsonb_build_object(
    'kind',p_kind,'date',p_date,
    'people',coalesce((select jsonb_agg(to_jsonb(r) order by r.sort_order,r.id)
      from public.edu_roster r where r.roster_key='목요사명자' and r.dept='24부서'),'[]'::jsonb),
    'selected',coalesce((select jsonb_agg(ref_id order by ref_id) from public.cohort_summary_log
      where cohort_id='#excused' and kind=p_kind and date=p_date),'[]'::jsonb),
    'scopes',coalesce((select jsonb_agg(to_jsonb(s) order by s.type,s.id) from scopes s),'[]'::jsonb),
    'lastChange',coalesce((select max(id) from public.edu_excused_changes where kind=p_kind and date=p_date),0),
    'accessRevision',md5(jsonb_build_array(
      (select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]'::jsonb) from public.admins a),
      (select coalesce(jsonb_agg(to_jsonb(d) order by d.id),'[]'::jsonb) from public.education_delegations d))::text)
  ) as value)
  select value||jsonb_build_object('revision',md5(value::text)) from state;
$fn$;

create function public.edu_excused_apply(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path=''
set lock_timeout='3s' set statement_timeout='15s' as $fn$
declare state jsonb; chosen text[]; change_id bigint; v_day text:=p->>'date'; v_kind text:=p->>'kind';
begin
  -- 순서를 기존 재적 교체 함수와 맞춘다. 구형 도구가 쓰는 표도 함께 보호한다.
  lock table public.admins,public.education_delegations,public.attend_series,
    public.attend_meetings,public.cohorts,public.edu_roster,public.cohort_summary_log in share row exclusive mode;
  state:=public.edu_excused_state(v_kind,v_day);
  if coalesce(p->>'revision','')='' or p->>'revision'<>state->>'revision' then
    return jsonb_build_object('error','명단·선택·교육 범위 또는 권한이 바뀌었어요. 다시 조회해 주세요.','stale',true);
  end if;
  if v_kind is null or v_kind not in ('화전단','목사교') or coalesce(v_day,'') !~ '^\d{4}-\d{2}-\d{2}$'
    or v_day::date::text<>v_day or jsonb_typeof(p->'nids') is distinct from 'array'
    or jsonb_array_length(p->'nids')>10000 or coalesce(btrim(p->>'actorId'),'')=''
    or coalesce(btrim(p->>'reason'),'')='' or length(p->>'reason')>500 then raise exception 'invalid excused change'; end if;
  chosen:=array(select jsonb_array_elements_text(p->'nids') order by 1);
  if cardinality(chosen)<>(select count(distinct n) from unnest(chosen) n)
    or exists(select 1 from unnest(chosen) n where n is null or not exists(
      select 1 from public.edu_roster r where r.roster_key='목요사명자' and r.dept='24부서' and r.nid=n))
    then raise exception 'invalid excused member'; end if;
  insert into public.edu_excused_changes(kind,date,actor_id,actor_name,reason,before_nids,after_nids)
    values(v_kind,v_day,p->>'actorId',p->>'actorName',p->>'reason',array(select jsonb_array_elements_text(state->'selected')),chosen)
    returning id into change_id;
  delete from public.cohort_summary_log l where l.cohort_id='#excused' and l.kind=v_kind and l.date=v_day;
  insert into public.cohort_summary_log(cohort_id,kind,ref_id,date,sent_at)
    select '#excused',v_kind,n,v_day,timezone('Asia/Seoul',now()) from unnest(chosen) n;
  return jsonb_build_object('ok',true,'changeId',change_id,'count',cardinality(chosen));
end $fn$;
revoke all on function public.edu_excused_state(text,text),public.edu_excused_apply(jsonb) from public,anon,authenticated;
grant execute on function public.edu_excused_state(text,text),public.edu_excused_apply(jsonb) to service_role;
