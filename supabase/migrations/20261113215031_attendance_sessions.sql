-- 하루 인원/등급 계산의 기존 한 행을 유지하고, 추가 타임만 같은 행에 보존한다.
-- 운영 미적용. 서버 전용 함수이며 모임 변경과 같은 번호의 동시 제출을 함께 확인한다.
alter table public.attend_records add column additional_records jsonb not null default '[]';
alter table public.attend_records add constraint attend_records_sessions_check
  check (jsonb_typeof(additional_records) = 'array' and jsonb_array_length(additional_records) <= 4);

create function public.attendance_slot_start(p_slots jsonb, p_open_before integer, p_date text, p_at timestamp)
returns text language plpgsql immutable security invoker set search_path = '' as $$
declare slots jsonb; s jsonb; hit text;
begin
  select coalesce(jsonb_agg(x order by x->>'start'),'[]') into slots from (
    select jsonb_build_object('start',lpad(a[1],2,'0')||':'||a[2], 'end',lpad(b[1],2,'0')||':'||b[2]) x
    from jsonb_array_elements(case when jsonb_typeof(p_slots)='array' then p_slots else '[]' end) v
    cross join lateral regexp_match(trim(v->>'start'),'^(\d{1,2}):(\d{2})') a
    cross join lateral regexp_match(trim(v->>'end'),'^(\d{1,2}):(\d{2})') b
    where lpad(b[1],2,'0')||':'||b[2] > lpad(a[1],2,'0')||':'||a[2]
    order by lpad(a[1],2,'0')||':'||a[2] limit 5
  ) cleaned;
  if jsonb_array_length(slots)<2 then return ''; end if;
  hit:=slots->0->>'start';
  -- 자정 직후 모임의 전날 조기 입장도 첫 타임이다.
  if p_at::date::text < p_date then return hit; end if;
  for s in select value from jsonb_array_elements(slots) loop
    if p_at >= (p_date||' '||(s->>'start'))::timestamp - make_interval(mins=>case when p_open_before>=0 then p_open_before else 30 end) then hit:=s->>'start'; end if;
  end loop;
  return hit;
end $$;

create function public.attendance_late_text(p_meeting jsonb,p_at timestamp)
returns text language plpgsql immutable security invoker set search_path = '' as $$
declare base text; seconds integer;
begin
  if coalesce(p_meeting->>'start_time','')='' or coalesce(p_meeting->>'date','')='' or p_at is null then return ''; end if;
  base:=public.attendance_slot_start(p_meeting->'slots',(p_meeting->>'open_before')::integer,p_meeting->>'date',p_at);
  if base='' then base:=case when coalesce(p_meeting->>'start2','')<>'' and p_at::time>='15:00' then p_meeting->>'start2' else p_meeting->>'start_time' end; end if;
  if p_at::date::text<>p_meeting->>'date' then return '정상 출석'; end if;
  seconds:=extract(epoch from p_at-(p_at::date::text||' '||base)::timestamp);
  return case when seconds>0 then greatest(1,seconds/60)::text||'분 지각' else '정상 출석' end;
end $$;

create function public.attendance_session_submit(p_record jsonb,p_expected jsonb)
returns jsonb language plpgsql security invoker set search_path = '' set lock_timeout = '2s' as $$
declare m public.attend_meetings; r public.attend_records; candidate public.attend_records;
  state jsonb; item jsonb; detail jsonb; target_slot text; nid_key text;
