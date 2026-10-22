-- 2026-10-22: 나의교실 › 활동 기록 › SWOT 분석 — 섭외자(전도 대상자) 한 명당 SWOT 한 장.
--   swot = {s,w,o,t: 줄마다 한 항목, so,st,wo,wt: 칸별 전략, next:{cell,text,date}: 다음 행동}

alter table targets add column if not exists swot    jsonb;
alter table targets add column if not exists swot_at timestamp;
