// 시트 → Supabase: 채팅 · 교재 · 필수교육 · 피드백이력 · 옛 연결 자료
//   node --env-file=.env tools/import-misc.mjs
import { readTab, text, wallTime, dateOrText, kstInstant } from './lib/sheets.mjs';
import { loadIfEmpty } from './lib/load.mjs';

const raw = (v) => String(v ?? '');
const csv = (v) => (text(v) ? String(v).split(',').filter(Boolean) : []);

await loadIfEmpty('chat_messages', readTab('채팅').map((r) => ({
  chat_id: raw(r['채팅ID']), from_id: raw(r['발신자ID']), to_id: raw(r['수신자ID']), message: raw(r['메시지']),
  sent_at: wallTime(r['발송시간']), is_read: raw(r['읽음여부']) === 'Y',
})));

await loadIfEmpty('courses', readTab('교재').filter((r) => text(r['교재번호'])).map((r) => ({
  course_id: text(r['교재번호']), course_name: raw(r['교재명']), unit_name: raw(r['세부단원명']),
  sort_no: Number(r['순서'] || 0), content: raw(r['내용(텍스트/마크다운)']), minutes: Number(r['예상소요시간(분)'] || 0),
  category: text(r['카테고리']), stage_hint: raw(r['단계별_적용_힌트']),
})));

const EDU = ['복음방교사양성교육', '섭외전도교육', '상담교육', '복음방교재교육', '교사소양교육'];
await loadIfEmpty('required_education', readTab('필수교육이수현황').map((r) => ({
  member_id: text(r['성도고유번호']), name: raw(r['이름']),
  completions: Object.fromEntries(EDU.map((c) => [c, dateOrText(r[c])]).filter(([, d]) => d)),
  updated_on: dateOrText(r['최종수정일']),
})));

await loadIfEmpty('required_education_log', readTab('이수등록이력').map((r) => ({
  logged_at: wallTime(r['등록일시']), member_id: text(r['성도고유번호']), name: raw(r['이름']), category: raw(r['항목']),
  completed_on: dateOrText(r['이수일']), registrar: raw(r['등록자']), kind: text(r['구분']) || '등록',
})));

await loadIfEmpty('feedbacks', readTab('피드백이력').map((r) => ({
  receipt_no: raw(r['접수번호']), member_id: raw(r['성도고유번호']), name: raw(r['이름']), source: raw(r['출처']),
  situation: raw(r['원본상황입력']), ai_coach_text: raw(r['AI코칭결과']), handler_answer: raw(r['교관답변']),
  status: raw(r['처리상태']), submitted_at: kstInstant(r['접수일시']), handler: raw(r['처리자']), answered_at: kstInstant(r['처리일시']),
})));

await loadIfEmpty('teacher_profiles', readTab('교사프로필').filter((r) => text(r['고유번호'])).map((r) => ({
  member_id: raw(r['고유번호']), phone: raw(r['전화번호']), tags: raw(r['특기태그']), tools: raw(r['자격증']), bio: raw(r['바이오']),
  photo_url: raw(r['프로필사진URL']), created_at: wallTime(r['등록일']), updated_at: wallTime(r['수정일']),
  career: raw(r['경력년차']), one_liner: raw(r['한줄소개']), phone_public: text(r['전화공개여부']) === 'Y',
  available: raw(r['활동가능여부']) === 'Y', avail_roles: csv(r['가능역할']), schedule_type: raw(r['가능일정유형']),
  avail_from: dateOrText(r['가능기간시작']), avail_to: dateOrText(r['가능기간종료']), avail_days: csv(r['가능요일']),
  avail_times: csv(r['가능시간대']), avail_hours: raw(r['가능시간']), is_public: raw(r['공개여부']) !== 'N',
  identity: raw(r['역할정체성']), affil: raw(r['소속']), gender: raw(r['성별']),
})));

await loadIfEmpty('coop_requests', readTab('협력요청').map((r) => ({
  request_id: raw(r['요청ID']), from_id: raw(r['요청자']), from_name: raw(r['요청자이름']), to_id: raw(r['수신자']),
  type: raw(r['요청유형']), memo: raw(r['메모']), requested_at: wallTime(r['요청일시']), status: raw(r['상태']),
})));

await loadIfEmpty('boards', readTab('같이해요').map((r) => ({
  post_id: raw(r['게시글ID']), member_id: raw(r['고유번호']), activity: raw(r['활동유형']), target_age: raw(r['대상자연령대']),
  target_stage: raw(r['대상자단계']), meet_at: dateOrText(r['일시']), one_liner: raw(r['한마디']),
  created_on: dateOrText(r['등록일']), deadline: dateOrText(r['마감일']), status: raw(r['상태']), req_dept: raw(r['요청부서']),
})));

await loadIfEmpty('board_applies', readTab('같이해요지원').map((r) => ({
  post_id: raw(r['게시글ID']), member_id: raw(r['지원자ID']), applied_at: wallTime(r['지원일시']),
})));
