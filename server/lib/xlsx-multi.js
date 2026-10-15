// 시트 여러 장짜리 엑셀(2026-10-15). xlsx-sheet.js(한 장짜리, 옛 소스에서 뽑아 만드는 파일 — 직접 고치지 말 것)가 만든
// 시트들을 한 통으로 합친다. 서식(styles.xml)은 모든 시트가 같아서 첫 장 것을 함께 쓴다.
import { sheetFiles } from './xlsx-sheet.js';

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const safeName = (s) => String(s).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);

/** sheets: [{ name, rows, opts }] → zip 에 넣을 { 경로: 내용 } */
export function workbookFiles(sheets) {
  const [first, ...rest] = sheets;
  const files = sheetFiles(first.name, first.rows, first.opts || {});
  rest.forEach((s, i) => {
    const n = i + 2;
    files[`xl/worksheets/sheet${n}.xml`] = sheetFiles(s.name, s.rows, s.opts || {})['xl/worksheets/sheet1.xml'];
    files['[Content_Types].xml'] = files['[Content_Types].xml'].replace('</Types>',
      `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
    files['xl/workbook.xml'] = files['xl/workbook.xml'].replace('</sheets>',
      `<sheet name="${xmlEsc(safeName(s.name))}" sheetId="${n}" r:id="rIdS${n}"/></sheets>`);
    files['xl/_rels/workbook.xml.rels'] = files['xl/_rels/workbook.xml.rels'].replace('</Relationships>',
      `<Relationship Id="rIdS${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/></Relationships>`);
  });
  return files;
}
