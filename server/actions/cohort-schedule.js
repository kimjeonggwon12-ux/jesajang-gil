// 교육 일정표(7777): 날짜·시간대별 교육 항목. 화면은 한 주씩 한 장(교시·시간 × 요일)으로 보고 넘겨 본다.
// 여러 줄 붙여 넣기로 한 번에 등록:  "10/12 09:00~10:00 성구 시험 / 총회장님 말씀 시청 시험① | 강사 #시험"
//   - 날짜만 있는 줄("10/12" 또는 "10/12(월)")은 아래 줄들의 날짜가 된다.  - 시간이 없으면 그날 전체(종일) 항목.
//   - "|" 뒤는 설명(강사 등), "#종류"는 교육·시험·과제·실습·활동·예배·식사·기타·주간메모(없으면 제목으로 짐작).
import { db, run } from '../lib/db.js';
import { kstDate, kstDateTime } from '../lib/util.js';
import { clip, newId, isDate } from '../lib/input.js';
import { findCohort } from '../lib/cohort.js';
import { isOwner } from './roster.js';

const DENIED = { error: '교육 일정표는 앱 관리자(7777)만 관리할 수 있어요.' };
const KINDS = ['교육', '시험', '과제', '실습', '활동', '예배', '식사', '기타', '주간메모'];
const hm = (v) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '').trim()); return m && +m[1] < 24 && +m[2] < 60 ? `${m[1].padStart(2, '0')}:${m[2]}` : ''; };

const toItem = (r) => ({ itemId: r.item_id, date: r.date, start: r.start_time, end: r.end_time, title: r.title, sub: r.sub, kind: r.kind });

/** 제목으로 종류 짐작 */
export function guessKind(title) {
  const t = String(title);
  if (/시험|테스트|평가/.test(t)) return '시험';
  if (/중식|석식|조식|식사|점심|저녁식사/.test(t)) return '식사';
  if (/예배/.test(t)) return '예배';
  if (/과제/.test(t)) return '과제';
  if (/실습|발표|연습|준비 및/.test(t)) return '실습';
  if (/활동|현지|모임|단합/.test(t)) return '활동';
  return '교육';
}

async function owned(body) {
  if (!isOwner(clip(body.memberId, 40))) return { denied: DENIED };
  const c = await findCohort(clip(body.cohortId, 40));
  return c ? { c } : { denied: { error: '교육 과정을 찾을 수 없어요.' } };
}

async function cohortTimetable(body) {
  const { c, denied } = await owned(body); if (denied) return denied;
  const rows = await run(db().from('cohort_schedule').select('*').eq('cohort_id', c.cohortId).order('date').order('start_time').order('id'));
  return { cohort: c, items: rows.map(toItem), today: kstDate() };
}

function readItem(input) {
  const date = clip(input.date, 10);
  const title = clip(input.title, 80);
  const start = hm(input.start), end = hm(input.end);
  if (!isDate(date)) return { error: '날짜를 골라 주세요.' };
  if (!title) return { error: '제목을 넣어 주세요.' };
  if (start && end && end <= start) return { error: '끝 시각이 시작보다 뒤여야 해요.' };
  const kind = KINDS.includes(String(input.kind)) ? String(input.kind) : guessKind(title);
  return { fields: { date, start_time: start, end_time: start ? end : '', title, sub: clip(input.sub, 120), kind } };
}

async function cohortSaveItem(body) {
  const { c, denied } = await owned(body); if (denied) return denied;
  const it = body.item || {};
  const read = readItem(it);
  if (read.error) return read;
  const id = clip(it.itemId, 40);
  if (id) {
    await run(db().from('cohort_schedule').update(read.fields).eq('item_id', id).eq('cohort_id', c.cohortId));
    return { ok: true, itemId: id };
  }
  const itemId = newId('SC');
  await run(db().from('cohort_schedule').insert({ item_id: itemId, cohort_id: c.cohortId, ...read.fields, created_at: kstDateTime() }));
  return { ok: true, itemId };
}

async function cohortDeleteItem(body) {
  const { c, denied } = await owned(body); if (denied) return denied;
  const ids = (Array.isArray(body.itemIds) ? body.itemIds : [body.itemId]).map((x) => clip(x, 40)).filter(Boolean);
  if (!ids.length) return { error: '지울 항목이 없어요.' };
  await run(db().from('cohort_schedule').delete().eq('cohort_id', c.cohortId).in('item_id', ids));
  return { ok: true, removed: ids.length };
}

