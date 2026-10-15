-- 2026-10-15: 한 출석 모임 안에 타임 여러 개(오전·오후·저녁 …). 어느 타임에 와도 출석 1번.
-- slots = [{"start":"09:00","end":"10:30"}, …] (시작 순). start_time/end_time 은 첫 타임 시작·마지막 타임 끝으로 함께 적어 둔다.
alter table attend_meetings add column if not exists slots jsonb not null default '[]'::jsonb;
