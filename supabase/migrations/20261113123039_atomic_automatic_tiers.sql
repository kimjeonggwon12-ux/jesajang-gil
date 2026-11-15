-- 기존 자동 전환 규칙을 한 스냅샷에서 계산한다. 쓰기는 아래 함수에서 명단 잠금 이후 계산한다.
-- 즉시 활동 전환은 원래대로 번호 직접 일치·이번 달 시작 이후(상한 없음), 정기 전환은 이름 보정·월 경계를 사용한다.
create function public.auto_tier_plan(p_mode text,p_nid text,p_day date) returns jsonb
language sql stable security invoker set search_path='' as $fn$
 with bounds as (
  select greatest(date_trunc('month',p_day)::date,date '2026-11-05') cur_start,
    (date_trunc('month',p_day)+interval '1 month'-interval '1 day')::date cur_end,
    greatest((date_trunc('month',p_day)-interval '1 month')::date,date '2026-11-05') prev_start,
    (date_trunc('month',p_day)-interval '1 day')::date prev_end
 ), members as materialized (
  select member_id,nid,name,dept,tier,tier_changed_at,month_stats,sort_order from public.teachers
  where p_mode='daily' or nid=p_nid
  order by sort_order,member_id limit case when p_mode='daily' then null else 1 end
 ), known as (select distinct nid from public.teachers), names as (
  select name,min(nid) nid from public.teachers group by name having count(*)=1
 ), normalized as (
  select case when k.nid is not null then a.nid else coalesce(n.nid,a.nid) end nid,a.submitted_at::date record_day
  from public.activities a left join known k on k.nid=a.nid
   left join names n on n.name=public.app_trim(a.name) and k.nid is null
  cross join bounds b
  where p_mode='daily' and a.submitted_at is not null and isfinite(a.submitted_at)
    and a.submitted_at>=least(b.cur_start,b.prev_start)::timestamp and a.submitted_at<(b.cur_end+1)::timestamp
 ), activity_counts as (
  select nid,count(*) filter(where record_day between cur_start and cur_end) cur_n,
    count(*) filter(where record_day between prev_start and prev_end) prev_n
  from normalized,bounds where nid<>'0' group by nid
 ), attendance_counts as (
  select nid,count(distinct meeting_id) n from public.attend_records
  where p_mode in ('daily','attendance') and at>=timestamp '2026-11-05 00:00:00'
    and (p_mode='daily' or nid=p_nid) group by nid
 ), direct_count as (
  select least(count(*),1000) n from public.activities a,bounds b
  where p_mode='record' and exists(select 1 from members where tier in ('휴교사','기타')) and a.nid=p_nid and a.submitted_at>=b.cur_start::timestamp
 ), facts as (
  select m.*,coalesce(a.cur_n,0) cur_n,coalesce(a.prev_n,0) prev_n,coalesce(at.n,0) attend_n,
    d.n direct_n,b.*,
    m.tier='기타' or (m.month_stats->>'tierRaw'='기타' and m.tier='휴교사'
      and (m.tier_changed_at is null or m.tier_changed_at<=date '2026-11-05')) other_pending
  from members m cross join bounds b cross join direct_count d
    left join activity_counts a on a.nid=m.nid left join attendance_counts at on at.nid=m.nid
 ), decisions as (
  select f.*,case
    when p_mode='record' and tier in ('휴교사','기타') and direct_n>=4 then '활동교사'
    when p_mode='attendance' and other_pending and attend_n>=2 then '활동교사'
    when p_mode='daily' and tier in ('휴교사','기타') and cur_n>=4 then '활동교사'
    when p_mode='daily' and other_pending and attend_n>=2 then '활동교사'
    when p_mode='daily' and tier='활동교사' and prev_end>=date '2026-11-05'
      and (tier_changed_at is null or tier_changed_at<=prev_start) and prev_n<4 then '휴교사'
    end next_tier
  from facts f
 ), planned as (
  select *,case
    when next_tier='휴교사' then extract(month from prev_start)::int||'월 활동 기록 '||prev_n||'건(4건 미만) → 휴교사 전환'
    when p_mode='record' or (p_mode='daily' and tier in ('휴교사','기타') and cur_n>=4)
      then '이번 달 활동 기록 '||case when p_mode='record' then direct_n else cur_n end||'건 → 활동교사 전환'
    else '기타 → 출석 '||case when p_mode='attendance' then least(attend_n,50) else attend_n end||'번 → 활동교사 전환' end reason
  from decisions where next_tier is not null
 )
 select jsonb_build_object('month',jsonb_build_object('start',cur_start,'end',cur_end),
  'prevMonth',case when prev_end>=date '2026-11-05' then jsonb_build_object('start',prev_start,'end',prev_end) else null end,
  'changes',coalesce((select jsonb_agg(jsonb_build_object('t',jsonb_build_object('member_id',member_id,'nid',nid,'name',name,'dept',dept,'tier',tier),
    'tier',next_tier,'reason',reason) order by sort_order,member_id) from planned),'[]'::jsonb),
  'progress',(select case
    when p_mode='record' and tier in ('휴교사','기타') then jsonb_build_object('restCount',direct_n,'restGoal',4)
    when p_mode='attendance' and other_pending then jsonb_build_object('otherAttend',least(attend_n,50),'otherGoal',2)
    else null end from facts limit 1)) from bounds;