/** 여러 줄 → 항목들(날짜 줄이 아래 줄의 날짜). year 는 날짜에 연도가 없을 때. */
export function parseTimetable(text, year) {
  const items = [], bad = [];
  let date = '';
  for (const raw of String(text || '').split(/\r?\n/)) {
    let line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    // 날짜: 2026-10-12 / 10/12 / 10.12 / 10월 12일 (+ (월) 같은 요일 표시)
    const dm = /^(?:(\d{4})[-./])?(\d{1,2})(?:[-./]|월\s?)(\d{1,2})일?(?:\s?\(?[월화수목금토일]\)?(?=\s|$))?(?:\s|$)/.exec(line);
    if (dm) {
      date = `${dm[1] || year}-${dm[2].padStart(2, '0')}-${dm[3].padStart(2, '0')}`;
      line = line.slice(dm[0].length).trim();
      if (!line) continue;
    }
    if (!isDate(date)) { bad.push(raw.trim()); continue; }
    // 시간: 09:00~10:00 / 09:00-10:00 / 09:00
    let start = '', end = '';
    const tm = /^(\d{1,2}:\d{2})(?:\s?[~\-–]\s?(\d{1,2}:\d{2}))?\s*/.exec(line);
    if (tm) { start = hm(tm[1]); end = hm(tm[2] || ''); line = line.slice(tm[0].length).trim(); }
    let kind = '';
    line = line.replace(/\s?#(\S+)\s*$/, (_, k) => { kind = k; return ''; }).trim();
    const [title, ...rest] = line.split('|');
    if (!title.trim()) { bad.push(raw.trim()); continue; }
    items.push({ date, start, end, title: title.trim(), sub: rest.join('|').trim(), kind: KINDS.includes(kind) ? kind : guessKind(title) });
  }
  return { items, bad };
}

/** 여러 줄 붙여 넣기 등록. replace 면 글에 나온 날짜의 기존 항목을 지우고 새로 넣는다. preview 면 저장하지 않고 읽은 결과만. */
async function cohortImportTimetable(body) {
  const { c, denied } = await owned(body); if (denied) return denied;
  const year = (c.startDate || kstDate()).slice(0, 4);
  const { items, bad } = parseTimetable(body.text, year);
  if (body.preview) return { ok: true, items, bad };
  if (!items.length) return { error: '읽은 일정이 없어요. 예: 10/12 09:00~10:00 성구 시험', bad };
  const now = kstDateTime();
  if (body.replace) {
    const dates = [...new Set(items.map((x) => x.date))];
    await run(db().from('cohort_schedule').delete().eq('cohort_id', c.cohortId).in('date', dates));
  }
  const rows = items.map((x, i) => ({
    item_id: newId('SC') + String(i).padStart(3, '0'), cohort_id: c.cohortId, date: x.date, start_time: x.start, end_time: x.start ? x.end : '',
    title: clip(x.title, 80), sub: clip(x.sub, 120), kind: x.kind, created_at: now,
  }));
  for (let i = 0; i < rows.length; i += 200) await run(db().from('cohort_schedule').insert(rows.slice(i, i + 200)));
  return { ok: true, added: rows.length, bad };
}

/** 하루 일정을 다른 날(들)로 복사 */
async function cohortCopyDay(body) {
  const { c, denied } = await owned(body); if (denied) return denied;
  const from = clip(body.from, 10);
  const to = (Array.isArray(body.to) ? body.to : [body.to]).map((x) => clip(x, 10)).filter((d) => isDate(d) && d !== from);
  if (!isDate(from) || !to.length) return { error: '복사할 날과 붙일 날을 골라 주세요.' };
  const src = await run(db().from('cohort_schedule').select('*').eq('cohort_id', c.cohortId).eq('date', from).order('start_time'));
  if (!src.length) return { error: '그날은 일정이 없어요.' };
  const now = kstDateTime();
  const rows = [];
  to.forEach((d, j) => src.forEach((s, i) => rows.push({
    item_id: newId('SC') + String(j * 100 + i).padStart(4, '0'), cohort_id: c.cohortId, date: d, start_time: s.start_time, end_time: s.end_time,
    title: s.title, sub: s.sub, kind: s.kind, created_at: now,
  })));
  await run(db().from('cohort_schedule').insert(rows));
  return { ok: true, added: rows.length };
}

export default { cohortTimetable, cohortSaveItem, cohortDeleteItem, cohortImportTimetable, cohortCopyDay };
