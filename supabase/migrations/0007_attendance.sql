-- 7단계: QR 출석 (시트 "출석모임", "출석기록")

create table if not exists attend_meetings (
  id           bigint generated always as identity primary key,
  meeting_id   text not null unique,
  title        text not null default '',
  date         text not null default '',            -- 'yyyy-MM-dd'
  start_time   text not null default '',            -- 'HH:mm'
  end_time     text not null default '',
  place        text not null default '',
  open_before  integer not null default 30,         -- 시작 몇 분 전부터 출석을 받는가
  questions    jsonb not null default '[]',         -- 설문 [{id,label,type,options,required}]
  status       text not null default '열림',          -- 열림 | 닫힘 | 집계완료 | 삭제
  created_by   text not null default '',
  created_at   timestamp,
  updated_at   timestamp,
  org          text not null default '',            -- 부서(부녀·장년·청년·자문·교역자·전체·기타)
  district     text not null default '',            -- 지역(숫자 또는 '유아모')
  ask_district boolean not null default false,      -- 참석자가 소속·지역을 고르게 한다
  ask_dept     boolean not null default false,      -- 참석자가 24개 부서를 고르게 한다
  start2       text not null default ''             -- 저녁 시작(15시 이후 출석의 지각 기준)
);

create table if not exists attend_records (
  id            bigint generated always as identity primary key,
  record_id     text not null default '',
  meeting_id    text not null default '',
  member_id     text not null default '',
  nid           text generated always as (norm_id(member_id)) stored,
  name          text not null default '',
  dept          text not null default '',
  position      text not null default '',
  answers       jsonb not null default '{}',
  at            timestamp,
  method        text not null default '',            -- QR | 앱스캔
  pick_org      text not null default '',
  pick_district text not null default '',
  dept24        text not null default '',
  late          text not null default ''             -- 정상 출석 | N분 지각
);
-- 한 모임에 한 사람은 한 번만: 동시에 두 번 눌러도 DB 가 하나만 받는다.
create unique index if not exists attend_records_once_idx on attend_records (meeting_id, nid) where nid <> '0';
create index if not exists attend_records_meeting_idx on attend_records (meeting_id);
create index if not exists attend_records_nid_idx on attend_records (nid);

-- 출석이 몰릴 때 알림을 묶어 보내려고 잠깐 쌓아 두는 이름들
create table if not exists attend_notify_queue (
  id         bigint generated always as identity primary key,
  meeting_id text not null,
  label      text not null
);

alter table attend_meetings enable row level security;
alter table attend_records enable row level security;
alter table attend_notify_queue enable row level security;
