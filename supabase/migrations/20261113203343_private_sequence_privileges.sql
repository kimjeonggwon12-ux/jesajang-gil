-- 운영의 기본 ACL은 새 시퀀스에도 anon/authenticated 권한을 준다.
-- 비공개 업무 표의 번호 생성기는 서버 역할만 사용한다. 기존 운영 표/기본 ACL은 바꾸지 않는다.
revoke all on sequence
  public.education_delegations_id_seq,
  public.education_access_events_id_seq,
  public.education_telegram_links_id_seq,
  public.education_telegram_challenges_id_seq,
  public.edu_roster_changes_id_seq,
  public.edu_excused_changes_id_seq,
  public.center_policy_changes_id_seq
from public, anon, authenticated;

grant usage, select on sequence
  public.education_delegations_id_seq,
  public.education_access_events_id_seq,
  public.education_telegram_links_id_seq,
  public.education_telegram_challenges_id_seq,
  public.edu_roster_changes_id_seq,
  public.edu_excused_changes_id_seq,
  public.center_policy_changes_id_seq
to service_role;
