-- 서버가 확인한 담당자와 선택한 겸직 한 건만 처리한다. 변경과 감사 기록은 함께 성공/취소한다.
create function public.admin_assignment_apply(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path=''
set lock_timeout='3s' set statement_timeout='10s' as $fn$
declare
  current_state jsonb; actor_state jsonb; before_row public.admins; saved public.admins;
  v_nid text:=p->>'nid'; v_id bigint; v_on boolean; v_fields jsonb:=p->'fields'; v_kind text;
begin
  if coalesce(v_nid,'') !~ '^[1-9][0-9]{0,39}$' or jsonb_typeof(p->'on') is distinct from 'boolean'
    or jsonb_typeof(p->'expected') is distinct from 'array' or coalesce(p->>'actorId','')=''
    or coalesce(p->>'actorNid','')='' then raise exception 'invalid admin assignment change'; end if;
  v_on:=(p->>'on')::boolean;
  -- 구형 도구의 쓰기도 잠깐 직렬화한다. 운영 잠금/적용 순서는 별도 리허설 대상이다.
  lock table public.teachers,public.admins in share row exclusive mode;
  select jsonb_build_object(
    'teacher',(select jsonb_build_array(t.member_id,t.name,t.dept,t.position) from public.teachers t
      where t.nid=p->>'actorNid' order by t.sort_order limit 1),
    'admins',coalesce((select jsonb_agg(jsonb_build_array(a.id,a.member_id,a.name,a.dept,a.position) order by a.id)
      from public.admins a where a.nid=p->>'actorNid'),'[]'::jsonb)
  ) into actor_state;
  if actor_state is distinct from p->'actorState' then
    return jsonb_build_object('error','담당자 권한이 바뀌었어요. 다시 로그인하고 확인해 주세요.','stale',true);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('assignmentId',a.id,'name',a.name,'dept',a.dept,
    'region',a.region,'position',a.position,'phone',a.phone) order by a.id),'[]'::jsonb)
    into current_state from public.admins a where a.nid=v_nid;
  if current_state is distinct from p->'expected' then
    return jsonb_build_object('error','겸직 정보가 바뀌었어요. 명단을 다시 찾아서 확인해 주세요.','stale',true);
  end if;
  if p->>'assignmentId'='new' then
    if not v_on then raise exception 'invalid new assignment removal'; end if;
  else
    v_id:=(p->>'assignmentId')::bigint;
    select * into before_row from public.admins a where a.id=v_id and a.nid=v_nid;
    if not found then return jsonb_build_object('error','보직을 찾을 수 없어요. 다시 조회해 주세요.','stale',true); end if;
  end if;
  if not v_on then
    if v_nid=p->>'actorNid' then raise exception 'self assignment removal denied'; end if;
    delete from public.admins where id=v_id and nid=v_nid;
    v_kind:='관리자 해제';
  else
    if jsonb_typeof(v_fields) is distinct from 'object'
      or coalesce(btrim(v_fields->>'name'),'')='' or coalesce(btrim(v_fields->>'dept'),'')=''
      or coalesce(btrim(v_fields->>'position'),'')='' then raise exception 'invalid assignment fields'; end if;
    if exists(select 1 from public.admins a where a.nid=v_nid and a.id is distinct from v_id
      and a.dept=v_fields->>'dept' and a.region=v_fields->>'region' and a.position=v_fields->>'position') then
      return jsonb_build_object('error','같은 부서·지역·직책의 보직이 이미 있어요.');
    end if;
    if v_id is null then
      if public.norm_id(p->>'memberId')<>v_nid then raise exception 'assignment identity mismatch'; end if;
      insert into public.admins(member_id,name,dept,region,position,phone)
        values(p->>'memberId',v_fields->>'name',v_fields->>'dept',v_fields->>'region',v_fields->>'position',v_fields->>'phone')
        returning * into saved;
      v_kind:='관리자 지정';
    else
      if jsonb_build_object('name',before_row.name,'dept',before_row.dept,'region',before_row.region,
        'position',before_row.position,'phone',before_row.phone)=v_fields then
        return jsonb_build_object('ok',true,'unchanged',true,'admin',to_jsonb(before_row));
      end if;
      update public.admins set name=v_fields->>'name',dept=v_fields->>'dept',region=v_fields->>'region',
        position=v_fields->>'position',phone=v_fields->>'phone' where id=v_id and nid=v_nid returning * into saved;
      v_kind:='관리자 수정';
    end if;
  end if;
  insert into public.roster_changes(changed_at,actor_id,actor_name,kind,target_id,target_name,before,after)
    values(timezone('Asia/Seoul',now()),p->>'actorId',p->>'actorName',v_kind,
      coalesce(saved.member_id,before_row.member_id),coalesce(saved.name,before_row.name),
      case when before_row.id is null then null else jsonb_build_object('assignmentId',before_row.id,
        'name',before_row.name,'dept',before_row.dept,'region',before_row.region,'position',before_row.position,'phone',before_row.phone) end,
      case when not v_on then null else jsonb_build_object('assignmentId',saved.id,
        'name',saved.name,'dept',saved.dept,'region',saved.region,'position',saved.position,'phone',saved.phone) end);
  return jsonb_build_object('ok',true,'created',v_on and v_id is null,'admin',case when v_on then to_jsonb(saved) else null end);
end $fn$;
revoke all on function public.admin_assignment_apply(jsonb) from public,anon,authenticated;
grant execute on function public.admin_assignment_apply(jsonb) to service_role;
