-- 18단계: 교육 일정표(날짜·시간대별 교육 항목) + 과제·시험의 불규칙 날짜 지정

create table if not exists cohort_schedule (
  id         bigint generated always as identity primary key,
  item_id    text not null unique,
  cohort_id  text not null,
  date       text not null,                          -- 'yyyy-MM-dd'
  start_time text not null default '',               -- 'HH:mm' (비면 하루 전체·주간 메모)
  end_time   text not null default '',
  title      text not null,                          -- 예: 성구 시험 / [사명 정신 교육①]
  sub        text not null default '',               -- 강사·설명 (예: 신명근 교육부장)
  kind       text not null default '교육',            -- 교육 | 시험 | 과제 | 실습 | 활동 | 예배 | 식사 | 기타 | 주간메모
  created_at timestamp
);
create index if not exists cohort_schedule_cohort_idx on cohort_schedule (cohort_id, date);

-- 날짜를 하나하나 고른 과제·시험(불규칙 요일). 'yyyy-MM-dd,yyyy-MM-dd,…'
alter table cohort_assignments add column if not exists dates text not null default '';
alter table cohort_exams add column if not exists dates text not null default '';

alter table cohort_schedule enable row level security;