begin
  candidate:=jsonb_populate_record(null::public.attend_records,p_record);
  nid_key:=public.norm_id(candidate.member_id);
  if candidate.at is null or coalesce(candidate.record_id,'')='' or nid_key='0' then raise exception 'invalid attendance input'; end if;
  select * into m from public.attend_meetings where meeting_id=candidate.meeting_id for share;
  if not found or m.status in ('닫힘','집계완료','삭제') then return jsonb_build_object('errorCode','meeting_changed'); end if;
  select jsonb_object_agg(key,value) into state from jsonb_each(to_jsonb(m))
    where key=any(array['date','start_time','end_time','open_before','questions','status','slots','cohort_id','series_id','org','district','ask_district','ask_dept','start2']);
  if state is distinct from p_expected then return jsonb_build_object('errorCode','meeting_changed'); end if;
  target_slot:=public.attendance_slot_start(m.slots,m.open_before,m.date,candidate.at);
  if target_slot='' then return jsonb_build_object('errorCode','meeting_changed'); end if;
  -- 서버가 검사한 설정은 위 잠금 동안 바뀌지 않는다. 시간/설문/신원은 서버에서만 만든다.
  perform pg_advisory_xact_lock(hashtextextended('attendance|'||m.meeting_id||'|'||nid_key,0));
  select * into r from public.attend_records where meeting_id=m.meeting_id and nid=nid_key order by id limit 1 for update;
  if not found then
    insert into public.attend_records(record_id,meeting_id,member_id,name,dept,position,answers,at,method,pick_org,pick_district,dept24,late)
      values(candidate.record_id,m.meeting_id,candidate.member_id,candidate.name,candidate.dept,candidate.position,candidate.answers,candidate.at,candidate.method,candidate.pick_org,candidate.pick_district,candidate.dept24,candidate.late)
      on conflict do nothing returning * into r;
    if found then return jsonb_build_object('record',to_jsonb(r),'firstAttendance',true); end if;
    select * into r from public.attend_records where meeting_id=m.meeting_id and nid=nid_key order by id limit 1 for update;
    if not found then raise exception 'attendance conflict'; end if;
  end if;
  for item in select value from jsonb_array_elements(jsonb_build_array(to_jsonb(r)-'additional_records')||r.additional_records) loop
    if public.attendance_slot_start(m.slots,m.open_before,m.date,(item->>'at')::timestamp)=target_slot then
      return jsonb_build_object('already',true,'record',(to_jsonb(r)-'additional_records')||item);
    end if;
  end loop;
  if jsonb_array_length(r.additional_records)>=4 then return jsonb_build_object('errorCode','session_limit'); end if;
  select jsonb_object_agg(key,value) into detail from jsonb_each(p_record)
    where key=any(array['record_id','at','answers','method','pick_org','pick_district','dept24','late']);
  update public.attend_records set additional_records=additional_records||jsonb_build_array(detail) where id=r.id;
  return jsonb_build_object('record',(to_jsonb(r)-'additional_records')||detail,'firstAttendance',false);
end $$;

-- 모임 설정 잠금 → 출석 행 순서. 추가 타임 제출과 재계산이 서로 덮어쓰지 않는다.
create function public.attendance_evening_start(p_meeting_id text,p_start2 text)
returns integer language plpgsql security invoker set search_path = '' set lock_timeout = '2s' as $$
declare m public.attend_meetings; r public.attend_records; new_late text; extras jsonb; changed integer:=0;
begin
  update public.attend_meetings set start2=p_start2 where meeting_id=p_meeting_id returning * into m;
  if not found then raise exception 'meeting not found'; end if;
  for r in select * from public.attend_records where meeting_id=p_meeting_id order by id for update loop
    new_late:=public.attendance_late_text(to_jsonb(m),r.at);
    select coalesce(jsonb_agg(v||jsonb_build_object('late',public.attendance_late_text(to_jsonb(m),(v->>'at')::timestamp)) order by ord),'[]') into extras
      from jsonb_array_elements(r.additional_records) with ordinality as a(v,ord);
    if r.late is distinct from new_late or r.additional_records is distinct from extras then
      update public.attend_records set late=new_late,additional_records=extras where id=r.id;
      changed:=changed+1;
    end if;
  end loop;
  return changed;
end $$;

revoke all on function public.attendance_slot_start(jsonb,integer,text,timestamp),public.attendance_late_text(jsonb,timestamp),public.attendance_session_submit(jsonb,jsonb),public.attendance_evening_start(text,text) from public,anon,authenticated;
grant execute on function public.attendance_slot_start(jsonb,integer,text,timestamp),public.attendance_late_text(jsonb,timestamp),public.attendance_session_submit(jsonb,jsonb),public.attendance_evening_start(text,text) to service_role;
comment on column public.attend_records.additional_records is '같은 날 같은 모임의 추가 타임. 하루 참석·등급은 원래 한 행으로 계산한다.';
