-- 10단계: 명단 관리 — 누가·언제·무엇을 바꿨는지 남기는 변경 기록

create table if not exists roster_changes (
  id          bigint generated always as identity primary key,
  changed_at  timestamp not null,
  actor_id    text not null default '',            -- 바꾼 사람
  actor_name  text not null default '',
  kind        text not null,                       -- 교사 추가 | 교사 수정 | 교사 삭제 | 관리자 지정 | 관리자 수정 | 관리자 해제
  target_id   text not null default '',            -- 바뀐 사람의 고유번호
  target_name text not null default '',
  before      jsonb,                               -- 바꾸기 전 값(추가면 null)
  after       jsonb                                -- 바꾼 뒤 값(삭제·해제면 null)
);
create index if not exists roster_changes_target_idx on roster_changes (target_id);

alter table roster_changes enable row level security;
