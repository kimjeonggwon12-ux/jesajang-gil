-- 1단계: 명단·로그인 (구글 시트 "교사명단", "교관명단" 탭)

-- 고유번호 비교용: 숫자만 남기고 앞자리 0 제거 (Apps Script _normId_ 와 같은 규칙)
create or replace function norm_id(raw text) returns text
language sql immutable as $fn$
  select coalesce(nullif(ltrim(regexp_replace(coalesce(raw, ''), '[^0-9]', '', 'g'), '0'), ''), '0')
$fn$;

-- 교사명단
create table if not exists teachers (
  member_id       text primary key,                 -- 고유번호
  nid             text generated always as (norm_id(member_id)) stored,
  name            text not null default '',
  dept            text not null default '',         -- 부서
  region          text not null default '',         -- 지역
  affiliation     text not null default '',         -- 소속
  position        text not null default '',         -- 직책
  tier            text not null default '활동교사',   -- 교사구분
  note            text not null default '',         -- 소속비고
  tier_changed_at date,                             -- 등급변경일
  reg_leads       integer not null default 0,       -- 센터등록 실적
  unreg_leads     integer not null default 0,       -- 센터미등록 실적
  counsel         integer not null default 0,       -- 상담
  gospel_room     integer not null default 0,       -- 복음방
  companion       integer not null default 0,       -- 동행교사
  active_state    text not null default '',         -- 원본 '결과' 열
  sort_order      integer not null default 0,       -- 시트에 있던 순서
  updated_at      timestamptz not null default now()
);
create index if not exists teachers_nid_idx on teachers (nid);
create index if not exists teachers_dept_region_idx on teachers (dept, region);
create index if not exists teachers_sort_idx on teachers (sort_order);

-- 관리자 명단 (시트 "교관명단" 탭)
create table if not exists admins (
  id          bigint generated always as identity primary key,
  no          text not null default '',             -- 번호
  dept        text not null default '',
  region      text not null default '',
  district    text not null default '',             -- 구역
  affiliation text not null default '',
  member_id   text not null,
  nid         text generated always as (norm_id(member_id)) stored,
  name        text not null default '',
  position    text not null default '',
  phone       text not null default ''
);
create index if not exists admins_nid_idx on admins (nid);

-- 서버(서비스 키)만 접근한다. 브라우저가 DB에 직접 붙는 일은 없다.
alter table teachers enable row level security;
alter table admins enable row level security;
