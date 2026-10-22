-- 2026-10-22: SWOT 분석 2안 — AI 전략 제안(마지막으로 받은 것). 지난 제안은 target_ai_notes(kind 'SWOT AI 제안')에도 쌓인다.

alter table targets add column if not exists swot_ai    text not null default '';
alter table targets add column if not exists swot_ai_at timestamp;
