-- 명단 한 명의 변경도 검토한 상태·담당자·PIN을 대조하고 이력과 함께 확정한다.
create function public.roster_member_state(p_nids text[]) returns jsonb
language sql stable security invoker set search_path='' as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('row',to_jsonb(t),'revision',
    md5(to_jsonb(t)::text||coalesce((select max(c.id)::text from public.roster_changes c where c.target_id=t.member_id),'')))
    order by t.sort_order,t.member_id),'[]'::jsonb)
  from public.teachers t where t.nid=any(p_nids);
$fn$;

create function public.roster_member_apply(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path=''
set lock_timeout='3s' set statement_timeout='10s' as $fn$
declare
  v_mode text:=p->>'mode'; v_nid text:=p->>'nid'; fields jsonb:=p->'fields';
  current_state jsonb; before_row public.teachers; saved public.teachers; v_kind text;
begin
  if coalesce(v_mode,'') not in ('create','update','remove')
    or coalesce(v_nid,'') !~ '^[1-9][0-9]{0,39}$' or public.norm_id(p->>'memberId')<>v_nid
    or jsonb_typeof(p->'expected') is distinct from 'array' then raise exception 'invalid roster member change'; end if;
  lock table public.teachers,public.admins in share row exclusive mode;
  if not public.sensitive_actor_valid(p) then
    return jsonb_build_object('error','담당자 권한이나 로그인이 바뀌었어요. 다시 들어와 주세요.','stale',true);
  end if;
  current_state:=public.roster_member_state(array[v_nid]);
  if current_state is distinct from p->'expected' then
    return jsonb_build_object('error','명단이 바뀌었어요. 다시 찾아서 확인해 주세요.','stale',true);
  end if;
  if jsonb_array_length(current_state)>1 then
    return jsonb_build_object('error','고유번호가 중복된 명단입니다. 담당자 확인이 필요해요.'); end if;
  if v_mode='create' and jsonb_array_length(current_state)<>0 then
    return jsonb_build_object('error','이미 명단에 있는 번호예요. 다시 찾아 주세요.','stale',true);
  elsif v_mode<>'create' and jsonb_array_length(current_state)<>1 then
    return jsonb_build_object('error','명단에서 찾을 수 없어요. 다시 찾아 주세요.','stale',true);
  end if;
  if v_mode<>'create' then
    select * into before_row from public.teachers where nid=v_nid;
  end if;
  if v_mode='remove' then
    delete from public.teachers where member_id=before_row.member_id;
    v_kind:='교사 삭제';
  else
    if jsonb_typeof(fields) is distinct from 'object' or coalesce(btrim(fields->>'name'),'')=''
      or coalesce(btrim(fields->>'dept'),'')='' then raise exception 'invalid teacher fields'; end if;
    if v_mode='create' then
      insert into public.teachers(member_id,name,dept,region,affiliation,position,note,tier,sort_order)
        values(p->>'memberId',fields->>'name',fields->>'dept',fields->>'region',fields->>'affiliation',fields->>'position',fields->>'note',
          '활동교사',coalesce((select max(sort_order) from public.teachers),0)+1) returning * into saved;
      v_kind:='교사 추가';
    else
      if jsonb_build_object('name',before_row.name,'dept',before_row.dept,'region',before_row.region,
        'affiliation',before_row.affiliation,'position',before_row.position,'note',before_row.note)=fields then
        return jsonb_build_object('ok',true,'unchanged',true,'member',to_jsonb(before_row)); end if;
      update public.teachers set name=fields->>'name',dept=fields->>'dept',region=fields->>'region',
        affiliation=fields->>'affiliation',position=fields->>'position',note=fields->>'note',updated_at=now()
        where member_id=before_row.member_id returning * into saved;
      v_kind:='교사 수정';
    end if;
  end if;
  insert into public.roster_changes(changed_at,actor_id,actor_name,kind,target_id,target_name,before,after)
    values(timezone('Asia/Seoul',now()),p->>'actorId',p->>'actorName',v_kind,
      coalesce(saved.member_id,before_row.member_id),coalesce(saved.name,before_row.name),
      case when before_row.member_id is null then null else jsonb_build_object('name',before_row.name,'dept',before_row.dept,
        'region',before_row.region,'affiliation',before_row.affiliation,'position',before_row.position,'note',before_row.note,'tier',before_row.tier) end,
      case when v_mode='remove' then null else jsonb_build_object('name',saved.name,'dept',saved.dept,
        'region',saved.region,'affiliation',saved.affiliation,'position',saved.position,'note',saved.note,'tier',saved.tier) end);
  return jsonb_build_object('ok',true,'created',v_mode='create','member',case when v_mode='remove' then null else to_jsonb(saved) end);
end $fn$;
revoke all on function public.roster_member_state(text[]),public.roster_member_apply(jsonb) from public,anon,authenticated;
grant execute on function public.roster_member_state(text[]),public.roster_member_apply(jsonb) to service_role;
