-- 2026-11-06(사용자): 섭외자 방 안의 대화방 — 담당 교사가 명단의 누구나 초대하고, 초대받은 사람은
--   대화 + 그 섭외자의 정보 기록·활동 이력(읽기만)을 본다. 중요 정보는 📌고정으로 한곳에. 알림은 앱 N 뱃지만.
create table if not exists target_room_members (
  id           bigint generated always as identity primary key,
  target_id    text not null,
  member_id    text not null default '',
  nid          text generated always as (norm_id(member_id)) stored,
  name         text not null default '',
  role         text not null default '초대',      -- 담당 | 초대
  invited_by   text not null default '',
  joined_at    timestamp,
  last_read_id bigint not null default 0,
  unique (target_id, nid)
);
create index if not exists target_room_members_nid_idx on target_room_members (nid);

create table if not exists target_room_messages (
  id         bigint generated always as identity primary key,
  target_id  text not null,
  from_id    text not null default '',
  from_nid   text generated always as (norm_id(from_id)) stored,
  from_name  text not null default '',
  body       text not null default '',
  photo      text not null default '',             -- R2 주소
  pinned     boolean not null default false,
  pinned_by  text not null default '',
  deleted    boolean not null default false,
  created_at timestamp
);
create index if not exists target_room_messages_target_idx on target_room_messages (target_id, id);

alter table target_room_members enable row level security;
alter table target_room_messages enable row level security;
