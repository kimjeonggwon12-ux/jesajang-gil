-- 17단계: 교육 과정 루틴 — 시험 루틴(요일·점수 마감 시각)과, 정해진 시각이 지나면 방으로 보내는 결과 서머리 기록.

create table if not exists cohort_exams (
  id         bigint generated always as identity primary key,
  exam_id    text not null unique,
  cohort_id  text not null,
  subject    text not null,                          -- 텔레그램 "점수 과목 …"의 과목과 맞춘다
  days       text not null default '',               -- '월화수목금토일' 중 고른 글자(한번 시험이면 비움)
  date       text not null default '',               -- 한번 시험 날짜
  due_time   text not null default '',               -- 점수 입력 마감(이 시각이 지나면 서머리)
  status     text not null default '열림',            -- 열림 | 닫힘 | 삭제
  created_at timestamp
);
create index if not exists cohort_exams_cohort_idx on cohort_exams (cohort_id);

-- 같은 서머리를 두 번 보내지 않게(종류·대상·날짜마다 한 번)
create table if not exists cohort_summary_log (
  id        bigint generated always as identity primary key,
  cohort_id text not null,
  kind      text not null,                           -- 출석 | 과제 | 시험
  ref_id    text not null,
  date      text not null,
  sent_at   timestamp
);
create unique index if not exists cohort_summary_log_once_idx on cohort_summary_log (cohort_id, kind, ref_id, date);

alter table cohort_exams enable row level security;
alter table cohort_summary_log enable row level security;
