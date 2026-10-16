-- 14단계: 교육 과정(교육생 반) — 앱 관리자(7777)만 만든다.
-- 교육명칭 + 교육생(교회·이름·고유번호)을 등록하고, 과정마다 출석·과제 제출을 켜고 끈다.
-- 출석은 기존 QR 출석 모임(attend_meetings)에 cohort_id 를 달아 연결하고, 알림·집계는 과정의 텔레그램 방으로 보낸다.

create table if not exists cohorts (
  id          bigint generated always as identity primary key,
  cohort_id   text not null unique,
  title       text not null,                         -- 교육명칭
  status      text not null default '진행',           -- 진행 | 종료 | 삭제
  use_attend  boolean not null default true,         -- 출석 기능 사용
  use_assign  boolean not null default false,        -- 과제 제출 기능 사용
  tg_chat     text not null default '',              -- 알림·집계를 보낼 텔레그램 방(chat id). 비면 출석 봇 기본 방
  created_by  text not null default '',
  created_at  timestamp,
  updated_at  timestamp
);

create table if not exists cohort_members (
  id          bigint generated always as identity primary key,
  cohort_id   text not null,
  member_id   text not null,
  nid         text generated always as (norm_id(member_id)) stored,
  name        text not null default '',
  church      text not null default '',
  added_by    text not null default '',
  added_at    timestamp
);
create unique index if not exists cohort_members_once_idx on cohort_members (cohort_id, nid);
create index if not exists cohort_members_nid_idx on cohort_members (nid);

create table if not exists cohort_assignments (
  id            bigint generated always as identity primary key,
  assignment_id text not null unique,
  cohort_id     text not null,
  title         text not null,
  guide         text not null default '',            -- 과제 설명
  due           text not null default '',            -- 'yyyy-MM-dd' (비면 기한 없음)
  status        text not null default '열림',          -- 열림 | 닫힘 | 삭제
  created_at    timestamp
);
create index if not exists cohort_assignments_cohort_idx on cohort_assignments (cohort_id);

create table if not exists cohort_submissions (
  id            bigint generated always as identity primary key,
  assignment_id text not null,
  cohort_id     text not null,
  member_id     text not null,
  nid           text generated always as (norm_id(member_id)) stored,
  name          text not null default '',
  content       text not null default '',
  submitted_at  timestamp,
  updated_at    timestamp
);
create unique index if not exists cohort_submissions_once_idx on cohort_submissions (assignment_id, nid);
create index if not exists cohort_submissions_cohort_idx on cohort_submissions (cohort_id);

-- 출석 모임 ↔ 교육 과정 연결(비면 일반 모임)
alter table attend_meetings add column if not exists cohort_id text not null default '';

alter table cohorts enable row level security;
alter table cohort_members enable row level security;
alter table cohort_assignments enable row level security;
alter table cohort_submissions enable row level security;
