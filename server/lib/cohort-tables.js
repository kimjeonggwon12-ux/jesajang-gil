// 교육 과정 표: 시험 순위표 · 출석표 — 같은 자료로 이미지(PNG, 텔레그램·앱 우클릭 복사)와 글(<pre>, 이미지 실패 시) 둘 다 만든다.
// 자료는 cohorts.js loadAll() 의 결과(all)를 그대로 받는다.
import { normId } from './util.js';
import { tablePng } from './table-image.js';
import { assignmentOn } from './cohort.js';

const mmdd = (d) => String(d).slice(5).replace('-', '/');
const WD = '일월화수목금토';
const wd = (d) => WD[new Date(d + 'T00:00:00Z').getUTCDay()];
export const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const width = (s) => [...String(s)].reduce((n, ch) => n + (/[ᄀ-ᇿ　-鿿가-힣＀-￯]/.test(ch) ? 2 : 1), 0);
const padR = (s, w) => String(s) + ' '.repeat(Math.max(0, w - width(s)));
const padL = (s, w) => ' '.repeat(Math.max(0, w - width(s))) + String(s);
const key = (s) => String(s || '').replace(/\s/g, '');

/** 과목 하나의 순위표 — 날짜 칸(최근 maxCols) + 응시 + 평균, 평균 높은 순(같으면 같은 순위). 미응시 '-' */
export function scoreBoard(all, subject, maxCols = 12, cohortTitle = '') {
  const k = key(subject);
  const nids = new Set(all.members.map((m) => m.nid));
  const scores = all.scores.filter((s) => key(s.subject) === k && nids.has(s.nid));
  const dates = [...new Set(scores.map((s) => s.date))].sort();
  if (!dates.length) return null;
  const cols = dates.slice(-maxCols);
  const of = new Map(scores.map((s) => [s.date + '|' + s.nid, Number(s.score)]));
  const list = all.members.map((m) => {
    const vals = dates.map((d) => of.get(d + '|' + m.nid)).filter((v) => v != null);
    return { seq: m.seq || 0, name: m.name, church: m.church, avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null, taken: vals.length, cells: cols.map((d) => of.get(d + '|' + m.nid)) };
  }).sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1) || a.seq - b.seq);   // 같은 점수면 교육생 번호순
  let rank = 0, prev = null;
  list.forEach((r, i) => { if (r.avg == null) r.rank = '-'; else { if (r.avg !== prev) rank = i + 1; prev = r.avg; r.rank = rank; } });
  const missing = list.flatMap((r) => r.cells.map((v, i) => (v == null ? `${r.name} ${mmdd(cols[i])}` : null)).filter(Boolean));
  const head = ['순위', '이름', ...cols.map(mmdd), '응시', '평균'];
  const rows = list.map((r) => [r.rank, r.name, ...r.cells.map((v) => (v == null ? '-' : v)), `${r.taken}/${dates.length}`, r.avg == null ? '-' : r.avg.toFixed(1)]);
  // 맨 아래 평균 줄: 날짜 칸 = 그날(당일) 평균, 응시 칸 = 응시 인원, 평균 칸 = 과목 전체 평균
  const mean = (v) => (v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : '-');
  const taken = list.reduce((a, r) => a + r.taken, 0);
  rows.push(['', '평균', ...cols.map((d) => mean(scores.filter((s) => s.date === d).map((s) => Number(s.score)))), `${taken}회`, mean(scores.map((s) => Number(s.score)))]);
  const avgRow = rows.length - 1;
  const avgCol = head.length - 1;
  return {
    title: `${cohortTitle ? cohortTitle + ' ' : ''}시험 결과 및 순위`,
    sub: `${subject} · 시험 ${dates.length}회${dates.length > cols.length ? ` (최근 ${cols.length}회 표시)` : ''} · 평균 높은 순`,
    head, rows, align: ['center', 'left'],
    style: (r, c, v) => {
      if (r === avgRow) return { fill: c ? '#e3f6ef' : null, bold: true, color: '#0b5e44' };
      if (c === 0 && [1, 2, 3].includes(v)) return { fill: ['#ffe8a3', '#e6e9ec', '#f3d9c6'][v - 1], bold: true };
      if (c === avgCol) return { bold: true, color: '#00875f' };
      if (v === '-') return { color: '#b0b8b4' };
      return null;
    },
    foot: missing.length ? `미응시: ${missing.join(', ')}` : '',
  };
}

