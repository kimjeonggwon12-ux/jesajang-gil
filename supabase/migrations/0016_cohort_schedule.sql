-- 16단계: 기간·요일이 있는 정기 교육 — 매일(또는 정한 요일) 출석·과제, 과제는 날짜마다 따로 기록.

-- 교육 기간과 정기 일정(출석 모임을 날짜마다 만들어 두는 데 쓴다)
alter table cohorts add column if not exists start_date text not null default '';   -- 'yyyy-MM-dd'
alter table cohorts add column if not exists end_date   text not null default '';
alter table cohorts add column if not exists days       text not null default '';   -- 교육 요일 '월화수목금토일' 중 고른 글자들(비면 매일)
alter table cohorts add column if not exists start_time text not null default '';   -- 'HH:mm'
alter table cohorts add column if not exists end_time   text not null default '';

-- 과제 반복: 한번(기한 날짜) | 매일 | 요일(days). 마감 시각(due_time, 비면 그날 자정)
alter table cohort_assignments add column if not exists repeat   text not null default '한번';
alter table cohort_assignments add column if not exists days     text not null default '';
alter table cohort_assignments add column if not exists due_time text not null default '';

-- 제출은 날짜마다(반복 과제) — 한번 과제는 work_date = ''
alter table cohort_submissions add column if not exists work_date text not null default '';
alter table cohort_submissions add column if not exists late      boolean not null default false;
drop index if exists cohort_submissions_once_idx;
create unique index if not exists cohort_submissions_day_idx on cohort_submissions (assignment_id, nid, work_date);
