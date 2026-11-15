-- 웹훅 수신 결과만 보존한다. 원문과 봇 비밀값은 기록하지 않는다.
create table public.telegram_update_receipts (
  bot_key text not null check (length(bot_key) between 1 and 80),
  update_id bigint not null check (update_id >= 0),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('processing','done','unknown')),
  received_at timestamptz not null default now(),
  finished_at timestamptz,
  primary key (bot_key, update_id)
);
create index telegram_receipts_review_idx on public.telegram_update_receipts(received_at) where status <> 'done';
alter table public.telegram_update_receipts enable row level security;
revoke all on public.telegram_update_receipts from public, anon, authenticated;
grant select,insert,update,delete on public.telegram_update_receipts to service_role;
comment on table public.telegram_update_receipts is '교육 봇 수신 중복 방지. processing/unknown은 저장·답장 일부 처리 가능성이 있어 자동 재실행/삭제하지 않고 담당자가 대조한다.';