/** 과정에 점수가 있는 과목들 */
export const scoreSubjects = (all) => [...new Set(all.scores.map((s) => s.subject))];

/** 출석표 — 오늘까지 교육 날(최근 maxCols) × 교육생. 출석 · 지각 · 부분 · 결석 */
export function attendBoard(all, today, maxCols = 12, cohortTitle = '') {
  const days = [...new Set(all.meetings.filter((m) => m.date <= today).map((m) => m.date))].sort();
  if (!days.length) return null;
  const cols = days.slice(-maxCols);
  const meetOf = new Map();
  for (const m of all.meetings) { if (!meetOf.has(m.date)) meetOf.set(m.date, []); meetOf.get(m.date).push(m.meeting_id); }
  const att = new Map(all.records.map((r) => [r.meetingId + '|' + normId(r.memberId), r]));
  const cell = (d, nid) => {
    const r = (meetOf.get(d) || []).map((id) => att.get(id + '|' + nid)).find(Boolean);
    if (!r) return '결석';
    if (/지각/.test(r.late || '')) return '지각';
    if (/결석|조퇴|외출/.test(r.late || '')) return '부분';
    return '출석';
  };
  const head = ['번호', '이름', ...cols.map((d) => `${mmdd(d)}(${wd(d)})`), '출석'];
  const rows = all.members.map((m) => {
    const cs = days.map((d) => cell(d, m.nid));
    return [m.seq || '', m.name, ...cs.slice(-cols.length).map((x) => (x === '출석' ? '○' : x)), `${cs.filter((x) => x !== '결석').length}/${days.length}`];
  });
  rows.push(['', '인원', ...cols.map((d) => `${all.members.filter((m) => cell(d, m.nid) !== '결석').length}/${all.members.length}`), '']);
  const COLOR = { '○': { color: '#00875f', bold: true }, 지각: { fill: '#fff4cc', color: '#8a6200' }, 부분: { fill: '#fde3cf', color: '#b5530b' }, 결석: { fill: '#fde8e8', color: '#c0392b', bold: true } };
  return {
    title: `${cohortTitle ? cohortTitle + ' ' : ''}출석부`,
    sub: `${mmdd(cols[0])}~${mmdd(cols.at(-1))}${days.length > cols.length ? ` (최근 ${cols.length}일)` : ''}`,
    head, rows, align: ['center', 'left'],
    style: (r, c, v) => (r === rows.length - 1 ? { bold: true } : COLOR[v] || null),
    foot: '○ 출석 · 지각 · 부분(부분 결석) · 결석',
  };
}

/** 과제 제출 현황 — 교육생 × 과제 날(오늘까지, 최근 maxCols) — 칸에 낸 과제(짧은 이름), 낼 게 있는데 안 냈으면 × */
export function assignBoard(all, today, maxCols = 12, cohortTitle = '') {
  const days = [...new Set([
    ...all.subs.map((s) => s.work_date).filter(Boolean),
    ...all.meetings.map((m) => m.date),
  ])].filter((d) => d <= today && all.assignments.some((a) => assignmentOn(a, d) && (a.repeat === '날짜' || a.repeat === '한번' || d >= (a.createdAt || '')))).sort();
  if (!days.length) return null;
  const cols = days.slice(-maxCols);
  const short = (t) => String(t).split(/\s+/).at(-1);
  const titleOf = new Map(all.assignments.map((a) => [a.assignmentId, short(a.title)]));
  const by = new Map();
  for (const s of all.subs) { const k = s.work_date + '|' + s.nid; if (!by.has(k)) by.set(k, []); by.get(k).push(titleOf.get(s.assignment_id) || '?'); }
  const head = ['번호', '이름', ...cols.map((d) => `${mmdd(d)}(${wd(d)})`), '낸 날'];
  const rows = all.members.map((m) => {
    const cells = cols.map((d) => (by.get(d + '|' + m.nid) || []).join('·') || '×');
    return [m.seq || '', m.name, ...cells, `${days.filter((d) => by.has(d + '|' + m.nid)).length}/${days.length}`];
  });
  rows.push(['', '낸 사람', ...cols.map((d) => `${all.members.filter((m) => by.has(d + '|' + m.nid)).length}/${all.members.length}`), '']);
  return {
    title: `${cohortTitle ? cohortTitle + ' ' : ''}과제 제출 현황`,
    sub: `${mmdd(cols[0])}~${mmdd(cols.at(-1))}${days.length > cols.length ? ` (최근 ${cols.length}일)` : ''} · 칸 = 그날 낸 과제`,
    head, rows, align: ['center', 'left'],
    style: (r, c, v) => (r === rows.length - 1 ? { bold: true } : v === '×' ? { fill: '#fde8e8', color: '#c0392b', bold: true } : c > 1 && c < head.length - 1 ? { color: '#00875f' } : null),
    foot: '× = 낼 과제가 있었는데 안 냄',
  };
}

