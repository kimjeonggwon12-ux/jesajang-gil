-- 9단계: 동시에 두 번 들어와도 겹치지 않게 DB 가 막는다

-- 같은 교사가 같은 이름의 전도 대상자를 두 번 만들지 못한다(활동 등록이 동시에 두 번 들어온 경우).
create unique index if not exists targets_creator_name_idx on targets (creator_nid, btrim(target_name));

-- 한 사람에 명함 한 장(두 기기에서 동시에 저장한 경우).
create unique index if not exists connect_cards_once_idx on connect_cards (nid) where nid <> '0';

-- 접수번호(F-000123)는 번호표 기계(sequence)에서 뽑는다 — 동시에 접수해도 같은 번호가 나오지 않는다.
-- (옛 자료에는 겹친 번호가 이미 있어 유일 제약은 걸지 않는다.)
create sequence if not exists feedback_receipt_seq;

create or replace function next_receipt_no() returns text
language plpgsql as $fn$
declare
  highest bigint;
  n bigint;
begin
  n := nextval('feedback_receipt_seq');
  select coalesce(max(nullif(regexp_replace(receipt_no, '[^0-9]', '', 'g'), '')::bigint), 0)
    into highest from feedbacks where receipt_no like 'F-%';
  -- 자료를 새로 옮긴 직후처럼 번호표가 뒤처져 있으면, 지금까지의 가장 큰 번호 뒤로 맞춘 다음 다시 뽑는다.
  if n <= highest then
    -- 맞추는 일은 한 번에 한 곳만 한다(여럿이 동시에 되돌리면 같은 번호가 다시 나온다).
    perform pg_advisory_xact_lock(hashtext('feedback_receipt_seq'));
    n := nextval('feedback_receipt_seq');
    if n <= highest then
      perform setval('feedback_receipt_seq', highest);
      n := nextval('feedback_receipt_seq');
    end if;
  end if;
  return 'F-' || lpad(n::text, 6, '0');
end
$fn$;

revoke execute on function next_receipt_no() from public, anon, authenticated;
grant execute on function next_receipt_no() to service_role;
