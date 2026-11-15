-- 로컬 후보. 서비스 API가 허용한 역할·PIN을 저장 직전 대조한다. 일반 클라이언트는 실행할 수 없다.
create function public.sensitive_actor_valid(p jsonb) returns boolean
language plpgsql volatile security invoker set search_path=''
set lock_timeout='3s' set statement_timeout='10s' as $fn$
declare current_state jsonb; current_pin public.member_pins;
begin
  if coalesce(p->>'actorNid','')='' or public.norm_id(p->>'actorId') is distinct from p->>'actorNid'
    or jsonb_typeof(p->'actorState') is distinct from 'object' then return false; end if;
  -- 명단 가져오기·등급·겸직 모두 teachers → admins 순서로 잠근다.
  lock table public.teachers,public.admins in share mode;
  select * into current_pin from public.member_pins where nid=p->>'actorNid' for share;
  if not found or current_pin.pin_hash='' or current_pin.ver is distinct from p->>'actorVer' then return false; end if;
  select jsonb_build_object(
    'teacher',(select jsonb_build_array(t.member_id,t.name,t.dept,t.position) from public.teachers t
      where t.nid=p->>'actorNid' order by t.sort_order limit 1),
    'admins',coalesce((select jsonb_agg(jsonb_build_array(a.id,a.member_id,a.name,a.dept,a.position) order by a.id)
      from public.admins a where a.nid=p->>'actorNid'),'[]'::jsonb)) into current_state;
  return current_state=p->'actorState';
end $fn$;

create function public.tier_change_state(p_nids text[]) returns jsonb
language sql stable security invoker set search_path='' as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('member_id',t.member_id,'nid',t.nid,'name',t.name,'tier',t.tier,
    'revision',md5(to_jsonb(t)::text),'historyId',(select max(h.id) from public.tier_history h where h.member_id=t.member_id))
    order by t.member_id),'[]'::jsonb) from public.teachers t where t.nid=any(p_nids);
$fn$;