/** 일정표 — 한 주(weekStart 월요일부터 7일) 시간 × 날짜. 교육 요일(없으면 일정이 있는 날) */
export function timetableBoard(all, weekStart, cohortTitle = '', classDays = '') {
  const add = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const week = Array.from({ length: 7 }, (_, i) => add(weekStart, i));
  const items = (all.schedule || []).filter((x) => week.includes(x.date) && x.kind !== '주간메모');
  const days = week.filter((d) => items.some((x) => x.date === d) || (classDays && classDays.includes(wd(d))));
  if (!items.length || !days.length) return null;
  const times = [...new Set(items.map((x) => x.start_time || '종일'))].sort((a, b) => (a === '종일' ? -1 : b === '종일' ? 1 : a < b ? -1 : 1));
  const clip = (t) => (width(t) > 30 ? [...t].slice(0, 15).join('') + '…' : t);
  const head = ['시간', ...days.map((d) => `${mmdd(d)}(${wd(d)})`)];
  const rows = times.map((t) => {
    const ends = items.filter((x) => (x.start_time || '종일') === t && x.end_time).map((x) => x.end_time).sort();
    return [t === '종일' ? '종일' : t + (ends[0] ? '~' + ends[0] : ''), ...days.map((d) => items.filter((x) => x.date === d && (x.start_time || '종일') === t).map((x) => clip(x.title) + (x.sub ? ` (${clip(x.sub)})` : '')).join(' / '))];
  });
  const kindOf = new Map(items.map((x) => [x.date + '|' + (x.start_time || '종일'), x.kind]));
  const FILL = { 시험: '#fde8e8', 과제: '#fff4cc', 실습: '#e8f0fe', 활동: '#e3f6ef', 예배: '#f1f1f1', 식사: '#f1f1f1' };
  const memo = (all.schedule || []).filter((x) => week.includes(x.date) && x.kind === '주간메모').map((x) => x.title);
  return {
    title: `${cohortTitle ? cohortTitle + ' ' : ''}일정표`,
    sub: `${mmdd(week[0])}~${mmdd(week[6])}`,
    head, rows, align: ['center'],
    style: (r, c) => { if (!c) return { bold: true }; const k = kindOf.get(days[c - 1] + '|' + times[r]); return FILL[k] ? { fill: FILL[k], color: k === '시험' ? '#c0392b' : undefined } : null; },
    foot: memo.length ? '이번 주 안내: ' + memo.join(' · ') : '',
  };
}

/** 글 표(<pre>) — 이미지를 못 만들 때 */
export function boardHtml(b, before = '') {
  const w = b.head.map((h, c) => Math.max(width(h), ...b.rows.map((r) => width(r[c]))));
  const line = (r) => r.map((v, c) => ((b.align || [])[c] === 'left' ? padR(v, w[c]) : padL(v, w[c]))).join(' ');
  return (before ? escHtml(before) + '\n\n' : '') + `<b>${escHtml(b.title)}</b> ${escHtml(b.sub || '')}\n<pre>${escHtml([line(b.head), ...b.rows.map(line)].join('\n'))}</pre>` + (b.foot ? `\n${escHtml(b.foot)}` : '');
}

/** 이미지(PNG Buffer) — 실패하면 null */
export function boardPng(b) {
  try { return tablePng(b); } catch (e) { console.log('표 이미지 오류: ' + (e && e.message ? e.message : e)); return null; }
}
