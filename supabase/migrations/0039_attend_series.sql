-- 2026-11-11: 매주 반복하는 정기 교육 출석(QR 한 장을 계속 씀).
-- QR = #attend=RS… → 오늘이 정한 요일이면 그날의 출석 모임(attend_meetings, series_id = RS…)을 처음 찍을 때 만들어 연결한다.
-- 그날 모임은 보통 모임과 똑같이 타임(오전·저녁)·지각·마감 서머리·명단 엑셀을 탄다.
create table if not exists attend_series (
  id           bigint generated always as identity primary key,
  series_id    text not null unique,
  title        text not null default '',
  weekdays     jsonb not null default '[]',          -- 반복 요일 [0=일 … 6=토]
  slots        jsonb not null default '[]',          -- 타임 [{"start":"09:00","end":"10:30"}, …] (1개 이상)
  place        text not null default '',
  open_before  integer not null default 30,
  questions    jsonb not null default '[]',
  org          text not null default '',
  district     text not null default '',
  ask_district boolean not null default false,
  ask_dept     boolean not null default false,
  status       text not null default '열림',           -- 열림 | 멈춤 | 삭제
  created_by   text not null default '',
  created_at   timestamp,
  updated_at   timestamp
);
alter table attend_series enable row level security;

alter table attend_meetings add column if not exists series_id text not null default '';
-- 한 정기 교육에 하루 한 모임 — 동시에 여러 명이 처음 찍어도 하나만 생긴다.
create unique index if not exists attend_meetings_series_day_idx on attend_meetings (series_id, date) where series_id <> '' and status <> '삭제';