$fn$;

-- 하루 실행 표와 등급/이력이 함께 성공해야 완료다. 다른 자동 실행·수동 변경과 같은 명단 잠금을 사용한다.
create function public.auto_tier_apply(p_mode text,p_nid text,p_day date,p_once boolean) returns jsonb
language plpgsql volatile security invoker set search_path=''
set lock_timeout='3s' set statement_timeout='10s' as $fn$
declare plan jsonb; changes jsonb; day_key text; active_n integer; rest_n integer;
begin
  if coalesce(p_mode,'') not in ('daily','record','attendance') or p_day is null or p_once is null
    or (p_mode<>'daily' and (coalesce(p_nid,'')!~'^[1-9][0-9]{0,39}$' or p_once)) then
    raise exception 'invalid automatic tier request'; end if;
  day_key:='tierAuto:'||p_day::text;
  if p_once then
    perform pg_catalog.pg_advisory_xact_lock(721613,pg_catalog.hashtext(day_key));
    if exists(select 1 from public.alert_log where dedup_key=day_key) then
      return jsonb_build_object('ok',true,'already',true); end if;
  end if;
  -- 전환 후보가 아닌 일반 활동/출석은 전역 쓰기 잠금 없이 결과만 반환한다.
  if p_mode<>'daily' then
    plan:=public.auto_tier_plan(p_mode,p_nid,p_day);
    if jsonb_array_length(plan->'changes')=0 then return plan||jsonb_build_object('ok',true); end if;
  end if;
  lock table public.teachers in share row exclusive mode;
  -- 새 SELECT의 스냅샷에서 읽는다. 앞서 계산한 등급 목록을 요청자가 넣어 덮어쓸 수 없다.
  plan:=public.auto_tier_plan(p_mode,p_nid,p_day);changes:=plan->'changes';
  if jsonb_array_length(changes)>0 then
    update public.teachers t set tier=c->>'tier',tier_changed_at=p_day
      from jsonb_array_elements(changes) c where t.member_id=c->'t'->>'member_id';
    insert into public.tier_history(changed_on,member_id,name,prev_tier,new_tier,reason,approver1)
      select p_day,c->'t'->>'member_id',c->'t'->>'name',c->'t'->>'tier',c->>'tier',c->>'reason','자동(활동 기록)'
      from jsonb_array_elements(changes) c;
    insert into public.roster_changes(changed_at,actor_id,actor_name,kind,target_id,target_name,before,after)
      values(timezone('Asia/Seoul',now()),'','자동(활동 기록)','등급 자동 전환','','',
        (select jsonb_agg(jsonb_build_object('memberId',c->'t'->>'member_id','name',c->'t'->>'name','tier',c->'t'->>'tier')) from jsonb_array_elements(changes)c),
        jsonb_build_object('mode',p_mode,'day',p_day,'변경',(select jsonb_agg(jsonb_build_object('memberId',c->'t'->>'member_id','name',c->'t'->>'name','tier',c->>'tier','reason',c->>'reason')) from jsonb_array_elements(changes)c)));
  end if;
  if p_once then
    select count(*) filter(where c->>'tier'='활동교사'),count(*) filter(where c->>'tier'='휴교사')
      into active_n,rest_n from jsonb_array_elements(changes)c;
    insert into public.alert_log(sent_at,kind,summary,ok,dedup_key)
      values(to_char(timezone('Asia/Seoul',now()),'YYYY-MM-DD HH24:MI'),'등급자동',
        '활동교사 전환 '||active_n||'명 · 휴교사 전환 '||rest_n||'명',true,day_key);
  end if;
  return plan||jsonb_build_object('ok',true);
end $fn$;
revoke all on function public.auto_tier_plan(text,text,date),public.auto_tier_apply(text,text,date,boolean) from public,anon,authenticated;
grant execute on function public.auto_tier_plan(text,text,date),public.auto_tier_apply(text,text,date,boolean) to service_role;
