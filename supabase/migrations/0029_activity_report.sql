-- 2026-10-23: 활동 기록 = 교자장부청 보고방 문자 틀(상담/복음방 교육 보고 등).
--   activities.report      = 보고 칸(jsonb: tier,title,center,age,faith,recruitType,phone4,team,checks,stageMark,plan,eduTotal,eduWeekly,lesson,nextDate,time,request)
--   activities.report_text = 보고방에 올릴 문자 그대로(다음 단계: 텔레봇이 보고방에 올림)
--   targets.report_profile = 섭외자마다 잘 안 바뀌는 칸 + 누적 교육 제목 lessons[{date,title}] — 다음 기록 때 미리 채움

alter table activities add column if not exists report      jsonb;
alter table activities add column if not exists report_text text not null default '';
alter table targets    add column if not exists report_profile jsonb;
