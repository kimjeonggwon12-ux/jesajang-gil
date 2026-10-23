-- 2026-10-23: 기록 카드 관리 흐름 — 기록마다 받은 'AI 단계향상 피드백'을 남겨 새로고침해도 보이게.
alter table activities add column if not exists ai_feedback    text not null default '';
alter table activities add column if not exists ai_feedback_at timestamp;
