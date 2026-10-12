// 내려받은 시트 엑셀(tools/export/data.xlsx)을 탭 단위로 읽는다.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const FILE = fileURLToPath(new URL('../export/data.xlsx', import.meta.url));
let book;

/** 탭 한 개를 [{머리글: 값}] 으로. 날짜 칸은 Date, 빈 칸은 ''. 머리글이 빈 열은 버린다. */
export function readTab(name) {
  book ||= XLSX.readFile(FILE, { cellDates: true });
  const sheet = book.Sheets[name];
  if (!sheet) throw new Error('탭이 없습니다: ' + name);
  const [head = [], ...body] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
  const keys = head.map((h) => String(h).trim());
  return body
    .filter((row) => row.some((v) => v !== ''))
    .map((row) => Object.fromEntries(keys.map((k, i) => [k, row[i] ?? '']).filter(([k]) => k)));
}

export const text = (v) => (v instanceof Date ? v.toISOString() : String(v ?? '').trim());
