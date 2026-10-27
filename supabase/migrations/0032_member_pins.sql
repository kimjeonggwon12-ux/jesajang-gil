-- 2026-10-27: 개인 핀번호(원하는 사람만) — 남이 내 고유번호·이름을 쳐서 들어오지 못하게.
--   핀은 그대로 두지 않고 scrypt 해시만. ver = 핀을 정한 시각(바뀌면 다른 기기는 다시 물음).
--   fails·locked_until = 5번 틀리면 10분 잠금.
create table if not exists member_pins (
  nid          text primary key,
  pin_hash     text not null,
  salt         text not null,
  ver          text not null,
  fails        int  not null default 0,
  locked_until text not null default '',
  updated_at   text not null default ''
);
alter table member_pins enable row level security;
