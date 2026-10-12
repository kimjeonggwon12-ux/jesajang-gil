-- 2단계: 활동 기록 · 격려 메시지 · 인도 실적 · 전도 대상자
-- 시각은 모두 한국 시간 그대로(timestamp, 시간대 없음) 저장한다 — 시트에 적히던 값과 같다.
-- id 는 시트의 행 순서 역할(같은 시각이면 먼저 적힌 것이 앞).

-- 시트 "활동실적"
create table if not exists activities (
  id               bigint generated always as identity primary key,
  member_id        text not null default '',
  nid              text generated always as (norm_id(member_id)) stored,
  name             text not null default '',
  submitted_at     timestamp,
  activities       text[] not null default '{}',   -- 선택활동
  note             text not null default '',       -- 문의사항
  roles            text[] not null default '{}',   -- 역할
  target_name      text not null default '',
  target_gender    text not null default '',
  target_age_group text not null default '',
  target_stage     text not null default '',
  special_note     text not null default '',       -- 특이사항
  today_work       text not null default '',
  next_work        text not null default '',
  target_dept      text not null default '',
  consult_title    text not null default '',
  gospel_subject   text not null default '',
  reaction         text not null default '',
  reaction_note    text not null default ''
);
create index if not exists activities_nid_idx on activities (nid);
create index if not exists activities_submitted_idx on activities (submitted_at desc);
create index if not exists activities_target_name_idx on activities (target_name);

-- 시트 "격려메시지"
create table if not exists encouragements (
  id        bigint generated always as identity primary key,
  from_id   text not null default '',
  from_name text not null default '',
  to_id     text not null default '',
  to_nid    text generated always as (norm_id(to_id)) stored,
  message   text not null default '',
  sent_at   timestamp,
  is_read   boolean not null default false
);
create index if not exists encouragements_to_idx on encouragements (to_nid);

-- 시트 "센터인도실적" / "복음방인도실적" (구조가 같다)
create table if not exists center_leads (
  id            bigint generated always as identity primary key,
  member_id     text not null default '',
  nid           text generated always as (norm_id(member_id)) stored,
  name          text not null default '',
  lead_date     date,
  lead_name     text not null default '',          -- 인도받은사람이름
  registered_by text not null default ''
);
create index if not exists center_leads_nid_idx on center_leads (nid);

create table if not exists gospel_leads (like center_leads including all);

-- 시트 "전도대상자"
create table if not exists targets (
  id                 bigint generated always as identity primary key,
  target_id          text not null unique,
  creator_id         text not null default '',     -- 최초 등록 교사
  creator_nid        text generated always as (norm_id(creator_id)) stored,
  teacher_name       text not null default '',
  target_name        text not null default '',
  stage              text not null default '',
  next_meeting_date  text not null default '',
  memo               text not null default '',
  created_at         timestamp,
  updated_at         timestamp,
  completed          boolean not null default false,
  gender             text not null default '',
  age_group          text not null default '',
  leader_id          text not null default '',     -- 담당 인도자
  leader_nid         text generated always as (case when leader_id = '' then null else norm_id(leader_id) end) stored,
  helper_id          text not null default '',     -- 담당 섬김이
  helper_nid         text generated always as (case when helper_id = '' then null else norm_id(helper_id) end) stored,
  teacher_change_log text not null default ''
);
create index if not exists targets_creator_idx on targets (creator_nid);
create index if not exists targets_leader_idx on targets (leader_nid);
create index if not exists targets_helper_idx on targets (helper_nid);

-- 시트 "전도대상자이력"
create table if not exists target_history (
  id         bigint generated always as identity primary key,
  member_id  text not null default '',
  nid        text generated always as (norm_id(member_id)) stored,
  target_id  text not null default '',
  changed_at timestamp,
  from_stage text not null default '',
  to_stage   text not null default '',
  memo       text not null default ''
);
create index if not exists target_history_target_idx on target_history (target_id);

alter table activities enable row level security;
alter table encouragements enable row level security;
alter table center_leads enable row level security;
alter table gospel_leads enable row level security;
alter table targets enable row level security;
alter table target_history enable row level security;
