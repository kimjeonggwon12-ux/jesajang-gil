-- 동일 업무 DB 안에서 화면 배정만 관리한다. 기존 업무 표/예약/보고 대상은 바꾸지 않는다.
create table public.site_pilot_policy (
 id integer primary key check(id=1), enabled boolean not null default false,
 version bigint not null default 1, updated_at timestamptz not null default now()
);
insert into public.site_pilot_policy(id) values(1);
create table public.site_pilot_members (
 nid text primary key, assigned_at timestamptz not null default now()
);
create table public.site_pilot_changes (
 id bigint generated always as identity primary key, changed_at timestamptz not null default now(),
 actor_id text not null, actor_name text not null, operation text not null,
 targets jsonb not null, reason text not null, version bigint not null
);
alter table public.site_pilot_policy enable row level security;
alter table public.site_pilot_members enable row level security;
alter table public.site_pilot_changes enable row level security;
revoke all on public.site_pilot_policy,public.site_pilot_members,public.site_pilot_changes from public,anon,authenticated;
grant all on public.site_pilot_policy,public.site_pilot_members,public.site_pilot_changes to service_role;
revoke all on sequence public.site_pilot_changes_id_seq from public,anon,authenticated;
grant usage,select on sequence public.site_pilot_changes_id_seq to service_role;

create function public.site_pilot_route(p_nid text) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('site',case when enabled and exists(select 1 from public.site_pilot_members where nid=p_nid) then 'B' else 'A' end,'version',version)
 from public.site_pilot_policy where id=1;
$$;

create function public.site_pilot_search(p_query text,p_selected boolean,p_page integer,p_sort text) returns jsonb
language sql stable security invoker set search_path='' as $$
 with people as (
  select distinct on(nid) * from (
   select nid,member_id,name,dept,region,0 priority from public.teachers
   union all select nid,member_id,name,dept,region,1 from public.admins
  ) t order by nid,priority,member_id
 ), filtered as (
  select t.*,m.nid is not null selected,coalesce(v.visits,0) visits,v.last_at
  from people t left join public.site_pilot_members m using(nid) left join public.app_visits v using(nid)
  where (not p_selected or m.nid is not null)
   and (coalesce(p_query,'')='' or strpos(lower(t.name||' '||t.dept||' '||t.region),lower(p_query))>0)
 ), paged as (
  select * from filtered order by case when p_sort='recent' then last_at end desc nulls last,
   case when p_sort='visits' then visits end desc,name,nid
  limit 25 offset greatest(0,least(p_page,10000))*25
 ) select jsonb_build_object('total',(select count(*) from filtered),'page',p_page,'pageSize',25,
  'rows',coalesce((select jsonb_agg(jsonb_build_object('memberId',member_id,'name',name,'dept',dept,'region',region,'selected',selected,'visits',visits,'lastAt',last_at)) from paged),'[]'::jsonb));
$$;

create function public.site_pilot_apply(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path='' set lock_timeout='3s' set statement_timeout='10s' as $$
declare pol public.site_pilot_policy; op text:=p->>'operation'; target text; targets jsonb:='[]'; who record;
begin
 if op not in ('start','stop','assign','remove') or coalesce(btrim(p->>'reason'),'')='' or length(p->>'reason')>300 then raise exception 'invalid pilot change'; end if;
 if jsonb_typeof(p->'targetIds') is distinct from 'array' or jsonb_array_length(p->'targetIds')>100 then raise exception 'invalid pilot targets'; end if;
 if op in ('assign','remove') and jsonb_array_length(p->'targetIds')=0 then raise exception 'empty pilot targets'; end if;
 if op in ('start','stop') and jsonb_array_length(p->'targetIds')<>0 then raise exception 'unexpected pilot targets'; end if;
 lock table public.teachers,public.admins in share mode;
 if not public.sensitive_actor_valid(p) or not (coalesce(p->'operatorIds','[]') ? (p->>'actorNid')) then
  return jsonb_build_object('error','관리 권한이나 로그인이 바뀌었어요. 다시 확인해 주세요.','stale',true); end if;
 select * into pol from public.site_pilot_policy where id=1 for update;
 if not found then raise exception 'pilot policy missing'; end if;
 if pol.version is distinct from (p->>'expectedVersion')::bigint then return jsonb_build_object('error','다른 곳에서 배정이 바뀌었어요. 다시 조회해 주세요.','stale',true); end if;
 for target in select distinct value from jsonb_array_elements_text(p->'targetIds') loop
  select * into who from (select member_id,name,dept,0 priority from public.teachers where nid=target union all select member_id,name,dept,1 from public.admins where nid=target) t order by priority,member_id limit 1;
  if not found and op='assign' then return jsonb_build_object('error','명단에서 사라진 사용자가 있어요. 다시 조회해 주세요.','stale',true); end if;
  targets:=targets||jsonb_build_array(jsonb_build_object('memberId',target,'name',coalesce(who.name,'명단 없음'),'dept',coalesce(who.dept,'')));
 end loop;
 if op='assign' then insert into public.site_pilot_members(nid) select distinct value from jsonb_array_elements_text(p->'targetIds') on conflict(nid) do nothing;
 elsif op='remove' then delete from public.site_pilot_members where nid in (select value from jsonb_array_elements_text(p->'targetIds'));
 else update public.site_pilot_policy set enabled=(op='start') where id=1; end if;
 update public.site_pilot_policy set version=version+1,updated_at=now() where id=1;
 insert into public.site_pilot_changes(actor_id,actor_name,operation,targets,reason,version)
 values(p->>'actorId',p->>'actorName',op,targets,p->>'reason',pol.version+1);
 return jsonb_build_object('ok',true,'version',pol.version+1);
end $$;
revoke all on function public.site_pilot_route(text),public.site_pilot_search(text,boolean,integer,text),public.site_pilot_apply(jsonb) from public,anon,authenticated;
grant execute on function public.site_pilot_route(text),public.site_pilot_search(text,boolean,integer,text),public.site_pilot_apply(jsonb) to service_role;
