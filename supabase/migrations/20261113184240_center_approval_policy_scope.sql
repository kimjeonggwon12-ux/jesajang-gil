-- 운영 반영 전 별도 승인 필요. 초기 선택은 호환용이며 최종 운영 정책 확정이 아니다.
create table public.center_approval_policy (
 id integer primary key check(id=1), mode text not null check(mode in ('legacy_global','role_scoped')),
 version bigint not null default 1, updated_at timestamptz not null default now()
);
insert into public.center_approval_policy(id,mode) values(1,'legacy_global');
create table public.center_policy_changes (
 id bigint generated always as identity primary key, changed_at timestamptz not null default now(),
 actor_id text not null, actor_name text not null, before_mode text not null, after_mode text not null,
 version bigint not null, reason text not null
);
alter table public.center_approval_policy enable row level security;
alter table public.center_policy_changes enable row level security;
revoke all on public.center_approval_policy,public.center_policy_changes from public,anon,authenticated;
grant all on public.center_approval_policy,public.center_policy_changes to service_role;
grant usage,select on sequence public.center_policy_changes_id_seq to service_role;

-- 보직 묶음과 센터 담당 관계/설정을 한 DB 스냅샷으로 읽는다. 고유번호는 서버 안에서만 사용한다.
create function public.center_scope_state(p_nid text) returns jsonb
language sql stable security invoker set search_path='' as $fn$
 select jsonb_build_object(
  'teacher',(select jsonb_build_object('member_id',member_id,'name',name,'dept',dept,'region',region,'position',position)
    from public.teachers where nid=p_nid order by sort_order,member_id limit 1),
  'admins',coalesce((select jsonb_agg(jsonb_build_object('id',id,'member_id',member_id,'name',name,'dept',dept,'region',region,'position',position) order by id)
    from public.admins where nid=p_nid),'[]'::jsonb),
  'centers',coalesce((select jsonb_agg(id order by id) from public.centers c where exists
    (select 1 from jsonb_array_elements(c.staff) s where public.norm_id(s->>'memberId')=p_nid)),'[]'::jsonb),
  'policy',(select jsonb_build_object('mode',mode,'version',version) from public.center_approval_policy where id=1)
 );
$fn$;

create function public.center_policy_apply(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path='' set lock_timeout='3s' set statement_timeout='10s' as $fn$
declare current_policy public.center_approval_policy; next_mode text:=p->>'mode'; why text:=btrim(p->>'reason');
begin
 if coalesce(next_mode,'') not in ('legacy_global','role_scoped') or coalesce(why,'')='' or length(why)>300 then raise exception 'invalid center policy'; end if;
 lock table public.teachers,public.admins in share mode;
 if not public.sensitive_actor_valid(p) then return jsonb_build_object('error','담당자 권한이나 로그인이 바뀌었어요. 다시 들어와 주세요.','stale',true); end if;
 select * into current_policy from public.center_approval_policy where id=1 for update;
 if not found then raise exception 'center policy missing'; end if;
 if current_policy.version is distinct from (p->>'expectedVersion')::bigint then
  return jsonb_build_object('error','승인 기준이 바뀌었어요. 다시 조회해 주세요.','stale',true); end if;
 if current_policy.mode=next_mode then return jsonb_build_object('ok',true,'unchanged',true); end if;
 update public.center_approval_policy set mode=next_mode,version=version+1,updated_at=now() where id=1;
 insert into public.center_policy_changes(actor_id,actor_name,before_mode,after_mode,version,reason)
  values(p->>'actorId',p->>'actorName',current_policy.mode,next_mode,current_policy.version+1,why);
 return jsonb_build_object('ok',true,'mode',next_mode,'version',current_policy.version+1);
end $fn$;

-- API가 판정한 보직/담당 기수/승인 설정/PIN과 대상 행이 그대로일 때만 처리한다.
-- 명단 → 관리자 → 센터 → 설정 순서. 관련 권한 변경과 교차 실행되지 않게 읽기 잠금을 유지한다.
create function public.center_referral_apply(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path='' set lock_timeout='3s' set statement_timeout='10s' as $fn$
declare old_row public.center_referrals; next_row public.center_referrals; patch jsonb:=coalesce(p->'patch','{}');
begin
 if coalesce(p->>'operation','') not in ('write','read') or jsonb_typeof(p->'expected') is distinct from 'object'
  or jsonb_typeof(patch) is distinct from 'object' or patch-array['status','decided_by','decided_by_id','decided_at','decide_note','snapshot',
   'sent_by','sent_by_id','sent_at','center_id','send_note','center_read_at','assignee_id','assignee_name']<>'{}'::jsonb
  then raise exception 'invalid center referral change'; end if;
 lock table public.teachers,public.admins,public.centers,public.center_approval_policy in share mode;
 if not public.sensitive_actor_valid(p) or public.center_scope_state(p->>'actorNid') is distinct from p->'scopeState' then
  return jsonb_build_object('error','승인 기준이나 담당 범위가 바뀌었어요. 새로고침 후 다시 확인해 주세요.','stale',true); end if;
 select * into old_row from public.center_referrals where id=(p->'expected'->>'id')::bigint for update;
 if not found or not(to_jsonb(old_row) @> (p->'expected')) then
  return jsonb_build_object('error','다른 곳에서 처리 상태나 담당 범위가 바뀌었어요. 새로고침 후 다시 확인해 주세요.','stale',true); end if;
 if p->>'operation'='read' then
  if old_row.status='전달' and (p->'scopeState'->'centers') @> jsonb_build_array(old_row.center_id) and old_row.center_read_at is null then
   update public.center_referrals set center_read_at=timezone('Asia/Seoul',now()) where id=old_row.id returning * into old_row;
  end if;
  return jsonb_build_object('ok',true,'row',to_jsonb(old_row));
 end if;
 if patch ? 'center_id' and patch->'center_id'<>'null'::jsonb and patch->>'status'='전달' and not exists
  (select 1 from public.centers where id=(patch->>'center_id')::bigint and active) then
  return jsonb_build_object('error','센터 상태가 바뀌었어요. 다시 조회해 주세요.','stale',true); end if;
 if p ? 'centerStaff' and p->'centerStaff' is distinct from (select staff from public.centers where id=old_row.center_id) then
  return jsonb_build_object('error','분반 담당자가 바뀌었어요. 다시 조회해 주세요.','stale',true); end if;
 next_row:=jsonb_populate_record(old_row,patch);
 update public.center_referrals set status=next_row.status,decided_by=next_row.decided_by,decided_by_id=next_row.decided_by_id,
  decided_at=next_row.decided_at,decide_note=next_row.decide_note,snapshot=next_row.snapshot,
  sent_by=next_row.sent_by,sent_by_id=next_row.sent_by_id,sent_at=next_row.sent_at,center_id=next_row.center_id,
  send_note=next_row.send_note,center_read_at=next_row.center_read_at,assignee_id=next_row.assignee_id,assignee_name=next_row.assignee_name
  where id=old_row.id;
 return jsonb_build_object('ok',true,'id',old_row.id);
end $fn$;
revoke all on function public.center_scope_state(text),public.center_policy_apply(jsonb),public.center_referral_apply(jsonb) from public,anon,authenticated;
grant execute on function public.center_scope_state(text),public.center_policy_apply(jsonb),public.center_referral_apply(jsonb) to service_role;
