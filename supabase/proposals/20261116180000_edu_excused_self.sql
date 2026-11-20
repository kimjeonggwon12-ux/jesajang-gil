-- [제안 · 운영에는 2026-11-16 사용자 지시로 적용] 공무 본인 신고 — 교역자·자문회·장년회·부녀회·청년회가 직접 올린다.
-- 기존 '#excused'(관리자 전체 명단 교체)와 섞지 않는다: 관리자 저장이 본인 신고를 지우지 않게 별도 표.
-- 집계는 '#excused' ∪ edu_excused_self(active). 취소는 active=false(기록 보존).
-- 되돌리기: drop table public.edu_excused_self; (기존 기능 영향 없음)
create table public.edu_excused_self (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('화전단','목사교','금요교사')),
  date text not null,
  nid text not null,
  name text not null default '',
  dept text not null default '',
  region text not null default '',
  reason text not null default '공무',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, date, nid)
);
create index edu_excused_self_day_idx on public.edu_excused_self(kind, date) where active;
alter table public.edu_excused_self enable row level security;
revoke all on public.edu_excused_self from public, anon, authenticated;
grant all on public.edu_excused_self to service_role;
grant usage, select on sequence public.edu_excused_self_id_seq to service_role;

-- 11/16(4차) 공무자 관리: 관리자가 대신 등록·해제한 사람(운영 적용함)
alter table public.edu_excused_self add column if not exists registered_by text not null default '';
alter table public.edu_excused_self add column if not exists canceled_by text not null default '';
