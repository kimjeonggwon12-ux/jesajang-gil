// 시트 → Supabase: 광장 · 일정 · 연결
//   node --env-file=.env tools/import-plaza.mjs
import { readTab, readTabRows, text, wallTime, dateOrText } from './lib/sheets.mjs';
import { loadIfEmpty } from './lib/load.mjs';

const raw = (v) => String(v ?? '');
const csv = (v) => raw(v).split(',').map((x) => x.trim()).filter(Boolean);
const day = (v) => dateOrText(v).slice(0, 10);

await loadIfEmpty('plaza_posts', readTab('교사광장').filter((r) => text(r['글ID'])).map((r) => ({
  post_id: raw(r['글ID']), member_id: raw(r['작성자ID']), name: raw(r['작성자이름']), category: raw(r['카테고리']),
  title: raw(r['제목']), body: raw(r['본문']), tags: csv(r['해시태그']), thumb: raw(r['썸네일']),
  photos: [r['사진1'], r['사진2'], r['사진3'], r['사진4']].map(raw).filter(Boolean), likes: csv(r['좋아요']),
  created_at: wallTime(r['작성일시']), updated_at: wallTime(r['수정일시']), status: raw(r['상태']),
})));

await loadIfEmpty('plaza_comments', readTab('교사광장댓글').filter((r) => text(r['댓글ID'])).map((r) => ({
  comment_id: raw(r['댓글ID']), post_id: raw(r['글ID']), member_id: raw(r['작성자ID']), name: raw(r['작성자이름']),
  body: raw(r['내용']), created_at: wallTime(r['작성일시']), status: raw(r['상태']),
})));

// 달력행사: 카테고리(K)·지역(L) 열은 머리글이 비어 있어 열 위치로 읽는다.
await loadIfEmpty('calendar_events', readTabRows('달력행사').filter((r) => text(r[0])).map((r) => ({
  event_id: raw(r[0]), type: raw(r[1]), title: raw(r[2]), start_date: day(r[3]), end_date: day(r[4]),
  dept: raw(r[5]), place: raw(r[6]), description: raw(r[7]), created_by: raw(r[8]), created_at: wallTime(r[9]),
  category: raw(r[10]), region: raw(r[11]),
  repeat_days: raw(r[12]).split(',').map((x) => x.trim()).filter((x) => /^[0-6]$/.test(x)).map(Number),
  repeat_until: day(r[13]),
})));

await loadIfEmpty('event_staff', readTab('행사스탭신청').map((r) => ({
  signup_id: raw(r['신청ID']), event_id: raw(r['행사ID']), member_id: raw(r['신청자ID']), name: raw(r['이름']),
  dept: raw(r['부서']), note: raw(r['역할/메모']), applied_at: wallTime(r['신청일시']),
})));

await loadIfEmpty('event_attendees', readTab('행사참석신청').map((r) => ({
  signup_id: raw(r['신청ID']), event_id: raw(r['행사ID']), applicant_id: raw(r['신청자ID']), applicant_name: raw(r['신청자이름']),
  applicant_dept: raw(r['신청자부서']), applicant_role: raw(r['신청자역할']), guest_name: raw(r['섭외자이름']),
  guest_dept: raw(r['섭외자부서']), guest_age: raw(r['섭외자나이']), guest_stage: raw(r['전도단계']), applied_at: wallTime(r['신청일시']),
})));

await loadIfEmpty('calendar_ads', readTab('전도부광고').filter((r) => text(r['광고ID'])).map((r) => ({
  ad_id: raw(r['광고ID']), title: raw(r['제목']), body: raw(r['내용']), sort_no: Number(r['정렬'] || 0), updated_at: wallTime(r['수정일시']),
})));

await loadIfEmpty('ad_questions', readTab('전도부질문').filter((r) => text(r['질문ID'])).map((r) => ({
  question_id: raw(r['질문ID']), ad_id: raw(r['광고ID']), author_id: raw(r['작성자ID']), author_name: raw(r['작성자이름']),
  body: raw(r['질문']), created_at: wallTime(r['작성일시']), answer: raw(r['답변']), answerer_id: raw(r['답변자ID']),
  answerer_name: raw(r['답변자이름']), answered_at: wallTime(r['답변일시']), status: raw(r['상태']), updated_at: wallTime(r['수정일시']),
})));

await loadIfEmpty('connect_cards', readTab('명함V2').filter((r) => text(r['고유번호'])).map((r) => ({
  member_id: raw(r['고유번호']), name: raw(r['이름']), photo_url: raw(r['프로필사진']), phone: raw(r['전화번호']),
  intro: raw(r['소개']), career: raw(r['경력']), has_major: raw(r['전공여부']) === 'Y', major_name: raw(r['전공명']),
  cert: raw(r['자격증']), one_liner: raw(r['한마디']), roles: csv(r['가능역할']), langs: csv(r['가능외국어']),
  targets: csv(r['대상']), fields: csv(r['전문분야']), tools: raw(r['전도도구']), sched_type: raw(r['일정유형']),
  from_date: day(r['시작일']), to_date: day(r['종료일']), days: csv(r['요일']), times: csv(r['시간대']),
  sched_note: raw(r['일정한마디']), dept: raw(r['부서']), region: raw(r['지역']), updated_at: wallTime(r['수정일시']),
})));

// 도와주세요: 대상자상세(L)·요구내역(M) 열은 머리글이 비어 있다.
await loadIfEmpty('help_posts', readTabRows('도와주세요').filter((r) => text(r[0])).map((r) => ({
  help_id: raw(r[0]), member_id: raw(r[1]), name: raw(r[2]), type: raw(r[3]), dept: raw(r[4]),
  start_date: day(r[5]), end_date: day(r[6]), one_liner: raw(r[7]), description: raw(r[8]), status: raw(r[9]),
  created_at: wallTime(r[10]), target: raw(r[11]), need: raw(r[12]),
})));

await loadIfEmpty('matches', readTab('매칭기록').filter((r) => text(r['매칭ID'])).map((r) => ({
  match_id: raw(r['매칭ID']), kind: raw(r['유형']), ref_id: raw(r['대상글ID']), from_id: raw(r['요청자ID']),
  from_name: raw(r['요청자이름']), to_id: raw(r['상대ID']), to_name: raw(r['상대이름']), status: raw(r['상태']),
  requested_at: wallTime(r['요청일시']),
})));
