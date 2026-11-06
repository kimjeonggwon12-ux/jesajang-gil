-- 2026-11-06(사용자): 섭외자 대화방 초대 링크 — 교사명단에 없는 인도자·섬김이도 링크(코드)로 들어오게.
--   24시간 · 최대 5명 · 담당 교사가 언제든 끊기. 코드 = 8자(헷갈리는 글자 뺀 32자) — 6자리 숫자는 마구 넣어 보기로 맞힐 수 있어서.
create table if not exists target_room_invites (
  id          bigint generated always as identity primary key,
  code        text not null unique,
  target_id   text not null,
  created_by  text not null default '',
  created_name text not null default '',
  created_at  timestamp,
  expires_at  timestamp,
  max_uses    integer not null default 5,
  uses        integer not null default 0,
  revoked     boolean not null default false
);
create index if not exists target_room_invites_target_idx on target_room_invites (target_id);
alter table target_room_invites enable row level security;
