-- 기존 PIN 표도 서버 인증 경로에서만 사용한다. RLS와 표 접근 권한을 함께 제한한다.
-- Supabase의 기본 ACL로 남을 수 있는 anon/authenticated 권한(TRUNCATE 포함)을 제거한다.
-- 저장된 PIN 해시·버전·잠금 및 기존 로그인/등록/복구 계산은 바꾸지 않는다.
alter table public.member_pins enable row level security;
revoke all on table public.member_pins from public, anon, authenticated;
grant select, insert, update, delete on table public.member_pins to service_role;
