-- 2026-11-12: 교육별 재적(사명자 명단) — 교사 재적과 따로. 목요 사명자 교육은 부구역장 이상 사명자 엑셀이 재적.
-- 정기 교육(attend_series.roster_key)에 걸면 그 교육 출석 서머리는 교사 재적 대신 이 명단 기준(참석률·불참자).
create table if not exists edu_roster (
  id          bigint generated always as identity primary key,
  roster_key  text not null,                          -- 예: '목요사명자'
  member_id   text not null,
  nid         text generated always as (norm_id(member_id)) stored,
  name        text not null default '',
  dept        text not null default '',              -- 엑셀 '부서': 신학교역·교회교역·24부서·장로회·자문회·장년회·부녀회·청년회
  region      text not null default '',              -- 엑셀 '지역'(01지역·새신자·기타·신학·교회 / 24부서는 소속 회)
  district    text not null default '',              -- 구역
  affiliation text not null default '',              -- 소속
  position    text not null default '',              -- 직책
  sort_order  integer not null default 0,
  updated_at  timestamp
);
create unique index if not exists edu_roster_key_nid_idx on edu_roster (roster_key, nid);
alter table edu_roster enable row level security;

alter table attend_series add column if not exists roster_key text not null default '';
-- 서머리 보낼 곳: 'live' = 실제 방들, 'test' = 나만의 교사광장 시험 방만(확인 전)
alter table attend_series add column if not exists summary_to text not null default 'live';
