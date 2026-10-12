-- 11단계: 월별 엑셀 반영(한 번에, 되돌릴 수 있게) + 백업 목록

-- 엑셀을 반영하기 직전의 명단을 통째로 남겨 둔다(잘못 반영했을 때 되돌리는 근거).
create table if not exists roster_snapshots (
  id         bigint generated always as identity primary key,
  taken_at   timestamp not null,
  actor_id   text not null default '',
  actor_name text not null default '',
  reason     text not null default '',
  teachers   jsonb not null                       -- 그때의 teachers 표 전체
);

-- 명단을 한 번에 바꾼다: 넣거나 고칠 줄(p_rows)과 뺄 번호(p_remove). 중간에 실패하면 아무것도 바뀌지 않는다.
create or replace function roster_apply(p_rows jsonb, p_remove text[]) returns json
language plpgsql as $fn$
declare
  n_upsert integer;
  n_delete integer;
begin
  delete from teachers where member_id = any(p_remove);
  get diagnostics n_delete = row_count;

  insert into teachers (member_id, name, dept, region, affiliation, position, tier, note, tier_changed_at,
                        reg_leads, unreg_leads, counsel, gospel_room, companion, active_state, sort_order, updated_at)
  select r.member_id, r.name, r.dept, r.region, r.affiliation, r.position, r.tier, r.note, r.tier_changed_at,
         r.reg_leads, r.unreg_leads, r.counsel, r.gospel_room, r.companion, r.active_state, r.sort_order, now()
    from jsonb_to_recordset(p_rows) as r(
      member_id text, name text, dept text, region text, affiliation text, position text, tier text, note text, tier_changed_at date,
      reg_leads integer, unreg_leads integer, counsel integer, gospel_room integer, companion integer, active_state text, sort_order integer)
  on conflict (member_id) do update set
    name = excluded.name, dept = excluded.dept, region = excluded.region, affiliation = excluded.affiliation,
    position = excluded.position, tier = excluded.tier, note = excluded.note, tier_changed_at = excluded.tier_changed_at,
    reg_leads = excluded.reg_leads, unreg_leads = excluded.unreg_leads, counsel = excluded.counsel,
    gospel_room = excluded.gospel_room, companion = excluded.companion, active_state = excluded.active_state,
    sort_order = excluded.sort_order, updated_at = now();
  get diagnostics n_upsert = row_count;
  return json_build_object('saved', n_upsert, 'removed', n_delete);
end
$fn$;

-- 백업할 표 이름들(새 표를 만들어도 백업에서 빠지지 않게 DB 에서 직접 읽는다).
create or replace function backup_tables() returns setof text
language sql stable as $fn$
  select table_name::text from information_schema.tables
   where table_schema = 'public' and table_type = 'BASE TABLE' and table_name not in ('work_locks', 'attend_notify_queue')
   order by table_name
$fn$;

alter table roster_snapshots enable row level security;
revoke execute on function roster_apply(jsonb, text[]) from public, anon, authenticated;
revoke execute on function backup_tables() from public, anon, authenticated;
grant execute on function roster_apply(jsonb, text[]) to service_role;
grant execute on function backup_tables() to service_role;
