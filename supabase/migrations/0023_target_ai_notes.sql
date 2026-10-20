-- 2026-10-20: 대상자(섭외자)별 AI 기록 누적 — 개강 인도 계획·활동 AI 피드백을 지우지 않고 쌓아,
--             다음 AI 설계 때 그 사람의 활동 기록·단계 이력·교관 답과 함께 모두 다시 읽힌다.

create table if not exists target_ai_notes (
  id         bigint generated always as identity primary key,
  target_id  text not null,
  member_id  text not null default '',
  kind       text not null default '',      -- 개강 인도 계획 | 활동 AI 피드백
  input      text not null default '',      -- 그때 AI에 준 요점(목표 개강·활동 내용 등)
  text       text not null default '',
  created_at timestamp
);
create index if not exists target_ai_notes_target_idx on target_ai_notes (target_id);

alter table target_ai_notes enable row level security;
alter table targets add column if not exists goal_plan_basis text not null default '';   -- 그 계획이 종합한 기록 수(활동 n건 · 코칭 n건 …)
