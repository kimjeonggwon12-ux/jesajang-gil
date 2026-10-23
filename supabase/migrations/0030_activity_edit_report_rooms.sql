-- 2026-10-23: 보고 기록 수정 + 보고방(텔레그램) 올리기.
--   activities.edited_at = 마지막으로 고친 시각, tg_posts = 보고방에 올린 글 [{chat, msg, at, kind:'post'|'edit'}]
--   report_rooms = 부서 → 보고방(교사광장 봇이 들어가 있는 텔레그램 방). dept '*' = 기본 방(부서 방이 없을 때). 둘 다 없으면 올리기 단추가 안 보인다.

alter table activities add column if not exists edited_at timestamp;
alter table activities add column if not exists tg_posts  jsonb not null default '[]';

create table if not exists report_rooms (
  dept       text primary key,              -- 교사명단 부서(teachers.dept) 그대로
  chat_id    text not null,
  title      text not null default '',
  active     boolean not null default true,
  created_at timestamp
);
alter table report_rooms enable row level security;
