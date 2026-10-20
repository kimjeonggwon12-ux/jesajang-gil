-- 2026-10-20: 주간 서머리를 개강별로(10월 개강 ○○ 주간 / 11월 … / 12월 …, 각각 메모) + 따로 쓰는 메모 여러 칸.
--             전도 대상자에 '○월 개강 인도 목표'와 AI가 설계한 인도 계획.

alter table calendar_weeks add column if not exists items jsonb not null default '[]';   -- [{cohort:'10월 개강', theme:'섭외 집중', memo:''}]
alter table calendar_weeks add column if not exists notes jsonb not null default '[]';   -- ['메모', …]

alter table targets add column if not exists goal_cohort  text not null default '';   -- '2026-11' = 11월 개강 인도 목표
alter table targets add column if not exists goal_plan    text not null default '';   -- AI 인도 계획(마지막으로 받은 것)
alter table targets add column if not exists goal_plan_at timestamp;
