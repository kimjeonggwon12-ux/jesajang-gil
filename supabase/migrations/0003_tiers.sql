-- 3단계: 등급 심사 (시트 "등급변경승인", "등급변경이력")

-- 2인 승인 대기 줄 + 사유자 등록. 승인자1 = 교관, 승인자2 = 지역장.
create table if not exists tier_approvals (
  id             bigint generated always as identity primary key,
  member_id      text not null default '',
  nid            text generated always as (norm_id(member_id)) stored,
  name           text not null default '',
  current_tier   text not null default '',
  suggested_tier text not null default '',
  reason         text not null default '',
  type           text not null default 'auto',      -- auto | reason(사유자)
  coach_approver  text not null default '',
  coach_approved_at  timestamp,
  leader_approver text not null default '',
  leader_approved_at timestamp,
  status         text not null default '대기',       -- 대기 | 완료 | 실패
  recorded_at    timestamp
);
create index if not exists tier_approvals_pending_idx on tier_approvals (nid, suggested_tier) where status = '대기';

-- 실제 반영된 등급 변경
create table if not exists tier_history (
  id         bigint generated always as identity primary key,
  changed_on date,
  member_id  text not null default '',
  name       text not null default '',
  prev_tier  text not null default '',
  new_tier   text not null default '',
  reason     text not null default '',
  approver1  text not null default '',
  approver2  text not null default ''
);
create index if not exists tier_history_member_idx on tier_history (member_id);

alter table tier_approvals enable row level security;
alter table tier_history enable row level security;
