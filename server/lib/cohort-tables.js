// 교육 과정 표: 시험 순위표 · 출석표 — 같은 자료로 이미지(PNG, 텔레그램·앱 우클릭 복사)와 글(<pre>, 이미지 실패 시) 둘 다 만든다.
// 자료는 cohorts.js loadAll() 의 결과(all)를 그대로 받는다.
import { normId } from './util.js';
import { tablePng } from './table-image.js';

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
    return { name: m.name, church: m.church, avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null, taken: vals.length, cells: cols.map((d) => of.get(d + '|' + m.nid)) };
  }).sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1) || a.name.localeCompare(b.name));
  let rank = 0, prev = null;
  list.forEach((r, i) => { if (r.avg == null) r.rank = '-'; else { if (r.avg !== prev) rank = i + 1; prev = r.avg; r.rank = rank; } });
  const missing = list.flatMap((r) => r.cells.map((v, i) => (v == null ? `${r.name} ${mmdd(cols[i])}` : null)).filter(Boolean));
  const head = ['순위', '이름', ...cols.map(mmdd), '응시', '평균'];
  const rows = list.map((r) => [r.rank, r.name, ...r.cells.map((v) => (v == null ? '-' : v)), `${r.taken}/${dates.length}`, r.avg == null ? '-' : r.avg.toFixed(1)]);
  const avgCol = head.length - 1;
  return {
    title: `🏆 ${subject} 순위`,
    sub: `${cohortTitle ? cohortTitle + ' · ' : ''}시험 ${dates.length}회${dates.length > cols.length ? ` (최근 ${cols.length}회 표시)` : ''} · 평균 높은 순`,
    head, rows, align: ['center', 'left'],
    style: (r, c, v) => {
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
  const head = ['이름', ...cols.map((d) => `${mmdd(d)}(${wd(d)})`), '출석'];
  const rows = all.members.map((m) => {
    const cs = days.map((d) => cell(d, m.nid));
    return [m.name, ...cs.slice(-cols.length).map((x) => (x === '출석' ? '○' : x)), `${cs.filter((x) => x !== '결석').length}/${days.length}`];
  });
  rows.push(['인원', ...cols.map((d) => `${all.members.filter((m) => cell(d, m.nid) !== '결석').length}/${all.members.length}`), '']);
  const COLOR = { '○': { color: '#00875f', bold: true }, 지각: { fill: '#fff4cc', color: '#8a6200' }, 부분: { fill: '#fde3cf', color: '#b5530b' }, 결석: { fill: '#fde8e8', color: '#c0392b', bold: true } };
  return {
    title: `📋 출석표`,
    sub: `${cohortTitle ? cohortTitle + ' · ' : ''}${mmdd(cols[0])}~${mmdd(cols.at(-1))}${days.length > cols.length ? ` (최근 ${cols.length}일)` : ''}`,
    head, rows, align: ['left'],
    style: (r, c, v) => (r === rows.length - 1 ? { bold: true } : COLOR[v] || null),
    foot: '○ 출석 · 지각 · 부분(부분 결석) · 결석',
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
