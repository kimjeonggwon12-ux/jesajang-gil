// 시트 → Supabase: 활동실적 · 격려메시지 · 인도실적 · 전도대상자(이력 포함)
//   node --env-file=.env tools/import-activities.mjs
import { randomUUID } from 'node:crypto';
import { readTab, text, list, wallTime, wallDate, dateOrText } from './lib/sheets.mjs';
import { loadIfEmpty } from './lib/load.mjs';

await loadIfEmpty('activities', readTab('활동실적').map((r) => ({
  member_id: text(r['성도고유번호']), name: text(r['이름']), submitted_at: wallTime(r['등록일시']),
  activities: list(r['선택활동']), note: String(r['문의사항'] ?? ''), roles: list(r['역할']),
  target_name: String(r['대상자이름'] ?? ''), target_gender: text(r['대상자성별']), target_age_group: text(r['대상자연령대']),
  target_stage: text(r['대상자단계']), special_note: String(r['특이사항'] ?? ''), today_work: String(r['오늘한일'] ?? ''),
  next_work: String(r['다음할일'] ?? ''), target_dept: text(r['대상자부서']), consult_title: String(r['상담제목'] ?? ''),
  gospel_subject: String(r['복음방과목'] ?? ''), reaction: text(r['반응']), reaction_note: String(r['반응메모'] ?? ''),
})));

await loadIfEmpty('encouragements', readTab('격려메시지').map((r) => ({
  from_id: text(r['발신자고유번호']), from_name: text(r['발신자이름']), to_id: text(r['수신자고유번호']),
  message: String(r['메시지'] ?? ''), sent_at: wallTime(r['발송일시']), is_read: text(r['읽음여부']) === 'Y',
})));

const lead = (r) => ({
  member_id: text(r['성도고유번호']), name: text(r['이름']), lead_date: wallDate(r['인도일자']),
  lead_name: text(r['인도받은사람이름']), registered_by: text(r['등록자']),
});
await loadIfEmpty('center_leads', readTab('센터인도실적').map(lead));
await loadIfEmpty('gospel_leads', readTab('복음방인도실적').map(lead));

await loadIfEmpty('targets', readTab('전도대상자').map((r) => ({
  target_id: text(r['targetId']) || randomUUID(), creator_id: text(r['교사고유번호']), teacher_name: text(r['교사이름']),
  target_name: String(r['대상자이름'] ?? ''), stage: text(r['현재단계']), next_meeting_date: dateOrText(r['다음만남일자']),
  memo: String(r['메모'] ?? ''), created_at: wallTime(r['등록일시']), updated_at: wallTime(r['수정일시']),
  completed: text(r['완료여부']) === 'Y', gender: text(r['성별']), age_group: text(r['연령대']),
  leader_id: text(r['담당인도자고유번호']), helper_id: text(r['담당섬김이고유번호']),
  teacher_change_log: String(r['담당교사변경이력'] ?? ''),
})));

await loadIfEmpty('target_history', readTab('전도대상자이력').map((r) => ({
  member_id: text(r['교사고유번호']), target_id: text(r['targetId']), changed_at: wallTime(r['변경일시']),
  from_stage: text(r['이전단계']), to_stage: text(r['새단계']), memo: String(r['메모'] ?? ''),
})));
