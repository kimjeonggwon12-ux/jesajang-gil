-- 15단계: 교육 과정 ↔ 텔레그램 방. 방에 "제출 …"을 쓰면 과제 제출, "점수 과목 이름 점수 …"를 쓰면 시험 점수가 기록된다.

-- 출석 봇이 본 방(방 찾기용 — 웹훅을 켜면 getUpdates 를 못 쓰므로 여기에 남긴다)
create table if not exists cohort_tg_chats (
  chat_id  text primary key,
  title    text not null default '',
  seen_at  timestamp
);

-- 텔레그램 사용자 ↔ 교육생(처음 "제출 홍길동 …"으로 이름을 쓰면 연결되고, 다음부터는 "제출"만 써도 된다)
create table if not exists cohort_tg_links (
  id          bigint generated always as identity primary key,
  cohort_id   text not null,
  tg_user_id  text not null,
  member_id   text not null,
  nid         text generated always as (norm_id(member_id)) stored,
  name        text not null default '',
  linked_at   timestamp
);
create unique index if not exists cohort_tg_links_once_idx on cohort_tg_links (cohort_id, tg_user_id);

-- 시험 점수: 같은 날·같은 과목·같은 사람은 한 칸(다시 올리면 고쳐진다)
create table if not exists cohort_scores (
  id          bigint generated always as identity primary key,
  cohort_id   text not null,
  date        text not null,                         -- 'yyyy-MM-dd'
  subject     text not null,
  member_id   text not null,
  nid         text generated always as (norm_id(member_id)) stored,
  name        text not null default '',
  score       numeric not null,
  by_name     text not null default '',              -- 올린 사람(텔레그램 이름)
  at          timestamp
);
create unique index if not exists cohort_scores_once_idx on cohort_scores (cohort_id, date, subject, nid);

alter table cohort_submissions add column if not exists source text not null default '앱';   -- 앱 | 텔레그램
alter table cohort_submissions add column if not exists tg_file text not null default '';    -- 사진·파일 file_id

alter table cohort_tg_chats enable row level security;
alter table cohort_tg_links enable row level security;
alter table cohort_scores enable row level security;
