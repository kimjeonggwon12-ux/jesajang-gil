-- 2026-11-20: 공무 본인 신고에 금요 교사 교육(kind '금요교사') 허용
alter table edu_excused_self drop constraint if exists edu_excused_self_kind_check;
alter table edu_excused_self add constraint edu_excused_self_kind_check check (kind in ('화전단','목사교','금요교사'));
