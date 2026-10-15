-- 2026-10-15: 일정에 주관 부서·문의 칸, 일정마다 응원 댓글 + 행사 사진(사진은 R2 주소만 저장).

alter table calendar_events add column if not exists host_dept     text not null default '';   -- 주관 부서(예: 전도부, 부녀회 3지역)
alter table calendar_events add column if not exists contact_name  text not null default '';   -- 문의) 이름
alter table calendar_events add column if not exists contact_phone text not null default '';   -- 문의) 전화

create table if not exists event_cheers (
  id         bigint generated always as identity primary key,
  cheer_id   text not null unique,
  event_id   text not null default '',
  member_id  text not null default '',
  nid        text generated always as (norm_id(member_id)) stored,
  name       text not null default '',
  dept       text not null default '',
  body       text not null default '',
  photos     text[] not null default '{}',     -- 최대 4장, R2 주소
  created_at timestamp,
  status     text not null default '게시'      -- 게시 | 삭제
);
create index if not exists event_cheers_event_idx on event_cheers (event_id);

alter table event_cheers enable row level security;
