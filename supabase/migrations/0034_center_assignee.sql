-- 2026-11-02 센터 기수 관리: 받은 수강생(서류)을 기수의 전도사에게 배정
alter table center_referrals add column if not exists assignee_id   text not null default '';
alter table center_referrals add column if not exists assignee_name text not null default '';
