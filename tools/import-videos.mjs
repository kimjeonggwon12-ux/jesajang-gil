// 시트 → Supabase: 영상 · 영상녹취 · 교재신청 · 신청댓글 · 알림로그
//   node --env-file=.env tools/import-videos.mjs
import { readTab, readTabRows, text, wallTime, dateOrText } from './lib/sheets.mjs';
import { loadIfEmpty } from './lib/load.mjs';

const raw = (v) => String(v ?? '');
const PARTS = ['소양', '상담', '밭갈기', '무신앙', '복음방'];
const partsOf = (v) => { const picked = raw(v).split(/[,，]/).map((x) => x.trim()); return PARTS.filter((p) => picked.includes(p)); };
/** 시각 칸을 'yyyy-MM-dd HH:mm:ss' 글자로(못 읽으면 적힌 그대로). */
const stamp = (v) => { try { return wallTime(v) || ''; } catch { return raw(v); } };

await loadIfEmpty('videos', readTab('영상').filter((r) => text(r['영상ID'])).map((r) => ({
  video_key: raw(r['영상ID']), youtube_id: raw(r['videoId']), title: raw(r['제목']), parts: partsOf(r['파트']),
  description: raw(r['설명']), upload_date: dateOrText(r['등록일']).slice(0, 10), created_by_id: raw(r['등록자ID']),
  created_by: raw(r['등록자']), status: text(r['상태']), updated_at: wallTime(r['수정일시']), phone: raw(r['신청자 전화']),
})));

// 영상녹취: 12열부터 녹취1~18, 30열부터 교안·나눔질문·퀴즈·전도문구
const PKG = ['lesson', 'share', 'quiz', 'outreach'];
await loadIfEmpty('video_transcripts', readTabRows('영상녹취').filter((r) => text(r[0])).map((r) => {
  const segs = Number(r[4]) || 0;
  return {
    video_key: raw(r[0]), youtube_id: raw(r[1]), status: raw(r[2]), duration: Number(r[3]) || 0, segs, done: Number(r[5]) || 0,
    summary: raw(r[6]), created_at: stamp(r[7]), created_by: raw(r[8]), updated_at: stamp(r[9]), error: raw(r[10]),
    texts: Array.from({ length: segs }, (_, k) => raw(r[11 + k])),
    pkg: Object.fromEntries(PKG.map((k, j) => [k, raw(r[29 + j])]).filter(([, v]) => v)),
  };
}));

await loadIfEmpty('textbook_wishes', readTab('교재신청').filter((r) => text(r['신청ID'])).map((r) => ({
  wish_id: raw(r['신청ID']), member_id: raw(r['신청자ID']), name: raw(r['신청자']), part: raw(r['분류']), title: raw(r['희망 교재']),
  note: raw(r['내용']), requested_at: wallTime(r['신청일시']), status: raw(r['상태']) || '신청', handler: raw(r['처리자']),
  handled_at: wallTime(r['처리일시']), phone: raw(r['전화번호']),
})));

await loadIfEmpty('request_comments', readTab('신청댓글').filter((r) => text(r['댓글ID'])).map((r) => ({
  comment_id: raw(r['댓글ID']), request_id: raw(r['신청ID']), member_id: raw(r['작성자ID']), name: raw(r['작성자']),
  body: raw(r['내용']), created_at: wallTime(r['작성일시']),
})));

await loadIfEmpty('alert_log', readTab('알림로그').map((r) => ({
  sent_at: stamp(r['발송시간']).slice(0, 16), kind: raw(r['알림종류']), summary: raw(r['내용요약']),
  ok: raw(r['성공여부']) === '성공', dedup_key: raw(r['중복키']),
})));
