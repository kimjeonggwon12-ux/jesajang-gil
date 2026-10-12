// 서식이 있는 엑셀 시트 한 장의 내용물(XML 파일들)을 만든다.
// ⚠️ 이 파일은 tools/extract-xlsx-sheet.mjs 가 옛 AttendanceClosing.gs 에서 그대로 뽑아 만든다 — 직접 고치지 말 것.
/* eslint-disable */

function _attXmlEsc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function _attColName_(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }

/**
 * rows: [[{v, s}]] (v=값 숫자/글자, s=스타일 번호) / opts: { widths:[], merges:['A1:K1'], freezeRow }
 * 스타일: 0 기본, 1 머리글(초록 굵은 흰 글씨), 2 테두리 칸, 3 제목, 4 박스 머리(연초록 굵게), 5 노랑(수정), 6 빨강(확인), 7 박스 합계(굵게), 8 테두리 왼쪽정렬, 9 회색(중복)
 */

function _attXlsxBlob_(sheetName, rows, opts, fileName) {
  var sd = rows.map(function (row, ri) {
    var cells = row.map(function (c, ci) {
      if (c == null) return '';
      var ref = _attColName_(ci) + (ri + 1), st = c.s || 0;
      if (c.v === '' || c.v == null) return '<c r="' + ref + '" s="' + st + '"/>';
      if (typeof c.v === 'number') return '<c r="' + ref + '" s="' + st + '"><v>' + c.v + '</v></c>';
      return '<c r="' + ref + '" s="' + st + '" t="inlineStr"><is><t xml:space="preserve">' + _attXmlEsc_(c.v) + '</t></is></c>';
    }).join('');
    return '<row r="' + (ri + 1) + '"' + (opts.heights && opts.heights[ri] ? ' ht="' + opts.heights[ri] + '" customHeight="1"' : '') + '>' + cells + '</row>';
  }).join('');
  var cols = (opts.widths || []).map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; }).join('');
  var pane = opts.freezeRow ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="' + opts.freezeRow + '" topLeftCell="A' + (opts.freezeRow + 1) + '" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : '';
  var merges = (opts.merges || []).length ? '<mergeCells count="' + opts.merges.length + '">' + opts.merges.map(function (r) { return '<mergeCell ref="' + r + '"/>'; }).join('') + '</mergeCells>' : '';
  var sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + pane +
    (cols ? '<cols>' + cols + '</cols>' : '') + '<sheetData>' + sd + '</sheetData>' + merges +
    '<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>';
  var thin = '<border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border>';
  var fill = function (rgb) { return '<fill><patternFill patternType="solid"><fgColor rgb="' + rgb + '"/><bgColor indexed="64"/></patternFill></fill>'; };
  var xf = function (font, fillId, border, h) { return '<xf numFmtId="49" fontId="' + font + '" fillId="' + fillId + '" borderId="' + border + '" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="' + h + '" vertical="center" wrapText="1"/></xf>'; };
  var styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="4"><font><sz val="10"/><name val="맑은 고딕"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/></font>' +
    '<font><b/><sz val="14"/><name val="맑은 고딕"/></font><font><b/><sz val="10"/><name val="맑은 고딕"/></font></fonts>' +
    '<fills count="8"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    fill('FF00AE82') + fill('FFE3F6EF') + fill('FFFFF4CC') + fill('FFFFD6D6') + fill('FFC9EEDF') + fill('FFEDEDED') + '</fills>' +
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' + thin + '</borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="10">' +
    xf(0, 0, 0, 'left') + xf(1, 2, 1, 'center') + xf(0, 0, 1, 'center') + '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>' +
    xf(3, 3, 1, 'center') + xf(0, 4, 1, 'left') + xf(0, 5, 1, 'left') + xf(3, 6, 1, 'center') + xf(0, 0, 1, 'left') + xf(0, 7, 1, 'left') +
    '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  var files = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="' + _attXmlEsc_(String(sheetName).replace(/[\\\/\?\*\[\]:]/g, ' ').slice(0, 31)) + '" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': sheet,
    'xl/styles.xml': styles
  };
  return files;
}

/** rows: [[{ v: 값, s: 서식번호 }, …], …] → { 'xl/…xml': 내용 } */
export { _attXlsxBlob_ as sheetFiles };
