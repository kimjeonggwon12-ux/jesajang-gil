-- 6단계: 영상(등록·신청·녹취 자료) · 교재 신청 · 신청 댓글 · 봇 알림로그 · 작업 잠금

-- 시트 "영상"
create table if not exists videos (
  id            bigint generated always as identity primary key,
  video_key     text not null unique,               -- 영상ID (VD…)
  youtube_id    text not null default '',
  title         text not null default '',
  parts         text[] not null default '{}',       -- 코너(소양·상담·밭갈기·무신앙·복음방)
  description   text not null default '',
  upload_date   text not null default '',
  created_by_id text not null default '',
  created_by    text not null default '',
  status        text not null default '',           -- '' = 게시 | 신청 | 반려 | 삭제
  updated_at    timestamp,
  phone         text not null default ''            -- 올리기 신청한 사람 전화
);

-- 시트 "영상녹취": 영상 한 편의 녹취(10분 구간별)·요약·자료 패키지
create table if not exists video_transcripts (
  id         bigint generated always as identity primary key,
  video_key  text not null unique,
  youtube_id text not null default '',
  status     text not null default '',              -- 진행중 | 완료
  duration   integer not null default 0,            -- 초. 0 = 길이를 몰라 끝날 때까지 10분씩 이어 간다
  segs       integer not null default 0,
  done       integer not null default 0,
  summary    text not null default '',
  created_at text not null default '',
  created_by text not null default '',
  updated_at text not null default '',
  error      text not null default '',
  texts      text[] not null default '{}',          -- 구간별 녹취
  pkg        jsonb not null default '{}'            -- { lesson, share, quiz, outreach }
);

-- 시트 "교재신청"
create table if not exists textbook_wishes (
  id           bigint generated always as identity primary key,
  wish_id      text not null unique,
  member_id    text not null default '',
  name         text not null default '',
  part         text not null default '',
  title        text not null default '',
  note         text not null default '',
  requested_at timestamp,
  status       text not null default '신청',          -- 신청 | 확인 | 삭제
  handler      text not null default '',
  handled_at   timestamp,
  phone        text not null default ''
);

-- 시트 "신청댓글" (영상·교재 신청에 달리는 글)
create table if not exists request_comments (
  id         bigint generated always as identity primary key,
  comment_id text not null default '',
  request_id text not null default '',
  member_id  text not null default '',
  name       text not null default '',
  body       text not null default '',
  created_at timestamp
);
create index if not exists request_comments_request_idx on request_comments (request_id);

-- 시트 "알림로그": 봇이 보낸 알림. 같은 중복키로 성공한 기록이 있으면 다시 보내지 않는다.
create table if not exists alert_log (
  id        bigint generated always as identity primary key,
  sent_at   text not null default '',               -- 'yyyy-MM-dd HH:mm'
  kind      text not null default '',
  summary   text not null default '',
  ok        boolean not null default false,
  dedup_key text not null default ''
);
create index if not exists alert_log_dedup_idx on alert_log (dedup_key) where ok and dedup_key <> '';

-- 같은 일을 두 곳에서 동시에 하지 않게 하는 짧은 잠금(만료 시각이 지나면 누구나 다시 잡을 수 있다)
create table if not exists work_locks (
  key        text primary key,
  expires_at timestamptz not null
);

alter table videos enable row level security;
alter table video_transcripts enable row level security;
alter table textbook_wishes enable row level security;
alter table request_comments enable row level security;
alter table alert_log enable row level security;
alter table work_locks enable row level security;
