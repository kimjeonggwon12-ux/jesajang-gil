-- [제안 · 자동 적용 금지] 화요전도단·목요사명자교육 교육 관리 — 부서 범위 공무 사전보고 (2026-11-16)
-- 이 파일은 supabase/migrations 밖에 둔 검토용 SQL이다. 운영 적용은 전환 담당 검토·사용자 승인 후 별도로 한다.
--
-- 원칙
-- 1) 공무 원본은 기존 그대로 cohort_summary_log('#excused', kind, ref_id=nid, date) 한 곳이다.
--    기존 보고(중진·24부서 카드)·전체 관리자 화면(edu_excused_apply)은 바꾸지 않는다.
-- 2) 부서 저장은 서버가 확인한 소속(affiliation) 한 곳의 사람만 추가·삭제한다. 다른 부서의 줄은 읽지도 지우지도 않는다.
-- 3) 개인별 사유·추후 교육 방법·결과는 edu_excused_details(주석 표)에 같은 트랜잭션으로 저장한다.
--    원본에 없는 상세(전체 관리자 화면에서 해제됨)는 화면에서 '해제됨'으로 보이고 공무로 세지 않는다.
-- 4) 모든 변경은 edu_excused_detail_log 와 기존 edu_excused_changes(전체 명단 전후)에 함께 남긴다.
-- 5) 잠금 순서는 기존 edu_excused_apply 와 같은 표 순서 + 새 표 순으로 맞춰 교착을 피한다.
--
-- 되돌리기: 아래 함수·표를 drop 해도 기존 표·함수·보고에는 영향이 없다(원본 줄은 기존 '#excused' 그대로 남는다).
--   drop function if exists public.edu_mgmt_scope_state(text,text,text), public.edu_mgmt_scope_apply(jsonb),
--     public.edu_mgmt_followup_apply(jsonb), public.edu_dept_head_apply(jsonb), public.edu_mgmt_access_revision();
--   (상세·이력 보존이 필요하면 표는 남겨 두고 함수만 지운다.)

create table public.edu_dept_heads (
  id bigint generated always as identity primary key,
  nid text not null,
  affiliation text not null,
  granted_by text not null,
  granted_at timestamptz not null default now(),
  revoked boolean not null default false,
  revoked_by text,
  revoked_at timestamptz
);
create unique index edu_dept_heads_active_idx on public.edu_dept_heads(nid, affiliation) where not revoked;

create table public.edu_excused_details (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('화전단','목사교')),
  date text not null,
  nid text not null,
  affiliation text not null,
  reason text not null default '',
  follow_method text not null default '',
  follow_result text not null default '',
  follow_done boolean not null default false,
  active boolean not null default true,
  version integer not null default 1,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_by text not null,
  updated_at timestamptz not null default now(),
  unique (kind, date, nid)
);
create index edu_excused_details_scope_idx on public.edu_excused_details(kind, date, affiliation);

