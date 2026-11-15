-- 별도 직책 지정 경로: 현재 명단/권한/PIN을 재검사하고 변경·감사를 한 트랜잭션으로 저장한다.
create function public.roster_leader_apply(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path=''
set lock_timeout='3s' set statement_timeout='10s' as $fn$
declare
  v_create boolean:=coalesce((p->>'create')::boolean,false); v_nid text:=p->>'nid'; fields jsonb:=p->'fields';
  current_state jsonb; before_row public.teachers; saved public.teachers; before_fields jsonb;
begin
  if coalesce(v_nid,'') !~ '^[1-9][0-9]{0,39}$' or public.norm_id(p->>'memberId')<>v_nid
    or jsonb_typeof(p->'expected') is distinct from 'array' or jsonb_typeof(fields) is distinct from 'object'
    or coalesce(btrim(fields->>'name'),'')=''
    or fields->>'position' is null
    or fields->>'position' not in ('회장','총무','지역장','섭외 교관','복음방 교관','교육부장','전도부장','전도과장','전도팀장','서기','전도 과장','교육 과장','교관','총교관','교육부','')
    then raise exception 'invalid roster leader change'; end if;
  lock table public.teachers,public.admins in share row exclusive mode;
  if not public.sensitive_actor_valid(p) then
    return jsonb_build_object('error','담당자 권한이나 로그인이 바뀌었어요. 다시 들어와 주세요.','stale',true);
  end if;
  current_state:=public.roster_member_state(array[v_nid]);
  if current_state is distinct from p->'expected' then
    return jsonb_build_object('error','명단이 바뀌었어요. 다시 조회해 주세요.','stale',true);
  end if;
  if jsonb_array_length(current_state)>1 then
    return jsonb_build_object('error','고유번호가 중복된 명단입니다. 담당자 확인이 필요해요.'); end if;
  if v_create and jsonb_array_length(current_state)<>0 or not v_create and jsonb_array_length(current_state)<>1 then
    return jsonb_build_object('error','명단이 바뀌었어요. 다시 조회해 주세요.','stale',true); end if;
  if v_create then
    insert into public.teachers(member_id,name,dept,region,position,tier,sort_order)
      values(p->>'memberId',fields->>'name',fields->>'dept',fields->>'region',fields->>'position','활동교사',
        coalesce((select max(sort_order) from public.teachers),0)+1) returning * into saved;
  else
    select * into before_row from public.teachers where nid=v_nid;
    before_fields:=jsonb_build_object('name',coalesce(before_row.name,''),'dept',coalesce(before_row.dept,''),
      'region',coalesce(before_row.region,''),'position',coalesce(before_row.position,''));
    if before_fields=fields then return jsonb_build_object('ok',true,'unchanged',true); end if;
    update public.teachers set name=fields->>'name',dept=fields->>'dept',region=fields->>'region',position=fields->>'position',updated_at=now()
      where member_id=before_row.member_id returning * into saved;
  end if;
  insert into public.roster_changes(changed_at,actor_id,actor_name,kind,target_id,target_name,before,after)
    values(timezone('Asia/Seoul',now()),p->>'actorId',p->>'actorName','직책 지정',saved.member_id,saved.name,before_fields,fields);
  return jsonb_build_object('ok',true,'created',v_create,'updated',not v_create,'memberId',saved.member_id,
    'name',saved.name,'dept',saved.dept,'region',saved.region,'position',saved.position);
end $fn$;
revoke all on function public.roster_leader_apply(jsonb) from public,anon,authenticated;
grant execute on function public.roster_leader_apply(jsonb) to service_role;
