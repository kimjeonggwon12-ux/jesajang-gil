-- 11/4(사용자): 새 교사관리 엑셀(신43 교사활동현황)의 부서 기록(교육·상담·복음방·식구복방·동행교사·과제제출)과
--   전도부 기록(인도·교사·섬김)·활동·우수/정·구분을 교사마다 그대로 담아 둔다(명단 화면 표시용). 등급(tier)은 따로.
alter table teachers add column if not exists month_stats jsonb;

create or replace function roster_apply(p_rows jsonb, p_remove text[]) returns json
language plpgsql as $fn$
declare
  n_upsert integer;
  n_delete integer;
begin
  delete from teachers where member_id = any(p_remove);
  get diagnostics n_delete = row_count;

  insert into teachers (member_id, name, dept, region, affiliation, position, tier, note, tier_changed_at,
                        reg_leads, unreg_leads, counsel, gospel_room, companion, active_state, month_stats, sort_order, updated_at)
  select r.member_id, r.name, r.dept, r.region, r.affiliation, r.position, r.tier, r.note, r.tier_changed_at,
         r.reg_leads, r.unreg_leads, r.counsel, r.gospel_room, r.companion, r.active_state, r.month_stats, r.sort_order, now()
    from jsonb_to_recordset(p_rows) as r(
      member_id text, name text, dept text, region text, affiliation text, position text, tier text, note text, tier_changed_at date,
      reg_leads integer, unreg_leads integer, counsel integer, gospel_room integer, companion integer, active_state text,
      month_stats jsonb, sort_order integer)
  on conflict (member_id) do update set
    name = excluded.name, dept = excluded.dept, region = excluded.region, affiliation = excluded.affiliation,
    position = excluded.position, tier = excluded.tier, note = excluded.note, tier_changed_at = excluded.tier_changed_at,
    reg_leads = excluded.reg_leads, unreg_leads = excluded.unreg_leads, counsel = excluded.counsel,
    gospel_room = excluded.gospel_room, companion = excluded.companion, active_state = excluded.active_state,
    month_stats = excluded.month_stats, sort_order = excluded.sort_order, updated_at = now();
  get diagnostics n_upsert = row_count;
  return json_build_object('saved', n_upsert, 'removed', n_delete);
end
$fn$;

revoke execute on function roster_apply(jsonb, text[]) from public, anon, authenticated;
grant execute on function roster_apply(jsonb, text[]) to service_role;
