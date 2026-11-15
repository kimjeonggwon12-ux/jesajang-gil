-- RS의 재적/집계 기준은 새 명시 위임으로 분리한다. 기존 위임에는 자동 추가하지 않는다.
do $do$ declare c record; begin
  for c in select conname from pg_constraint where conrelid='public.education_delegations'::regclass and contype='c'
    and pg_get_constraintdef(oid) like '%scope_type%' and pg_get_constraintdef(oid) like '%permissions%'
  loop execute format('alter table public.education_delegations drop constraint %I',c.conname); end loop;
end $do$;
alter table public.education_delegations add constraint education_scope_tasks_check check (
  scope_type='cohort' or (scope_type='series' and permissions <@ array['settings','members','attendance','reports']::text[])
  or (scope_type='meeting' and permissions <@ array['attendance','reports']::text[]));

create table public.edu_roster_changes (
  id bigint generated always as identity primary key,
  roster_key text not null, series_id text not null, kind text not null check(kind in ('import','settings')),
  actor_id text not null, actor_name text not null, source text not null,
  before_state jsonb not null, after_summary jsonb not null,
  created_at timestamptz not null default now()
);
create index edu_roster_changes_key_idx on public.edu_roster_changes(roster_key,id desc);
alter table public.edu_roster_changes enable row level security;
revoke all on public.edu_roster_changes from public,anon,authenticated;
grant all on public.edu_roster_changes to service_role;
grant usage,select on sequence public.edu_roster_changes_id_seq to service_role;

create function public.edu_roster_admin_state(p_series text,p_key text default null) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $fn$
  with current_series as (select * from public.attend_series where series_id=p_series and status<>'삭제'),
  selected as (select coalesce(p_key,roster_key) as key from current_series),
  state as (select jsonb_build_object(
    'series',(select to_jsonb(s) from current_series s), 'key',(select key from selected),
    'rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.sort_order,r.id) from public.edu_roster r where r.roster_key=(select key from selected)),'[]'::jsonb),
    'policy',(select to_jsonb(p) from public.edu_roster_policy p where p.roster_key=(select key from selected)),
    'linked',coalesce((select jsonb_agg(to_jsonb(s) order by s.series_id) from public.attend_series s where s.roster_key=(select key from selected) and s.roster_key<>'' and s.status<>'삭제'),'[]'::jsonb),
    'accessRevision',md5(jsonb_build_array(
      (select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]'::jsonb) from public.admins a),
      (select coalesce(jsonb_agg(to_jsonb(d) order by d.id),'[]'::jsonb) from public.education_delegations d))::text)
  ) as value) select value || jsonb_build_object('revision',md5(value::text)) from state;
$fn$;

create function public.edu_roster_apply_reviewed(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path=public,pg_temp
set lock_timeout='5s' set statement_timeout='30s' as $fn$
declare state jsonb; k text:=p->>'key'; change_id bigint; amount integer; policy jsonb;
begin
  -- 전체 교체는 드문 관리 작업이다. 읽기는 허용하고 기존 도구/개별 쓰기도 함께 직렬화한다.
  lock table public.admins,public.education_delegations,public.attend_series,public.edu_roster,public.edu_roster_policy in share row exclusive mode;
  state:=public.edu_roster_admin_state(p->>'seriesId',k);
  if state->'series'='null'::jsonb or coalesce(p->>'revision','')='' or p->>'revision'<>state->>'revision' then
    return jsonb_build_object('error','명단·설정·권한이 바뀌었어요. 다시 미리보기를 확인해 주세요.','stale',true);
  end if;
  if coalesce(k,'')='' or length(k)>80 or coalesce(p->>'source','')='' or p->>'kind' not in ('import','settings') then raise exception 'invalid reviewed education change'; end if;
  if p->>'kind'='import' then
    if jsonb_typeof(p->'rows') is distinct from 'array' then raise exception 'invalid roster'; end if;
    amount:=jsonb_array_length(p->'rows');
    if amount<1 or amount>10000 then raise exception 'invalid roster size'; end if;
    if exists(select 1 from jsonb_to_recordset(p->'rows') r(member_id text,name text,dept text)
      where coalesce(r.member_id,'') !~ '^[0-9]{6,8}-?[0-9]{4,5}$' or coalesce(btrim(r.name),'')='' or coalesce(btrim(r.dept),'')='') then raise exception 'invalid roster row'; end if;
    if amount<>(select count(distinct public.norm_id(r->>'member_id')) from jsonb_array_elements(p->'rows') r) then raise exception 'duplicate roster id'; end if;
  elsif jsonb_typeof(p->'policy') is distinct from 'object' or p->>'mode' not in ('live','room','test') then raise exception 'invalid education settings';
  end if;
  insert into public.edu_roster_changes(roster_key,series_id,kind,actor_id,actor_name,source,before_state,after_summary)
    values(k,p->>'seriesId',p->>'kind',p->>'actorId',p->>'actorName',p->>'source',state,p->'summary') returning id into change_id;
  if p->>'kind'='import' then
    delete from public.edu_roster where roster_key=k;
    insert into public.edu_roster(roster_key,member_id,name,dept,region,district,affiliation,position,sort_order,updated_at)
      select k,r.member_id,r.name,r.dept,r.region,r.district,r.affiliation,r.position,r.sort_order,timezone('Asia/Seoul',now())
      from jsonb_to_recordset(p->'rows') r(member_id text,name text,dept text,region text,district text,affiliation text,position text,sort_order integer);
  else
    if not exists(select 1 from public.edu_roster where roster_key=k) then raise exception 'empty roster cannot be linked'; end if;
    policy:=p->'policy';
    insert into public.edu_roster_policy(roster_key,excluded_positions,always_present_nids,dept_overrides,source_note,updated_at)
      values(k,array(select jsonb_array_elements_text(policy->'excluded_positions')),array(select jsonb_array_elements_text(policy->'always_present_nids')),policy->'dept_overrides',policy->>'source_note',now())
      on conflict(roster_key) do update set excluded_positions=excluded.excluded_positions,always_present_nids=excluded.always_present_nids,dept_overrides=excluded.dept_overrides,source_note=excluded.source_note,updated_at=excluded.updated_at;
    update public.attend_series set roster_key=k,summary_to=p->>'mode',updated_at=timezone('Asia/Seoul',now()) where series_id=p->>'seriesId';
  end if;
  return jsonb_build_object('ok',true,'changeId',change_id,'count',(select count(*) from public.edu_roster where roster_key=k));
end $fn$;
revoke all on function public.edu_roster_admin_state(text,text),public.edu_roster_apply_reviewed(jsonb) from public,anon,authenticated;
grant execute on function public.edu_roster_admin_state(text,text),public.edu_roster_apply_reviewed(jsonb) to service_role;
