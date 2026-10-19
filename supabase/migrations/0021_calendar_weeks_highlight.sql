-- 2026-10-19: 공식 일정 강조(달력 칸 오른쪽 위 빨간 불빛 점) + 주간 서머리(달력 한 줄 = 일~토 아래 '주간:' 이름과 메모, 전도부가 씀).

alter table calendar_events add column if not exists highlight boolean not null default false;   -- 공식 일정만 켤 수 있음

create table if not exists calendar_weeks (
  id         bigint generated always as identity primary key,
  week_start date not null unique,              -- 그 주의 일요일
  theme      text not null default '',          -- 주간: 섭외 집중 주간, 복음방 집중 주간 …
  memo       text not null default '',
  updated_by text not null default '',
  updated_at timestamp
);

alter table calendar_weeks enable row level security;
