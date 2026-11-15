-- 0040_edu_roster 이후 적용. 개인별 값은 비공개 운영 자료로 별도 이전하며 이 파일에 넣지 않는다.
create table public.edu_roster_policy (
  roster_key text primary key,
  excluded_positions text[] not null default '{}',
  always_present_nids text[] not null default '{}',
  dept_overrides jsonb not null default '{}' check (jsonb_typeof(dept_overrides) = 'object'),
  source_note text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.edu_roster_policy enable row level security;
revoke all on public.edu_roster, public.edu_roster_policy from public, anon, authenticated;
grant all on public.edu_roster, public.edu_roster_policy to service_role;
grant usage, select on sequence public.edu_roster_id_seq to service_role;

create table public.edu_delivery_log (
  delivery_key text primary key,
  meeting_id text not null,
  phase text not null,
  room_key text not null,
  part_no integer not null,
  mode text not null check (mode in ('auto','manual')),
  status text not null check (status in ('sending','sent','unknown')),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index edu_delivery_meeting_idx on public.edu_delivery_log(meeting_id, created_at desc);
alter table public.edu_delivery_log enable row level security;
revoke all on public.edu_delivery_log from public, anon, authenticated;
grant all on public.edu_delivery_log to service_role;
comment on table public.edu_delivery_log is '보고 단위 전송 주장/결과. sending/unknown은 자동 재전송하지 않고 담당자가 실제 수신을 확인한다.';
