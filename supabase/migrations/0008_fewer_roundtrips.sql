-- 8단계: DB 왕복 줄이기 — 한 번에 가져오기 / DB 가 대신 세기

-- 한 사람의 명단 행과 관리자 명단 행을 한 번에. { "teacher": {...}|null, "admin": {...}|null }
create or replace function member_info(p_nid text) returns json
language sql stable as $fn$
  select json_build_object(
    'teacher', (select to_json(t) from teachers t where t.nid = p_nid order by t.sort_order limit 1),
    'admin',   (select to_json(a) from admins a where a.nid = p_nid order by a.id limit 1)
  )
$fn$;

-- 부서·등급별 교사 수(적힌 값 그대로 묶는다 — 기본값·'기타' 묶음은 서버가 한다).
create or replace function roster_counts() returns table (dept text, tier text, n bigint)
language sql stable as $fn$
  select t.dept, t.tier, count(*) from teachers t group by t.dept, t.tier
$fn$;

revoke execute on function member_info(text) from public, anon, authenticated;
revoke execute on function roster_counts() from public, anon, authenticated;
grant execute on function member_info(text) to service_role;
grant execute on function roster_counts() to service_role;
