-- 로컬 후보: 가져오기 미리보기와 반영 사이의 변경을 감지하고 명단/이력/스냅샷을 함께 저장한다.
-- 기존 roster_apply와 업무 계산은 그대로 사용한다. 운영 미반영.
create or replace function public.roster_import_state() returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $fn$
  with state as (
    select jsonb_build_object(
      'teachers', coalesce((select jsonb_agg(to_jsonb(t) order by t.sort_order,t.member_id) from public.teachers t),'[]'::jsonb),
      'admins', coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.admins a),'[]'::jsonb)
    ) as data
  ) select data || jsonb_build_object('revision',md5(data::text)) from state;
$fn$;

create or replace function public.roster_apply_reviewed(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $fn$
declare
  current_state jsonb; saved jsonb; snapshot_id bigint; taken timestamp;
begin
  -- 다른 가져오기와 개별 명단/권한 수정이 검사와 반영 사이에 끼어들지 않게 한다.
  lock table public.teachers, public.admins in share row exclusive mode;
  current_state := public.roster_import_state();
  if coalesce(p->>'revision','') = '' or p->>'revision' <> current_state->>'revision' then
    return jsonb_build_object('error','미리보기 뒤에 명단이나 관리자 정보가 바뀌었어요. 다시 미리보기를 확인해 주세요.','stale',true);
  end if;
  taken := timezone('Asia/Seoul',clock_timestamp());
  insert into public.roster_snapshots(taken_at,actor_id,actor_name,reason,teachers)
    values(taken,p->>'actorId',p->>'actorName',(p->>'source') || ' 반영 직전',current_state->'teachers') returning id into snapshot_id;
  saved := public.roster_apply(p->'rows',array(select jsonb_array_elements_text(p->'remove')))::jsonb;
  insert into public.tier_history(changed_on,member_id,name,prev_tier,new_tier,reason,approver1)
    select r.changed_on,r.member_id,r.name,r.prev_tier,r.new_tier,r.reason,r.approver1
    from jsonb_to_recordset(p->'history') as r(changed_on date,member_id text,name text,prev_tier text,new_tier text,reason text,approver1 text);
  insert into public.roster_changes(changed_at,actor_id,actor_name,kind,target_id,target_name,before,after)
    values(taken,p->>'actorId',p->>'actorName','엑셀 반영','',p->>'source',p->'before',(p->'after') || jsonb_build_object('스냅샷',snapshot_id));
  return saved || jsonb_build_object('ok',true,'snapshotId',snapshot_id);
end
$fn$;
revoke all on function public.roster_import_state() from public,anon,authenticated;
revoke all on function public.roster_apply_reviewed(jsonb) from public,anon,authenticated;
grant execute on function public.roster_import_state() to service_role;
grant execute on function public.roster_apply_reviewed(jsonb) to service_role;
