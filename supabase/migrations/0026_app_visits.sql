-- 2026-10-20: 교사가 앱에 몇 번 들어왔는지 — 관리자 교사 명단의 '접속' 열(교관이 봄).
--   한 번 들어옴 = 앱을 새로 열어 입장(같은 창에서 새로 고침·탭 이동은 세지 않음).
create table if not exists app_visits (
  nid        text primary key,
  member_id  text not null default '',
  name       text not null default '',
  visits     integer not null default 0,
  past_days  integer not null default 0,            -- 10/20 이전: 앱에 기록을 남긴 날 수(접속 기록이 없던 때의 추정)
  first_at   timestamp,
  last_at    timestamp
);
alter table app_visits enable row level security;

create or replace function bump_app_visit(p_nid text, p_member_id text, p_name text, p_now timestamp)
returns integer
language sql security invoker as $fn$
  insert into app_visits as v (nid, member_id, name, visits, first_at, last_at)
  values (p_nid, p_member_id, p_name, 1, p_now, p_now)
  on conflict (nid) do update
     set visits = v.visits + 1, last_at = p_now, member_id = excluded.member_id,
         name = case when excluded.name <> '' then excluded.name else v.name end
  returning visits;
$fn$;
revoke execute on function bump_app_visit(text, text, text, timestamp) from public, anon, authenticated;
grant execute on function bump_app_visit(text, text, text, timestamp) to service_role;

-- 과거분 채우기(한 번): 앱에서 무엇이든 기록을 남긴 날 = 들어온 날 1번.
--   활동 기록·출석·상담 신청·글/댓글·섭외자 단계·명함·인강·응원·행사 신청·교재 신청·도움 요청·메시지·협력 요청.
with ev(nid, mid, nm, at) as (
            select nid, member_id, name, submitted_at from activities
  union all select nid, member_id, name, at from attend_records
  union all select nid, member_id, name, submitted_at from feedbacks
  union all select nid, member_id, name, created_at from plaza_posts
  union all select norm_id(member_id), member_id, name, created_at from plaza_comments
  union all select nid, member_id, '', changed_at from target_history
  union all select creator_nid, creator_id, teacher_name, created_at from targets
  union all select nid, member_id, name, updated_at from connect_cards
  union all select nid, member_id, '', updated_at from teacher_profiles
  union all select nid, member_id, name, updated_at from lecture_progress
  union all select nid, member_id, name, created_at from event_cheers
  union all select norm_id(member_id), member_id, name, applied_at from event_staff
  union all select norm_id(applicant_id), applicant_id, applicant_name, applied_at from event_attendees
  union all select norm_id(member_id), member_id, '', applied_at from board_applies
  union all select norm_id(member_id), member_id, name, requested_at from textbook_wishes
  union all select norm_id(member_id), member_id, name, created_at from help_posts
  union all select norm_id(member_id), member_id, name, created_at from request_comments
  union all select from_nid, from_id, '', sent_at from chat_messages
  union all select norm_id(from_id), from_id, from_name, sent_at from encouragements
  union all select norm_id(from_id), from_id, from_name, requested_at from coop_requests
), days as (
  select nid, max(mid) mid, max(nm) nm, count(distinct at::date) n, min(at) first_at, max(at) last_at
    from ev where nid is not null and nid <> '' and at is not null group by nid
)
insert into app_visits (nid, member_id, name, visits, past_days, first_at, last_at)
select nid, coalesce(mid, ''), coalesce(nm, ''), n, n, first_at, last_at from days
on conflict (nid) do update
   set past_days = excluded.past_days,
       visits = app_visits.visits - app_visits.past_days + excluded.past_days,
       first_at = least(app_visits.first_at, excluded.first_at),
       name = case when app_visits.name <> '' then app_visits.name else excluded.name end;
