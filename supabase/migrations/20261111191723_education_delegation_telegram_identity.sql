-- 교육 과정·단독 QR 모임·정기 교육의 명시 위임. 앱 서버 전용이며 운영 적용 전 검증한다.
create table public.education_delegations (
  id bigint generated always as identity primary key,
  scope_type text not null check (scope_type in ('cohort','meeting','series')),
  scope_id text not null check (length(scope_id) between 1 and 40),
  nid text not null check (nid ~ '^[1-9][0-9]{0,39}$'),
  permissions text[] not null check (permissions <@ array['settings','members','schedule','attendance','assignments','exams','reports']::text[]),
  revoked boolean not null default false,
  actor_nid text not null,
  updated_at timestamptz not null default now(),
  unique(scope_type,scope_id,nid),
  check (scope_type = 'cohort' or permissions <@ array['attendance','reports']::text[]),
  check (revoked or cardinality(permissions)>0)
);
create index education_delegations_active_nid on public.education_delegations(nid) where not revoked;
create table public.education_access_events (
  id bigint generated always as identity primary key,
  actor_nid text not null, target_nid text not null, event text not null,
  scope_type text not null default '', scope_id text not null default '',
  before_permissions text[], after_permissions text[], at timestamptz not null default now()
);
create table public.education_telegram_links (
  id bigint generated always as identity primary key,
  nid text not null unique, tg_user_id text not null unique check(tg_user_id ~ '^[1-9][0-9]{0,19}$'),
  pin_version text not null, linked_at timestamptz not null default now()
);
create table public.education_telegram_challenges (
  id bigint generated always as identity primary key,
  nid text not null unique, code_hash text not null unique check(length(code_hash)=64),
  pin_version text not null, expires_at timestamptz not null
);
alter table public.education_delegations enable row level security;
alter table public.education_access_events enable row level security;
alter table public.education_telegram_links enable row level security;
alter table public.education_telegram_challenges enable row level security;
revoke all on public.education_delegations,public.education_access_events,public.education_telegram_links,public.education_telegram_challenges from anon,authenticated;
grant all on public.education_delegations,public.education_access_events,public.education_telegram_links,public.education_telegram_challenges to service_role;
grant usage,select on sequence public.education_delegations_id_seq,public.education_access_events_id_seq,public.education_telegram_links_id_seq,public.education_telegram_challenges_id_seq to service_role;

-- 위임과 이력은 같은 트랜잭션에 기록한다. 연락처·연결 코드·PIN 자료는 이력에 넣지 않는다.
create function public.education_delegation_audit() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.education_access_events(actor_nid,target_nid,event,scope_type,scope_id,before_permissions,after_permissions)
  values(new.actor_nid,new.nid,case when new.revoked then '위임 회수' else '위임 지정' end,new.scope_type,new.scope_id,
    case when tg_op='UPDATE' then old.permissions else null end,new.permissions);
  return new;
end $$;
create trigger education_delegation_audit after insert or update on public.education_delegations for each row execute function public.education_delegation_audit();

-- 같은 앱 계정의 발급/해제/소비를 직렬화한다. 원문 코드는 DB에 보관하지 않는다.
create function public.education_telegram_prepare(p_nid text,p_hash text,p_version text) returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('education-tg:'||p_nid,0));
  delete from public.education_telegram_challenges where nid=p_nid;
  if p_hash='' then
    delete from public.education_telegram_links where nid=p_nid;
    insert into public.education_access_events(actor_nid,target_nid,event) values(p_nid,p_nid,'텔레그램 연결 해제');
  else
    insert into public.education_telegram_challenges(nid,code_hash,pin_version,expires_at) values(p_nid,p_hash,p_version,now()+interval '10 minutes');
  end if;
  return true;
end $$;
create function public.education_telegram_consume(p_hash text,p_user_id text) returns boolean language plpgsql security invoker set search_path = '' as $$
declare c public.education_telegram_challenges;
begin
  if p_user_id !~ '^[1-9][0-9]{0,19}$' then return false; end if;
  select * into c from public.education_telegram_challenges where code_hash=p_hash;
  if not found then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('education-tg:'||c.nid,0));
  select * into c from public.education_telegram_challenges where code_hash=p_hash and expires_at>now() for update;
  if not found then return false; end if;
  -- 한 텔레그램 계정을 다른 앱 계정에서 가져오려면 기존 연결부터 해제해야 한다.
  if exists(select 1 from public.education_telegram_links where tg_user_id=p_user_id and nid<>c.nid) then return false; end if;
  begin
    insert into public.education_telegram_links(nid,tg_user_id,pin_version) values(c.nid,p_user_id,c.pin_version)
    on conflict(nid) do update set tg_user_id=excluded.tg_user_id,pin_version=excluded.pin_version,linked_at=now();
  exception when unique_violation then return false;
  end;
  delete from public.education_telegram_challenges where id=c.id;
  insert into public.education_access_events(actor_nid,target_nid,event) values(c.nid,c.nid,'텔레그램 연결');
  return true;
end $$;
revoke all on function public.education_delegation_audit(),public.education_telegram_prepare(text,text,text),public.education_telegram_consume(text,text) from public,anon,authenticated;
grant execute on function public.education_delegation_audit(),public.education_telegram_prepare(text,text,text),public.education_telegram_consume(text,text) to service_role;
alter table public.cohort_scores add column actor_nid text not null default '';
notify pgrst, 'reload schema';
