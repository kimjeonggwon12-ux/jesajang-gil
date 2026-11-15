-- 최초 등록은 부서·이름·고유번호 대조. 기존 연락처가 있으면 추가 대조한다.
-- 서버 전용 함수: PIN/복구 코드/감사 기록을 같은 트랜잭션에서 변경한다.
begin;
create table public.pin_enrollment_attempts (
  nid text primary key,
  attempts integer not null default 0 check (attempts between 0 and 5),
  window_until timestamptz not null
);
create table public.pin_recovery_challenges (
  nid text primary key references public.member_pins(nid),
  code_hash text not null,
  pin_ver text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 5),
  consumed_at timestamptz,
  issued_by text not null,
  reason text not null
);
-- 최초 등록 연락처는 공개 프로필과 분리한다. 번호 대조는 휴대전화 소유 인증이 아니다.
create table public.member_registration_contacts (
  nid text primary key references public.member_pins(nid),
  phone text not null check (phone ~ '^01[016789][0-9]{7,8}$'),
  source text not null check (source in ('existing_roster','self_reported')),
  recorded_at timestamptz not null default now(),
  phone_verified_at timestamptz,
  invalidated_at timestamptz
);
alter table public.pin_enrollment_attempts enable row level security;
alter table public.pin_recovery_challenges enable row level security;
alter table public.member_registration_contacts enable row level security;
revoke all on public.pin_enrollment_attempts, public.pin_recovery_challenges, public.member_registration_contacts from public, anon, authenticated;
grant select, insert, update, delete on public.pin_enrollment_attempts, public.pin_recovery_challenges, public.member_registration_contacts to service_role;

