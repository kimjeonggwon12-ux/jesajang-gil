-- 20단계: 교육 과정 운영 주관 부서 · 담당자(이름·전화) — 과정을 만들 때 넣고, 화면에서 바로 연락
alter table cohorts add column if not exists host_dept     text not null default '';
alter table cohorts add column if not exists manager_name  text not null default '';
alter table cohorts add column if not exists manager_phone text not null default '';
