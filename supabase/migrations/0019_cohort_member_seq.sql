-- 19단계: 교육생 번호(명단·출석표·과제표·엑셀은 이 순서, 시험 성적은 순위순)
alter table cohort_members add column if not exists seq integer not null default 0;
-- 이미 있는 교육생은 넣은 순서대로 1, 2, 3 …
update cohort_members m set seq = x.rn
from (select id, row_number() over (partition by cohort_id order by id) as rn from cohort_members) x
where m.id = x.id and m.seq = 0;
