-- 2026-10-20: 일정 등록을 육하원칙으로 — 대상자(누구를 위해)·어떻게(진행 방식)·목적(왜). 광고는 게시 끝나는 날이 지나면 앱에서 내려간다.

alter table calendar_events add column if not exists audience text not null default '';   -- 대상자
alter table calendar_events add column if not exists method   text not null default '';   -- 어떻게
alter table calendar_events add column if not exists purpose  text not null default '';   -- 목적

alter table calendar_ads add column if not exists end_date date;   -- 비우면 제목의 'M월 D일'을 끝나는 날로 본다