create function public.tier_change_apply(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path=''
set lock_timeout='3s' set statement_timeout='10s' as $fn$
declare current_state jsonb; n integer; v_day date:=timezone('Asia/Seoul',now())::date;
begin
  if jsonb_typeof(p->'writes') is distinct from 'array' or jsonb_typeof(p->'nids') is distinct from 'array'
    or jsonb_typeof(p->'expected') is distinct from 'array' then raise exception 'invalid tier change'; end if;
  n:=jsonb_array_length(p->'writes');
  if n<1 or n>500 or jsonb_array_length(p->'nids')>500 then raise exception 'invalid tier change count'; end if;
  lock table public.teachers,public.admins in share row exclusive mode;
  if not public.sensitive_actor_valid(p) then
    return jsonb_build_object('error','담당자 권한이나 로그인이 바뀌었어요. 다시 들어와 주세요.','stale',true);
  end if;
  current_state:=public.tier_change_state(array(select jsonb_array_elements_text(p->'nids')));
  if current_state is distinct from p->'expected' then
    return jsonb_build_object('error','명단이나 변경 이력이 바뀌었어요. 다시 확인해 주세요.','stale',true);
  end if;
  if (select count(distinct w->>'member_id') from jsonb_array_elements(p->'writes') w)<>n
    or exists(select 1 from jsonb_array_elements(p->'writes') w
      left join public.teachers t on t.member_id=w->>'member_id'
      where t.member_id is null or t.tier is distinct from w->>'prev_tier' or t.name is distinct from w->>'name'
        or not(t.nid=any(array(select jsonb_array_elements_text(p->'nids'))))
        or coalesce(w->>'new_tier','') not in ('기타','휴교사','활동교사','정교사','우수교사')
        or w->>'new_tier'=t.tier) then raise exception 'invalid tier change rows'; end if;
  update public.teachers t set tier=w.new_tier,tier_changed_at=v_day
    from jsonb_to_recordset(p->'writes') as w(member_id text,new_tier text) where t.member_id=w.member_id;
  insert into public.tier_history(changed_on,member_id,name,prev_tier,new_tier,reason,approver1)
    select v_day,w.member_id,w.name,w.prev_tier,w.new_tier,w.reason,'전도부 '||(p->>'actorName')
    from jsonb_to_recordset(p->'writes') as w(member_id text,name text,prev_tier text,new_tier text,reason text);
  insert into public.roster_changes(changed_at,actor_id,actor_name,kind,target_id,target_name,before,after)
    values(timezone('Asia/Seoul',now()),p->>'actorId',p->>'actorName','등급 일괄 변경','','',
      (select jsonb_agg(jsonb_build_object('memberId',w->>'member_id','name',w->>'name','tier',w->>'prev_tier')) from jsonb_array_elements(p->'writes') w),
      jsonb_build_object('변경',p->'writes','인원',n));
  return jsonb_build_object('ok',true,'count',n);
end $fn$;

-- 비밀번호 실패 한도는 날짜·계정별. 동시에 시도해도 5번까지만 기록하고 다른 담당자에게 전파하지 않는다.
-- 완료 기록은 파일 응답 준비를 뜻하며 브라우저의 실제 디스크 저장 증거가 아니다.
create function public.teacher_export_guard(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path=''
set lock_timeout='3s' set statement_timeout='10s' as $fn$
declare fail_key text; failures integer; v_day text:=timezone('Asia/Seoul',now())::date::text; v_summary text;
begin
  if coalesce(p->>'stage','') not in ('check','ready') or jsonb_typeof(p->'passwordOk') is distinct from 'boolean'
    or coalesce(p->>'action','') not in ('exportTeacherList','exportRosterSheet','exportNonParticipants','exportCalendarAttendees')
    then raise exception 'invalid export verification'; end if;
  fail_key:='exportFail:v2:'||v_day||':'||md5(p->>'actorNid');
  perform pg_catalog.pg_advisory_xact_lock(721612,pg_catalog.hashtext(fail_key));
  if not public.sensitive_actor_valid(p) then
    return jsonb_build_object('error','담당자 권한이나 로그인이 바뀌었어요. 다시 들어와 주세요.','stale',true);
  end if;
  select count(*) into failures from public.alert_log where dedup_key=fail_key;
  if failures>=5 then return jsonb_build_object('error','오늘은 비밀번호를 너무 많이 틀려서 잠겼어요. 내일 다시 해 주세요.'); end if;
  v_summary:=(p->>'action')||' · '||(p->>'actorName')||' '||(p->>'actorId');
  if not (p->>'passwordOk')::boolean then
    insert into public.alert_log(sent_at,kind,summary,ok,dedup_key)
      values(to_char(timezone('Asia/Seoul',now()),'YYYY-MM-DD HH24:MI'),'명단엑셀','비밀번호 틀림 · '||v_summary,false,fail_key);
    return jsonb_build_object('error','비밀번호가 맞지 않아요. (오늘 '||(4-failures)::text||'번 더 할 수 있어요)');
  end if;
  if p->>'stage'='ready' then
    insert into public.alert_log(sent_at,kind,summary,ok,dedup_key)
      values(to_char(timezone('Asia/Seoul',now()),'YYYY-MM-DD HH24:MI'),'명단엑셀',
        '파일 준비 · '||v_summary||' · '||coalesce(p->>'summary',''),true,'exportOk:v2:'||gen_random_uuid()::text);
  end if;
  return jsonb_build_object('ok',true);
end $fn$;
revoke all on function public.sensitive_actor_valid(jsonb),public.tier_change_state(text[]),public.tier_change_apply(jsonb),public.teacher_export_guard(jsonb) from public,anon,authenticated;
grant execute on function public.sensitive_actor_valid(jsonb),public.tier_change_state(text[]),public.tier_change_apply(jsonb),public.teacher_export_guard(jsonb) to service_role;
