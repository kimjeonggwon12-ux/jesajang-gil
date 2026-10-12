// 시트 → Supabase: 출석모임 · 출석기록
//   node --env-file=.env tools/import-attendance.mjs
import { readTab, text, wallTime, dateOrText } from './lib/sheets.mjs';
import { loadIfEmpty } from './lib/load.mjs';
import { normId } from '../server/lib/util.js';

const raw = (v) => String(v ?? '');
const yes = (v) => v === true || raw(v).trim().toUpperCase() === 'Y';
const json = (v, fallback) => { try { return JSON.parse(v) ?? fallback; } catch { return fallback; } };
/** 시각 칸 → 'HH:mm' (엑셀 시간 값이면 하루의 비율로 온다). */
function hhmm(v) {
  if (typeof v === 'number') {
    const minutes = Math.round((v % 1) * 1440);
    return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
  }
  const m = raw(v).trim().match(/^(\d{1,2}):(\d{2})/);
  return m ? m[1].padStart(2, '0') + ':' + m[2] : '';
}

await loadIfEmpty('attend_meetings', readTab('출석모임').filter((r) => text(r['모임ID'])).map((r) => {
  const before = Number(r['열림(분전)']);
  return {
    meeting_id: raw(r['모임ID']), title: raw(r['제목']), date: dateOrText(r['날짜']).slice(0, 10),
    start_time: hhmm(r['시작']), end_time: hhmm(r['종료']), place: raw(r['장소']),
    open_before: before >= 0 && r['열림(분전)'] !== '' ? Math.round(before) : 30, questions: json(r['설문(JSON)'], []),
    status: raw(r['상태']) || '열림', created_by: raw(r['등록자ID']), created_at: wallTime(r['등록일시']), updated_at: wallTime(r['수정일시']),
    org: raw(r['부서']), district: raw(r['지역']), ask_district: yes(r['참석자지역선택']), ask_dept: yes(r['참석자부서선택']),
    start2: hhmm(r['저녁시작']),
  };
}));

// 같은 모임에 같은 사람이 두 번 적힌 줄은 첫 줄만 옮긴다(옛 서버도 읽을 때 첫 줄만 썼다).
const seen = new Set();
await loadIfEmpty('attend_records', readTab('출석기록').filter((r) => text(r['기록ID'])).filter((r) => {
  const nid = normId(r['고유번호']);
  const key = `${raw(r['모임ID'])}|${nid}`;
  if (nid !== '0' && seen.has(key)) return false;
  seen.add(key);
  return true;
}).map((r) => ({
  record_id: raw(r['기록ID']), meeting_id: raw(r['모임ID']), member_id: raw(r['고유번호']).replace(/^'/, ''), name: raw(r['이름']),
  dept: raw(r['부서']), position: raw(r['직책']), answers: json(r['응답(JSON)'], {}), at: wallTime(r['출석일시']),
  method: raw(r['방법']), pick_org: raw(r['선택소속']), pick_district: raw(r['선택지역']), dept24: raw(r['24부서']), late: raw(r['지각']),
})));
