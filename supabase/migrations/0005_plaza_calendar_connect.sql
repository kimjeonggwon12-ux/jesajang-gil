-- 5단계: 광장(글·댓글) · 일정(행사·신청·공지·질문) · 연결(명함·도와주세요·매칭)
-- 날짜만 있는 칸(시작일·종료일 등)은 'yyyy-MM-dd' 글자로 둔다 — 화면이 글자 그대로 비교한다.

-- 시트 "교사광장"
create table if not exists plaza_posts (
  id         bigint generated always as identity primary key,
  post_id    text not null unique,
  member_id  text not null default '',
  nid        text generated always as (norm_id(member_id)) stored,
  name       text not null default '',
  category   text not null default '',
  title      text not null default '',
  body       text not null default '',
  tags       text[] not null default '{}',
  thumb      text not null default '',             -- 작은 미리보기 (data:image…)
  photos     text[] not null default '{}',         -- 최대 4장 (data:image…)
  likes      text[] not null default '{}',         -- 좋아요 누른 사람의 정규화 번호
  created_at timestamp,
  updated_at timestamp,
  status     text not null default '게시'            -- 게시 | 삭제
);
create index if not exists plaza_posts_created_idx on plaza_posts (created_at desc);

-- 시트 "교사광장댓글"
create table if not exists plaza_comments (
  id         bigint generated always as identity primary key,
  comment_id text not null unique,
  post_id    text not null default '',
  member_id  text not null default '',
  name       text not null default '',
  body       text not null default '',
  created_at timestamp,
  status     text not null default '게시'
);
create index if not exists plaza_comments_post_idx on plaza_comments (post_id);

-- 시트 "달력행사"
create table if not exists calendar_events (
  id           bigint generated always as identity primary key,
  event_id     text not null unique,
  type         text not null default '',            -- 개강 | 행사 | 부서 | 내일정
  title        text not null default '',
  start_date   text not null default '',
  end_date     text not null default '',
  dept         text not null default '',
  place        text not null default '',
  description  text not null default '',
  created_by   text not null default '',
  created_at   timestamp,
  category     text not null default '',            -- 공식 | 부서 | 내일정 (빈칸 = 공식)
  region       text not null default '',
  repeat_days  integer[] not null default '{}',     -- 0(일)~6(토)
  repeat_until text not null default ''
);

-- 시트 "행사스탭신청"
create table if not exists event_staff (
  id         bigint generated always as identity primary key,
  signup_id  text not null default '',
  event_id   text not null default '',
  member_id  text not null default '',
  name       text not null default '',
  dept       text not null default '',
  note       text not null default '',
  applied_at timestamp
);
create index if not exists event_staff_event_idx on event_staff (event_id);

-- 시트 "행사참석신청"
create table if not exists event_attendees (
  id             bigint generated always as identity primary key,
  signup_id      text not null default '',
  event_id       text not null default '',
  applicant_id   text not null default '',
  applicant_name text not null default '',
  applicant_dept text not null default '',
  applicant_role text not null default '',
  guest_name     text not null default '',
  guest_dept     text not null default '',
  guest_age      text not null default '',
  guest_stage    text not null default '',
  applied_at     timestamp
);
create index if not exists event_attendees_event_idx on event_attendees (event_id);

-- 시트 "전도부광고" (게시판 공지)
create table if not exists calendar_ads (
  id         bigint generated always as identity primary key,
  ad_id      text not null unique,
  title      text not null default '',
  body       text not null default '',
  sort_no    numeric not null default 0,
  updated_at timestamp
);

-- 시트 "전도부질문"
create table if not exists ad_questions (
  id            bigint generated always as identity primary key,
  question_id   text not null unique,
  ad_id         text not null default '',
  author_id     text not null default '',
  author_name   text not null default '',
  body          text not null default '',
  created_at    timestamp,
  answer        text not null default '',
  answerer_id   text not null default '',
  answerer_name text not null default '',
  answered_at   timestamp,
  status        text not null default '게시',
  updated_at    timestamp
);
create index if not exists ad_questions_ad_idx on ad_questions (ad_id);

-- 시트 "명함V2"
create table if not exists connect_cards (
  id         bigint generated always as identity primary key,
  member_id  text not null default '',
  nid        text generated always as (norm_id(member_id)) stored,
  name       text not null default '',
  photo_url  text not null default '',
  phone      text not null default '',
  intro      text not null default '',
  career     text not null default '',
  has_major  boolean not null default false,
  major_name text not null default '',
  cert       text not null default '',
  one_liner  text not null default '',
  roles      text[] not null default '{}',
  langs      text[] not null default '{}',
  targets    text[] not null default '{}',
  fields     text[] not null default '{}',
  tools      text not null default '',
  sched_type text not null default '',              -- 언제나 | 상의 | 등록
  from_date  text not null default '',
  to_date    text not null default '',
  days       text[] not null default '{}',
  times      text[] not null default '{}',
  sched_note text not null default '',
  dept       text not null default '',
  region     text not null default '',
  updated_at timestamp
);
create index if not exists connect_cards_nid_idx on connect_cards (nid);

-- 시트 "도와주세요"
create table if not exists help_posts (
  id          bigint generated always as identity primary key,
  help_id     text not null unique,
  member_id   text not null default '',
  name        text not null default '',
  type        text not null default '',
  dept        text not null default '',
  start_date  text not null default '',
  end_date    text not null default '',
  one_liner   text not null default '',
  description text not null default '',
  status      text not null default '진행',           -- 진행 | 마감
  created_at  timestamp,
  target      text not null default '',
  need        text not null default ''
);

-- 시트 "매칭기록"
create table if not exists matches (
  id           bigint generated always as identity primary key,
  match_id     text not null unique,
  kind         text not null default '',             -- 명함 | 도와주세요
  ref_id       text not null default '',
  from_id      text not null default '',
  from_name    text not null default '',
  to_id        text not null default '',
  to_name      text not null default '',
  status       text not null default '요청',           -- 요청 | 성사
  requested_at timestamp
);

alter table plaza_posts enable row level security;
alter table plaza_comments enable row level security;
alter table calendar_events enable row level security;
alter table event_staff enable row level security;
alter table event_attendees enable row level security;
alter table calendar_ads enable row level security;
alter table ad_questions enable row level security;
alter table connect_cards enable row level security;
alter table help_posts enable row level security;
alter table matches enable row level security;

-- 좋아요 누르기/풀기: 한 번의 갱신으로 처리해 동시에 눌러도 서로 덮어쓰지 않는다.
create or replace function toggle_plaza_like(p_post_id text, p_nid text)
returns table (liked boolean, like_count integer)
language plpgsql security invoker as $fn$
begin
  return query
  update plaza_posts p
     set likes = case when p_nid = any(p.likes) then array_remove(p.likes, p_nid) else array_append(p.likes, p_nid) end
   where p.post_id = p_post_id
  returning p_nid = any(p.likes), coalesce(array_length(p.likes, 1), 0);
end
$fn$;
revoke execute on function toggle_plaza_like(text, text) from public, anon, authenticated;
grant execute on function toggle_plaza_like(text, text) to service_role;
