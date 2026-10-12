// 내려받은 시트 엑셀(tools/export/data.xlsx)을 탭 단위로 읽는다.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const FILE = fileURLToPath(new URL('../export/data.xlsx', import.meta.url));
let book;

/** 탭 한 개를 [{머리글: 값}] 으로. 날짜 칸은 엑셀 일련번호(숫자), 빈 칸은 ''. 머리글이 빈 열은 버린다. */
export function readTab(name) {
  book ||= XLSX.readFile(FILE);
  const sheet = book.Sheets[name];
  if (!sheet) throw new Error('탭이 없습니다: ' + name);
  const [head = [], ...body] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
  const keys = head.map((h) => String(h).trim());
  return body
    .filter((row) => row.some((v) => v !== ''))
    .map((row) => Object.fromEntries(keys.map((k, i) => [k, row[i] ?? '']).filter(([k]) => k)));
}

export const text = (v) => String(v ?? '').trim();

/** 쉼표로 이어 적은 칸 → 배열. */
export const list = (v) => (text(v) ? String(v).split(/,\s*/).filter(String) : []);

/** 엑셀 일련번호 → 'yyyy-MM-dd HH:mm:ss' (시트에 보이던 시각 그대로). */
function serialToWall(n) {
  return new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 19).replace('T', ' ');
}

/** 시각 칸 → 'yyyy-MM-dd HH:mm:ss' 또는 null. 읽지 못하는 글자는 예외. */
export function wallTime(v) {
  if (v === '' || v == null) return null;
  if (typeof v === 'number') return serialToWall(v);
  const m = String(v).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) {
    // 글자로 적힌 날짜("Wed Sep 16 2026 10:01:29 GMT+0900 (한국 표준시)")는 한국 시각으로 바꾼다.
    const d = new Date(String(v).replace(/\s*\(.*\)\s*$/, ''));
    if (isNaN(d.getTime())) throw new Error('시각을 읽지 못했습니다: ' + v);
    return new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
  }
  const p = (x, n = 2) => String(x || 0).padStart(n, '0');
  return `${m[1]}-${p(m[2])}-${p(m[3])} ${p(m[4])}:${p(m[5])}:${p(m[6])}`;
}

/** 날짜 칸 → 'yyyy-MM-dd' 또는 null. */
export const wallDate = (v) => { const t = wallTime(v); return t ? t.slice(0, 10) : null; };

/** 날짜일 수도, 아무 글자일 수도 있는 칸 → 날짜면 'yyyy-MM-dd', 아니면 적힌 그대로. */
export const dateOrText = (v) => (typeof v === 'number' ? serialToWall(v).slice(0, 10) : text(v));

/** 시각 칸 → 시간대가 붙은 ISO 값(밀리초까지) 또는 null. 시트의 시각은 한국 시간이다. */
export function kstInstant(v) {
  if (v === '' || v == null) return null;
  if (typeof v === 'number') {
    return new Date(Math.round((v - 25569) * 86400000)).toISOString().replace('Z', '+09:00');
  }
  return wallTime(v).replace(' ', 'T') + '+09:00';
}

/** 탭 한 개를 머리글 없이 줄 배열로(머리글이 비어 있는 열까지 읽어야 할 때). 첫 줄(머리글)은 뺀다. */
export function readTabRows(name) {
  book ||= XLSX.readFile(FILE);
  const sheet = book.Sheets[name];
  if (!sheet) throw new Error('탭이 없습니다: ' + name);
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true }).slice(1).filter((row) => row.some((v) => v !== ''));
}
