-- 2026-10-20: 영상 인강 코너 — 등록된 영상(videos)을 강좌로 묶어 차례대로 듣고, 교사마다 진도·이수를 남긴다.
--   진도 = 실제로 재생된 10초 칸(buckets). 영상 길이의 90% 이상 보면 그 강 이수, 모든 강 이수 = 강좌 이수.

create table if not exists lectures (
  id          bigint generated always as identity primary key,
  lecture_id  text not null unique,
  title       text not null default '',
  part        text not null default '',              -- 소양·상담·밭갈기·무신앙·복음방
  instructor  text not null default '',              -- 강사(교관·교사)
  description text not null default '',
  lessons     jsonb not null default '[]',           -- 강 순서대로 [video_key, …]
  featured    boolean not null default false,        -- 우수 강의
  status      text not null default '',              -- '' = 게시 | 숨김 | 삭제
  created_by  text not null default '',
  created_at  timestamp,
  updated_at  timestamp
);

create table if not exists lecture_progress (
  id           bigint generated always as identity primary key,
  member_id    text not null default '',
  nid          text generated always as (norm_id(member_id)) stored,
  name         text not null default '',
  lecture_id   text not null,
  video_key    text not null,
  buckets      jsonb not null default '[]',          -- 본 10초 칸 번호들
  duration     integer not null default 0,           -- 초
  last_pos     integer not null default 0,           -- 이어 보기 위치(초)
  completed    boolean not null default false,
  completed_at timestamp,
  updated_at   timestamp,
  unique (nid, lecture_id, video_key)
);
create index if not exists lecture_progress_lecture_idx on lecture_progress (lecture_id);

alter table lectures enable row level security;
alter table lecture_progress enable row level security;
