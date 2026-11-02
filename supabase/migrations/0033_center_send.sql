-- 2026-11-02: 센터 보내기 — 교사의 섭외자 기록이 지역장 승인을 거쳐 그 달 개강 센터(기수) 서류로 들어간다.
--   흐름: 교사 [지역장 승인 요청] → 지역장(또는 담당 교관) [승인]/[반려] → 지역장·교관 [센터로 보내기](센터 고르기) → 센터 강사·전도사가 서류로 받아 봄.
--   centers = 전도부가 만드는 개강 센터·기수(예: 전주센터 43기, 2026-11 개강). staff = [{memberId, name, role:'강사'|'전도사'|'담당'}]
--   center_referrals = 섭외자 한 명의 요청 건. snapshot = 보낼 때(요청·승인·보내기 때마다 새로) 모은 그 사람 기록 전부.

create table if not exists centers (
  id          bigint generated always as identity primary key,
  name        text not null,                  -- 센터 이름 (예: 전주센터)
  cohort_no   text not null default '',       -- 기수 (예: 43기)
  open_month  text not null default '',       -- 개강 월 'YYYY-MM'
  open_date   text not null default '',       -- 개강일 'YYYY-MM-DD'(모르면 빈칸)
  staff       jsonb not null default '[]',    -- 받아 보는 사람(강사·전도사 등)
  memo        text not null default '',
  active      boolean not null default true,  -- 닫으면 보내기 목록에서 빠짐(받은 서류는 그대로)
  created_by  text not null default '',
  created_at  timestamp,
  updated_at  timestamp
);
create index if not exists centers_month_idx on centers (open_month);

create table if not exists center_referrals (
  id             bigint generated always as identity primary key,
  target_id      text not null,
  target_name    text not null default '',
  teacher_id     text not null,
  teacher_nid    text generated always as (norm_id(teacher_id)) stored,
  teacher_name   text not null default '',
  dept           text not null default '',   -- 요청한 교사의 부서·지역(승인하는 지역장·교관을 고르는 기준)
  region         text not null default '',
  stage          text not null default '',   -- 요청 때 단계
  status         text not null default '요청', -- 요청 → 승인 → 전달 / 반려 / 취소
  request_note   text not null default '',
  hope_center    text not null default '',   -- 교사가 적은 희망 센터·개강(참고용)
  requested_at   timestamp,
  decided_by     text not null default '',   -- '이름(직책)'
  decided_by_id  text not null default '',
  decided_at     timestamp,
  decide_note    text not null default '',   -- 승인 메모·반려 사유
  sent_by        text not null default '',
  sent_by_id     text not null default '',
  sent_at        timestamp,
  center_id      bigint references centers(id),
  send_note      text not null default '',
  snapshot       jsonb,
  center_read_at timestamp                   -- 센터에서 처음 연 시각
);
create index if not exists center_referrals_scope_idx on center_referrals (dept, region, status);
create index if not exists center_referrals_teacher_idx on center_referrals (teacher_nid);
create index if not exists center_referrals_target_idx on center_referrals (target_id);
create index if not exists center_referrals_center_idx on center_referrals (center_id);
-- 한 섭외자에 진행 중(요청·승인) 건은 하나만
create unique index if not exists center_referrals_open_uq on center_referrals (target_id) where status in ('요청', '승인');

alter table centers enable row level security;
alter table center_referrals enable row level security;
