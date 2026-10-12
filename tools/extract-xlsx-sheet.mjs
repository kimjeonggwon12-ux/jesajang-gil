// 옛 AttendanceClosing.gs 에서 엑셀 시트 XML 을 만드는 부분을 글자 그대로 뽑아 server/lib/xlsx-sheet.js 를 만든다
// (서식 번호·색·테두리가 한 글자라도 달라지면 파일 모양이 달라지므로 손으로 옮기지 않는다).
//   node tools/extract-xlsx-sheet.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../backend-source/AttendanceClosing.gs', import.meta.url), 'utf8').split(/\r?\n/);

/** startPattern 줄부터 stopPattern 줄 앞까지. */
function lines(startPattern, stopPattern) {
  const start = src.findIndex((l) => startPattern.test(l));
  const stop = src.findIndex((l, i) => i > start && stopPattern.test(l));
  if (start === -1 || stop === -1) throw new Error('못 찾음: ' + startPattern);
  return src.slice(start, stop).join('\n');
}

const escapeFn = lines(/^function _attXmlEsc_\(/, /^function _attColName_\(/).trimEnd();
const colFn = lines(/^function _attColName_\(/, /^function _attXlsxBlob_\(/).trimEnd();
// 파일 꾸러미(files)를 만드는 데까지만 — 압축은 lib/zip.js 가 한다.
const builder = lines(/^function _attXlsxBlob_\(/, /^\s*var blobs = /).trimEnd();

writeFileSync(new URL('../server/lib/xlsx-sheet.js', import.meta.url), `// 서식이 있는 엑셀 시트 한 장의 내용물(XML 파일들)을 만든다.
// ⚠️ 이 파일은 tools/extract-xlsx-sheet.mjs 가 옛 AttendanceClosing.gs 에서 그대로 뽑아 만든다 — 직접 고치지 말 것.
/* eslint-disable */

${escapeFn}

${colFn}

${builder}
  return files;
}

/** rows: [[{ v: 값, s: 서식번호 }, …], …] → { 'xl/…xml': 내용 } */
export { _attXlsxBlob_ as sheetFiles };
`);
console.log('server/lib/xlsx-sheet.js 생성');