create table public.edu_excused_detail_log (
  id bigint generated always as identity primary key,
  kind text not null,
  date text not null,
  nid text not null,
  affiliation text not null,
  action text not null check (action in ('register','update','cancel','followup')),
  actor_id text not null,
  actor_name text not null default '',
  actor_role text not null check (actor_role in ('head','manager')),
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index edu_excused_detail_log_scope_idx on public.edu_excused_detail_log(kind, date, affiliation, id desc);

alter table public.edu_dept_heads enable row level security;
alter table public.edu_excused_details enable row level security;
alter table public.edu_excused_detail_log enable row level security;
revoke all on public.edu_dept_heads, public.edu_excused_details, public.edu_excused_detail_log from public, anon, authenticated;
grant all on public.edu_dept_heads, public.edu_excused_details, public.edu_excused_detail_log to service_role;
grant usage, select on sequence public.edu_dept_heads_id_seq, public.edu_excused_details_id_seq, public.edu_excused_detail_log_id_seq to service_role;

-- 기존 edu_excused_state 의 accessRevision 과 같은 식(관리자·교육 위임이 바뀌면 달라짐) + 부서장 지정.
create function public.edu_mgmt_access_revision() returns text
language sql stable security invoker set search_path='' as $fn$
  select md5(jsonb_build_array(
    (select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]'::jsonb) from public.admins a),
    (select coalesce(jsonb_agg(to_jsonb(d) order by d.id),'[]'::jsonb) from public.education_delegations d),
    (select coalesce(jsonb_agg(jsonb_build_array(h.id,h.nid,h.affiliation,h.revoked) order by h.id),'[]'::jsonb) from public.edu_dept_heads h))::text);
$fn$;

-- 한 소속(affiliation)의 상태. 다른 소속의 선택은 revision 에 들어가지 않는다(부서끼리 서로 막지 않음).
create function public.edu_mgmt_scope_state(p_kind text, p_date text, p_aff text) returns jsonb
language sql stable security invoker set search_path='' as $fn$
  with people as (
    select r.nid, r.name, r.affiliation, r.district, r.position, r.sort_order, r.id
    from public.edu_roster r
    where r.roster_key='목요사명자' and r.dept='24부서' and coalesce(nullif(r.affiliation,''),'기타')=p_aff
  ), state as (select jsonb_build_object(
    'kind',p_kind,'date',p_date,'affiliation',p_aff,
    'people',coalesce((select jsonb_agg(jsonb_build_object('nid',p.nid,'name',p.name,'district',p.district,'position',p.position) order by p.sort_order,p.id) from people p),'[]'::jsonb),
    'selected',coalesce((select jsonb_agg(l.ref_id order by l.ref_id) from public.cohort_summary_log l
      where l.cohort_id='#excused' and l.kind=p_kind and l.date=p_date and l.ref_id in (select nid from people)),'[]'::jsonb),
    'details',coalesce((select jsonb_agg(jsonb_build_object('nid',d.nid,'affiliation',d.affiliation,'reason',d.reason,
        'followMethod',d.follow_method,'followResult',d.follow_result,'followDone',d.follow_done,'active',d.active,
        'version',d.version,'updatedBy',d.updated_by,'updatedAt',d.updated_at) order by d.nid)
      from public.edu_excused_details d where d.kind=p_kind and d.date=p_date
        and (d.affiliation=p_aff or d.nid in (select nid from people))),'[]'::jsonb),
    'accessRevision',public.edu_mgmt_access_revision()
  ) as value)
  select value||jsonb_build_object('revision',md5(value::text)) from state;
$fn$;

-- p: {kind,date,affiliation,revision,actorId,actorName,actorRole:'head'|'manager',
--     changes:[{nid, op:'register'|'cancel', reason, followMethod}]}
create function public.edu_mgmt_scope_apply(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path=''
set lock_timeout='3s' set statement_timeout='15s' as $fn$
declare
  st jsonb; v_kind text:=p->>'kind'; v_day text:=p->>'date'; v_aff text:=p->>'affiliation';
  v_role text:=p->>'actorRole'; v_actor text:=btrim(coalesce(p->>'actorId','')); v_name text:=coalesce(p->>'actorName','');
  ch jsonb; v_nid text; v_op text; v_reason text; v_method text; d public.edu_excused_details;
  before_all text[]; after_all text[]; added int:=0; removed int:=0; updated int:=0; summary text;
  selected boolean; before jsonb;
begin
  -- 기존 edu_excused_apply 와 같은 순서로 잠근 뒤 새 표를 잠근다.
  lock table public.admins,public.education_delegations,public.attend_series,
    public.attend_meetings,public.cohorts,public.edu_roster,public.cohort_summary_log in share row exclusive mode;
  lock table public.edu_dept_heads,public.edu_excused_details in share row exclusive mode;

  if v_kind is null or v_kind not in ('화전단','목사교') or coalesce(v_day,'') !~ '^\d{4}-\d{2}-\d{2}$'
    or v_day::date::text<>v_day or coalesce(btrim(v_aff),'')='' or v_actor=''
    or v_role is null or v_role not in ('head','manager')
    or jsonb_typeof(p->'changes') is distinct from 'array' or jsonb_array_length(p->'changes') not between 1 and 300 then
    raise exception 'invalid scoped excused change';
  end if;
  -- 부서장은 트랜잭션 안에서 지정이 살아 있는지 다시 확인한다(저장 직전 회수 경합 방지).
  if v_role='head' and not exists(select 1 from public.edu_dept_heads h where h.nid=v_actor and h.affiliation=v_aff and not h.revoked) then
    return jsonb_build_object('error','이 부서의 공무 보고 권한이 없어요. 다시 조회해 주세요.','stale',true,'forbidden',true);
  end if;
  st:=public.edu_mgmt_scope_state(v_kind,v_day,v_aff);
  if coalesce(p->>'revision','')='' or p->>'revision'<>st->>'revision' then
    return jsonb_build_object('error','이 부서의 공무 명단이나 권한이 바뀌었어요. 다시 조회해 주세요.','stale',true);
  end if;
  if (select count(*) from jsonb_array_elements(p->'changes') x)<>(select count(distinct x->>'nid') from jsonb_array_elements(p->'changes') x) then
    raise exception 'duplicate scoped excused member';
  end if;

  before_all:=array(select l.ref_id from public.cohort_summary_log l where l.cohort_id='#excused' and l.kind=v_kind and l.date=v_day order by 1);

  for ch in select * from jsonb_array_elements(p->'changes') loop
    v_nid:=ch->>'nid'; v_op:=ch->>'op';
    v_reason:=btrim(coalesce(ch->>'reason','')); v_method:=btrim(coalesce(ch->>'followMethod',''));
    if v_nid is null or not exists(select 1 from jsonb_array_elements(st->'people') x where x->>'nid'=v_nid) then
      raise exception 'member outside affiliation';
    end if;
    if v_op is null or v_op not in ('register','cancel') or length(v_reason)>300 or length(v_method)>300
       or (v_op='register' and v_reason='') then raise exception 'invalid scoped excused item'; end if;
    selected:=exists(select 1 from public.cohort_summary_log l where l.cohort_id='#excused' and l.kind=v_kind and l.date=v_day and l.ref_id=v_nid);
    d:=null;
    select * into d from public.edu_excused_details x where x.kind=v_kind and x.date=v_day and x.nid=v_nid for update;
    before:=case when d.id is null then null else to_jsonb(d) end;

    if v_op='register' then
      if not selected then
        insert into public.cohort_summary_log(cohort_id,kind,ref_id,date,sent_at)
          values('#excused',v_kind,v_nid,v_day,timezone('Asia/Seoul',now()));
        added:=added+1;
      elsif d.id is not null and d.active then updated:=updated+1;
      end if;
      if d.id is null then
        insert into public.edu_excused_details(kind,date,nid,affiliation,reason,follow_method,created_by,updated_by)
          values(v_kind,v_day,v_nid,v_aff,v_reason,v_method,v_actor,v_actor) returning * into d;
      else
        update public.edu_excused_details x set affiliation=v_aff,reason=v_reason,follow_method=v_method,active=true,
          version=x.version+1,updated_by=v_actor,updated_at=now() where x.id=d.id returning * into d;
      end if;
      insert into public.edu_excused_detail_log(kind,date,nid,affiliation,action,actor_id,actor_name,actor_role,before,after)
        values(v_kind,v_day,v_nid,v_aff,case when selected and before is not null and (before->>'active')::boolean then 'update' else 'register' end,
          v_actor,v_name,v_role,before,to_jsonb(d));
    else
      if not selected then raise exception 'not excused'; end if;
      delete from public.cohort_summary_log l where l.cohort_id='#excused' and l.kind=v_kind and l.date=v_day and l.ref_id=v_nid;
      removed:=removed+1;
      if d.id is null then
        insert into public.edu_excused_details(kind,date,nid,affiliation,reason,active,created_by,updated_by)
          values(v_kind,v_day,v_nid,v_aff,'',false,v_actor,v_actor) returning * into d;
      else
        update public.edu_excused_details x set active=false,version=x.version+1,updated_by=v_actor,updated_at=now()
          where x.id=d.id returning * into d;
      end if;
      insert into public.edu_excused_detail_log(kind,date,nid,affiliation,action,actor_id,actor_name,actor_role,before,after)
        values(v_kind,v_day,v_nid,v_aff,'cancel',v_actor,v_name,v_role,before,to_jsonb(d)||jsonb_build_object('cancelReason',v_reason));
    end if;
  end loop;

  after_all:=array(select l.ref_id from public.cohort_summary_log l where l.cohort_id='#excused' and l.kind=v_kind and l.date=v_day order by 1);
  summary:=format('[부서 사전보고] %s · 추가 %s · 해제 %s · 사유 수정 %s', v_aff, added, removed, updated);
  -- 기존 전체 관리자 화면의 변경 이력에도 전후 전체 명단을 남긴다(이력 한 곳에서 확인).
  if added+removed>0 then
    insert into public.edu_excused_changes(kind,date,actor_id,actor_name,reason,before_nids,after_nids)
      values(v_kind,v_day,v_actor,v_name,summary,before_all,after_all);
  end if;
  return jsonb_build_object('ok',true,'added',added,'removed',removed,'updated',updated,
    'revision',public.edu_mgmt_scope_state(v_kind,v_day,v_aff)->>'revision');
end $fn$;

-- 추후 교육 방법·결과. 출석·공무 원본·보낸 보고는 건드리지 않는다.
-- p: {kind,date,nid,version,followMethod,followResult,followDone,actorId,actorName,actorRole}
create function public.edu_mgmt_followup_apply(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path=''
set lock_timeout='3s' set statement_timeout='15s' as $fn$
declare d public.edu_excused_details; v_role text:=p->>'actorRole'; v_actor text:=btrim(coalesce(p->>'actorId','')); before jsonb;
begin
  lock table public.edu_dept_heads in share row exclusive mode;
  if v_actor='' or v_role is null or v_role not in ('head','manager') or length(coalesce(p->>'followMethod',''))>300
    or length(coalesce(p->>'followResult',''))>500 or jsonb_typeof(p->'followDone') is distinct from 'boolean' then
    raise exception 'invalid followup';
  end if;
  select * into d from public.edu_excused_details x where x.kind=p->>'kind' and x.date=p->>'date' and x.nid=p->>'nid' for update;
  if d.id is null or not d.active then return jsonb_build_object('error','공무로 등록된 사람만 교육 결과를 적을 수 있어요.','stale',true); end if;
  if v_role='head' and not exists(select 1 from public.edu_dept_heads h where h.nid=v_actor and h.affiliation=d.affiliation and not h.revoked) then
    return jsonb_build_object('error','이 부서의 공무 보고 권한이 없어요. 다시 조회해 주세요.','stale',true,'forbidden',true);
  end if;
  if (p->>'version')::int is distinct from d.version then
    return jsonb_build_object('error','다른 사람이 먼저 고쳤어요. 다시 조회해 주세요.','stale',true);
  end if;
  before:=to_jsonb(d);
  update public.edu_excused_details x set follow_method=btrim(coalesce(p->>'followMethod','')),follow_result=btrim(coalesce(p->>'followResult','')),
    follow_done=(p->>'followDone')::boolean,version=x.version+1,updated_by=v_actor,updated_at=now() where x.id=d.id returning * into d;
  insert into public.edu_excused_detail_log(kind,date,nid,affiliation,action,actor_id,actor_name,actor_role,before,after)
    values(d.kind,d.date,d.nid,d.affiliation,'followup',v_actor,coalesce(p->>'actorName',''),v_role,before,to_jsonb(d));
  return jsonb_build_object('ok',true,'version',d.version);
end $fn$;

-- 부서장 지정·회수(앱 책임자만 — 서버에서 확인). p: {op:'grant'|'revoke', nid, affiliation, actorId}
create function public.edu_dept_head_apply(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path='' set lock_timeout='3s' as $fn$
declare v_nid text:=btrim(coalesce(p->>'nid','')); v_aff text:=btrim(coalesce(p->>'affiliation','')); v_actor text:=btrim(coalesce(p->>'actorId',''));
begin
  lock table public.edu_roster,public.edu_dept_heads in share row exclusive mode;
  if v_nid='' or v_aff='' or v_actor='' or p->>'op' not in ('grant','revoke') then raise exception 'invalid dept head change'; end if;
  if p->>'op'='grant' then
    if not exists(select 1 from public.edu_roster r where r.roster_key='목요사명자' and r.dept='24부서' and coalesce(nullif(r.affiliation,''),'기타')=v_aff) then
      return jsonb_build_object('error','24부서 재적에 없는 소속이에요.');
    end if;
    insert into public.edu_dept_heads(nid,affiliation,granted_by) values(v_nid,v_aff,v_actor) on conflict do nothing;
  else
    update public.edu_dept_heads h set revoked=true,revoked_by=v_actor,revoked_at=now() where h.nid=v_nid and h.affiliation=v_aff and not h.revoked;
  end if;
  return jsonb_build_object('ok',true);
end $fn$;

revoke all on function public.edu_mgmt_access_revision(),public.edu_mgmt_scope_state(text,text,text),public.edu_mgmt_scope_apply(jsonb),
  public.edu_mgmt_followup_apply(jsonb),public.edu_dept_head_apply(jsonb) from public,anon,authenticated;
grant execute on function public.edu_mgmt_access_revision(),public.edu_mgmt_scope_state(text,text,text),public.edu_mgmt_scope_apply(jsonb),
  public.edu_mgmt_followup_apply(jsonb),public.edu_dept_head_apply(jsonb) to service_role;