create function public.pin_account_action(p jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $fn$
#variable_conflict use_column
<<pin_account_action>>
declare
  nid text := p->>'nid'; op text := p->>'op';
  old public.member_pins%rowtype; challenge public.pin_recovery_challenges%rowtype;
  tries public.pin_enrollment_attempts%rowtype;
  person_name text; person_id text; actor_name text; kind text;
  stamp text := to_char(clock_timestamp() at time zone 'Asia/Seoul','YYYY-MM-DD HH24:MI:SS');
  identity_ok boolean; phone_ok boolean; phone_exists boolean; found_pin boolean; has_pin boolean;
  contact_source text;
begin
  if nid is null or nid !~ '^[0-9]{8,40}$' or op not in ('register','recover','issue','change') then
    return jsonb_build_object('error','요청 내용을 확인해 주세요.');
  end if;
  -- 행이 아직 없는 최초 등록도 같은 사람에 대해 직렬 처리한다.
  perform pg_catalog.pg_advisory_xact_lock(721611, pg_catalog.hashtext(nid));
  select r.name, r.member_id into person_name, person_id from (
    select t.name,t.member_id,t.dept from public.teachers t where t.nid=pin_account_action.nid
    union all select a.name,a.member_id,a.dept from public.admins a where a.nid=pin_account_action.nid
  ) r limit 1;
  if person_id is null then return jsonb_build_object('error','명단 정보를 확인해 주세요. 담당자에게 확인을 요청할 수 있어요.'); end if;
  select * into old from public.member_pins m where m.nid=pin_account_action.nid for update;
  found_pin := found; has_pin := coalesce(old.pin_hash,'')<>'';
  if op in ('register','recover') then
    select exists(select 1 from (
      select t.name,t.dept from public.teachers t where t.nid=pin_account_action.nid
      union all select a.name,a.dept from public.admins a where a.nid=pin_account_action.nid
    ) r where regexp_replace(r.name,'\s','','g')=regexp_replace(p->>'name','\s','','g')
       and regexp_replace(r.dept,'\s','','g')=regexp_replace(p->>'dept','\s','','g')) into identity_ok;
  end if;
  if op='register' then
    if found_pin then return jsonb_build_object('error','이미 등록했거나 복구가 필요한 계정이에요. PIN으로 입장하거나 담당자에게 확인을 요청해 주세요.','needsRecovery',true); end if;
    select * into tries from public.pin_enrollment_attempts a where a.nid=pin_account_action.nid;
    if found and tries.window_until>clock_timestamp() and tries.attempts>=5 then
      return jsonb_build_object('error','확인 시도가 많아요. 10분 뒤 다시 시도하거나 담당자에게 문의해 주세요.','locked',true);
    end if;
    insert into public.pin_enrollment_attempts as a(nid,attempts,window_until)
      values(nid,1,clock_timestamp()+interval '10 minutes')
      on conflict(nid) do update set
        attempts=case when a.window_until<=clock_timestamp() then 1 else a.attempts+1 end,
        window_until=case when a.window_until<=clock_timestamp() then clock_timestamp()+interval '10 minutes' else a.window_until end;
    select coalesce(bool_or(regexp_replace(coalesce(r.phone,''),'\s','','g')<>''),false),
      coalesce(bool_or((case when regexp_replace(r.phone,'[^0-9]','','g') like '82%'
        then '0'||substr(regexp_replace(r.phone,'[^0-9]','','g'),3)
        else regexp_replace(r.phone,'[^0-9]','','g') end)=p->>'phone'),false)
      into phone_exists, phone_ok from (
      select a.phone from public.admins a where a.nid=pin_account_action.nid
      union all select t.phone from public.teacher_profiles t where t.nid=pin_account_action.nid
    ) r;
    -- 비어 있지 않은 잘못된 번호도 기존 연락처로 취급해 대조를 우회하지 않는다.
    if not identity_ok or (phone_exists and not phone_ok) or coalesce(p->>'phone','') !~ '^01[016789][0-9]{7,8}$' then
      return jsonb_build_object('error','입력한 정보가 명단과 맞지 않아요. 기존 전화번호가 있다면 같은 번호를 입력해 주세요. 확인이 어려우면 담당자에게 문의해 주세요.');
    end if;
    contact_source := case when phone_exists then 'existing_roster' else 'self_reported' end;
    kind := 'PIN 최초 등록'; actor_name := person_name;
  elsif op='issue' then
    if coalesce(p->>'reason','') not in ('PIN 분실','선등록 신고','명단 연락처 확인') then return jsonb_build_object('error','확인 사유를 선택해 주세요.'); end if;
    if not exists(select 1 from public.member_pins m where m.nid=p->>'actorId' and m.pin_hash<>'' and m.ver=p->>'actorVer') then
      return jsonb_build_object('error','담당자 로그인을 다시 확인해 주세요.');
    end if;
    if coalesce(p->>'codeHash','') !~ '^[a-f0-9]{64}$' then raise exception 'Invalid recovery hash'; end if;
    insert into public.member_pins(nid,pin_hash,salt,ver,updated_at) values(nid,'','',p->>'ver',stamp)
      on conflict(nid) do update set pin_hash='',salt='',ver=excluded.ver,fails=0,locked_until='',updated_at=stamp;
    insert into public.pin_recovery_challenges(nid,code_hash,pin_ver,expires_at,issued_by,reason)
      values(nid,p->>'codeHash',p->>'ver',clock_timestamp()+interval '30 minutes',p->>'actorId',p->>'reason')
      on conflict(nid) do update set code_hash=excluded.code_hash,pin_ver=excluded.pin_ver,
        expires_at=excluded.expires_at,attempts=0,consumed_at=null,issued_by=excluded.issued_by,reason=excluded.reason;
    if p->>'reason'='선등록 신고' then
      update public.member_registration_contacts c set invalidated_at=clock_timestamp(),phone_verified_at=null
        where c.nid=pin_account_action.nid;
    end if;
    insert into public.roster_changes(changed_at,actor_id,actor_name,kind,target_id,target_name,before,after)
      values(stamp::timestamp,p->>'actorId',p->>'actorName','PIN 복구 발급',person_id,person_name,
        jsonb_build_object('hasPin',has_pin),jsonb_build_object('hasPin',false,'reason',p->>'reason'));
    return jsonb_build_object('ok',true,'had',has_pin,'expiresInMinutes',30);
  elsif op='recover' then
    select * into challenge from public.pin_recovery_challenges c where c.nid=pin_account_action.nid for update;
    if not found or challenge.consumed_at is not null or challenge.expires_at<=clock_timestamp()
      or challenge.attempts>=5 or challenge.pin_ver<>old.ver then
      return jsonb_build_object('error','복구 정보를 확인해 주세요. 만료되었거나 여러 번 틀린 코드는 담당자에게 다시 받아 주세요.');
    end if;
    update public.pin_recovery_challenges c set attempts=c.attempts+1 where c.nid=pin_account_action.nid;
    if not identity_ok or challenge.code_hash<>p->>'codeHash' then
      return jsonb_build_object('error','복구 정보를 확인해 주세요. 만료되었거나 여러 번 틀린 코드는 담당자에게 다시 받아 주세요.');
    end if;
    update public.pin_recovery_challenges c set consumed_at=clock_timestamp() where c.nid=pin_account_action.nid;
    kind := 'PIN 복구 완료'; actor_name := person_name;
  else
    if not has_pin or old.ver is distinct from p->>'expectedVer' then return jsonb_build_object('error','PIN 상태가 바뀌었어요. 다시 로그인해 주세요.'); end if;
    kind := 'PIN 변경'; actor_name := person_name;
  end if;
  if coalesce(p->>'pinHash','') !~ '^[a-f0-9]{64}$' or coalesce(p->>'salt','') !~ '^[a-f0-9]{32}$'
    or coalesce(p->>'ver','')='' then raise exception 'Invalid PIN data'; end if;
  insert into public.member_pins(nid,pin_hash,salt,ver,updated_at) values(nid,p->>'pinHash',p->>'salt',p->>'ver',stamp)
    on conflict(nid) do update set pin_hash=excluded.pin_hash,salt=excluded.salt,ver=excluded.ver,fails=0,locked_until='',updated_at=stamp;
  if op='register' then
    insert into public.member_registration_contacts(nid,phone,source) values(nid,p->>'phone',contact_source);
  end if;
  delete from public.pin_enrollment_attempts a where a.nid=pin_account_action.nid;
  insert into public.roster_changes(changed_at,actor_id,actor_name,kind,target_id,target_name,before,after)
    values(stamp::timestamp,person_id,actor_name,kind,person_id,person_name,jsonb_build_object('hasPin',has_pin),
      jsonb_build_object('hasPin',true)||case when op='register' then jsonb_build_object('contactSource',contact_source) else '{}'::jsonb end);
  return jsonb_build_object('ok',true,'name',person_name,'memberId',person_id);
end
$fn$;
revoke execute on function public.pin_account_action(jsonb) from public, anon, authenticated;
grant execute on function public.pin_account_action(jsonb) to service_role;
commit;
