-- 4단계: 채팅 · 교재 · 필수교육 · 피드백(AI 상담/교관 요청) + 옛 연결 기능 자료(읽기 전용)

-- 시트 "채팅"
create table if not exists chat_messages (
  id       bigint generated always as identity primary key,
  chat_id  text not null default '',               -- 두 사람 번호를 정렬해 "__"로 이은 값
  from_id  text not null default '',
  from_nid text generated always as (norm_id(from_id)) stored,
  to_id    text not null default '',
  to_nid   text generated always as (norm_id(to_id)) stored,
  message  text not null default '',
  sent_at  timestamp,
  is_read  boolean not null default false
);
create index if not exists chat_messages_chat_idx on chat_messages (chat_id);
create index if not exists chat_messages_to_idx on chat_messages (to_nid) where not is_read;
create index if not exists chat_messages_from_idx on chat_messages (from_nid);

-- 시트 "교재"
create table if not exists courses (
  id          bigint generated always as identity primary key,
  course_id   text not null default '',            -- 교재번호 (G1-.. 등)
  course_name text not null default '',
  unit_name   text not null default '',
  sort_no     numeric not null default 0,
  content     text not null default '',
  minutes     numeric not null default 0,
  category    text not null default '',
  stage_hint  text not null default ''
);
create index if not exists courses_category_idx on courses (category);

-- 시트 "필수교육이수현황": 항목별 이수일은 completions = {"상담교육": "2026-09-01", ...}
create table if not exists required_education (
  id          bigint generated always as identity primary key,
  member_id   text not null default '',
  nid         text generated always as (norm_id(member_id)) stored,
  name        text not null default '',
  completions jsonb not null default '{}',
  updated_on  text not null default ''
);
create index if not exists required_education_nid_idx on required_education (nid);

-- 시트 "이수등록이력"
create table if not exists required_education_log (
  id           bigint generated always as identity primary key,
  logged_at    timestamp,
  member_id    text not null default '',
  name         text not null default '',
  category     text not null default '',
  completed_on text not null default '',
  registrar    text not null default '',
  kind         text not null default '등록'           -- 등록 | 취소
);

-- 시트 "피드백이력": AI 셀프코칭 · 사람 에스컬레이션 · 교관 요청
create table if not exists feedbacks (
  id             bigint generated always as identity primary key,
  receipt_no     text not null default '',
  member_id      text not null default '',
  nid            text generated always as (norm_id(member_id)) stored,
  name           text not null default '',
  source         text not null default '',           -- AI셀프코칭 | 사람에스컬레이션 | 교관요청
  situation      text not null default '',
  ai_coach_text  text not null default '',
  handler_answer text not null default '',
  status         text not null default '',           -- 접수 | 처리중 | 완료
  submitted_at   timestamptz,
  handler        text not null default '',
  answered_at    timestamptz
);
create index if not exists feedbacks_nid_idx on feedbacks (nid);
create index if not exists feedbacks_receipt_idx on feedbacks (receipt_no);

-- ── 옛 "연결" 기능 자료 ── 지금 화면에서는 새로 쓰지 않고, 통계·채팅 목록이 읽기만 한다.

-- 시트 "교사프로필"
create table if not exists teacher_profiles (
  id            bigint generated always as identity primary key,
  member_id     text not null default '',
  nid           text generated always as (norm_id(member_id)) stored,
  phone         text not null default '',
  tags          text not null default '',
  tools         text not null default '',
  bio           text not null default '',
  photo_url     text not null default '',
  created_at    timestamp,
  updated_at    timestamp,
  career        text not null default '',
  one_liner     text not null default '',
  phone_public  boolean not null default false,
  available     boolean not null default false,
  avail_roles   text[] not null default '{}',
  schedule_type text not null default '',
  avail_from    text not null default '',
  avail_to      text not null default '',
  avail_days    text[] not null default '{}',
  avail_times   text[] not null default '{}',
  avail_hours   text not null default '',
  is_public     boolean not null default true,
  identity      text not null default '',
  affil         text not null default '',
  gender        text not null default ''
);
create index if not exists teacher_profiles_nid_idx on teacher_profiles (nid);

-- 시트 "협력요청"
create table if not exists coop_requests (
  id           bigint generated always as identity primary key,
  request_id   text not null default '',
  from_id      text not null default '',
  from_name    text not null default '',
  to_id        text not null default '',
  to_nid       text generated always as (norm_id(to_id)) stored,
  type         text not null default '',
  memo         text not null default '',
  requested_at timestamp,
  status       text not null default ''
);

-- 시트 "같이해요" / "같이해요지원"
create table if not exists boards (
  id          bigint generated always as identity primary key,
  post_id     text not null default '',
  member_id   text not null default '',
  activity    text not null default '',
  target_age  text not null default '',
  target_stage text not null default '',
  meet_at     text not null default '',
  one_liner   text not null default '',
  created_on  text not null default '',
  deadline    text not null default '',
  status      text not null default '',
  req_dept    text not null default ''
);
create table if not exists board_applies (
  id         bigint generated always as identity primary key,
  post_id    text not null default '',
  member_id  text not null default '',
  applied_at timestamp
);

alter table chat_messages enable row level security;
alter table courses enable row level security;
alter table required_education enable row level security;
alter table required_education_log enable row level security;
alter table feedbacks enable row level security;
alter table teacher_profiles enable row level security;
alter table coop_requests enable row level security;
alter table boards enable row level security;
alter table board_applies enable row level security;
