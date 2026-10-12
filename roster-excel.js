// 행정의 "교사관리" 엑셀에서 교사 명단을 뽑는다. 화면(관리자 탭 → 명단 → 엑셀 올리기)이 쓰고, 점검 도구도 같은 파일을 쓴다.
// 칸 위치는 달마다 조금씩 바뀔 수 있어, 머리글 글자로 열을 찾는다(못 찾으면 무엇이 없는지 알려 준다).
(function (root) {
  'use strict';

  var text = function (v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); };
  var num = function (v) { var n = Number(v); return isFinite(n) ? n : 0; };
  var isMemberId = function (v) { return text(v).replace(/\D/g, '').length >= 11; };
  var normId = function (v) { return text(v).replace(/\D/g, '').replace(/^0+/, '') || '0'; };

  /** 달 탭 이름("9월", "10월")을 달 숫자가 큰 것부터. */
  function monthTabs(sheetNames) {
    return sheetNames.filter(function (n) { return /^\d{1,2}월$/.test(text(n)); })
      .sort(function (a, b) { return parseInt(b, 10) - parseInt(a, 10); });
  }

  function findRow(rows, limit, test) {
    for (var i = 0; i < Math.min(limit, rows.length); i++) if (test(rows[i] || [])) return i;
    return -1;
  }
  function findCol(row, test, from) {
    for (var c = from || 0; c < (row || []).length; c++) if (test(text(row[c]))) return c;
    return -1;
  }

  /**
   * @param rowsOf  탭 이름 → 줄 배열(칸 배열)의 배열. 없는 탭이면 null.
   * @param tabName 읽을 달 탭("9월")
   * @returns { rows: [{ memberId, name, dept, region, note, regLeads, unregLeads, counsel, gospelRoom, companion, activeState, tier }], dormant, problems }
   */
  function parse(rowsOf, tabName) {
    var sheet = rowsOf(tabName);
    if (!sheet) return { rows: [], problems: ['"' + tabName + '" 탭이 없습니다.'] };
    var problems = [];

    var h = findRow(sheet, 10, function (r) { return findCol(r, function (t) { return t === '고유번호'; }) !== -1 && findCol(r, function (t) { return t === '이름'; }) !== -1; });
    if (h < 1) return { rows: [], problems: ['"고유번호"·"이름" 머리글 줄을 찾지 못했습니다.'] };
    var head = sheet[h], group = sheet[h - 1] || [], top = sheet[0] || [];
    var col = function (label) { return findCol(head, function (t) { return t === label; }); };
    var C = { id: col('고유번호'), name: col('이름'), dept: col('부서'), region: col('지역'), note: col('소속비고'),
              counsel: col('상담'), gospel: col('복음방'), companion: col('동행교사'), result: col('결과') };
    ['dept', 'region', 'note', 'result'].forEach(function (k) {
      if (C[k] === -1) problems.push('"' + { dept: '부서', region: '지역', note: '소속비고', result: '결과' }[k] + '" 열을 찾지 못했습니다.');
    });
    // 센터등록(인도·교사·섬김) / 센터미등록(인도·교사·섬김·섬등추가)은 머리글 윗줄의 묶음 이름으로 찾는다.
    var reg = findCol(group, function (t) { return t.indexOf('센터등록') === 0; });
    var unreg = findCol(group, function (t) { return t.indexOf('센터미등록') === 0; });
    if (reg === -1) problems.push('"센터등록" 묶음을 찾지 못했습니다.');
    if (unreg === -1) problems.push('"센터미등록" 묶음을 찾지 못했습니다.');
    // 신천기 올해 센터등록 명단(수강생 한 줄에 실제인도·실제교사·섬김이의 고유번호)
    var lead = findCol(top, function (t) { return t === '실제인도'; });
    if (lead === -1) problems.push('"실제인도" 열(올해 센터등록 명단)을 찾지 못했습니다.');
    if (problems.length) return { rows: [], problems: problems };

    // 휴면 탭: 휴교사 명단
    var dormant = {};
    var dSheet = rowsOf('휴면');
    if (dSheet) {
      var dh = findRow(dSheet, 10, function (r) { return findCol(r, function (t) { return t === '고유번호'; }) !== -1; });
      var dc = dh === -1 ? -1 : findCol(dSheet[dh], function (t) { return t === '고유번호'; });
      for (var d = dh + 1; dc !== -1 && d < dSheet.length; d++) if (isMemberId((dSheet[d] || [])[dc])) dormant[normId(dSheet[d][dc])] = true;
    } else problems.push('"휴면" 탭이 없어 휴교사를 가려내지 못했습니다(모두 활동교사 기준으로 봅니다).');

    // 올해 센터등록 수: 수강생 한 줄에 같은 사람이 여러 칸에 있어도 한 명으로 센다.
    var leads = {};
    for (var i = h + 1; i < sheet.length; i++) {
      var seen = {};
      for (var k = 0; k < 3; k++) {
        var v = (sheet[i] || [])[lead + k];
        if (!isMemberId(v)) continue;
        var nid = normId(v);
        if (seen[nid]) continue;
        seen[nid] = true;
        leads[nid] = (leads[nid] || 0) + 1;
      }
    }

    var rows = [], dup = {};
    for (var r = h + 1; r < sheet.length; r++) {
      var x = sheet[r] || [];
      if (!isMemberId(x[C.id]) || !text(x[C.name])) continue;
      var id = text(x[C.id]), n = normId(id);
      if (dup[n]) continue;   // 같은 번호가 두 번 나오면 첫 줄만
      dup[n] = true;
      var result = text(x[C.result]);
      var count = leads[n] || 0;
      rows.push({
        memberId: id, name: text(x[C.name]), dept: text(x[C.dept]), region: text(x[C.region]), note: text(x[C.note]),
        regLeads: num(x[reg]) + num(x[reg + 1]) + num(x[reg + 2]),
        unregLeads: num(x[unreg]) + num(x[unreg + 1]) + num(x[unreg + 2]) + num(x[unreg + 3]),
        counsel: C.counsel === -1 ? 0 : num(x[C.counsel]), gospelRoom: C.gospel === -1 ? 0 : num(x[C.gospel]),
        companion: C.companion === -1 ? 0 : num(x[C.companion]), activeState: result,
        // 등급: 올해 센터등록 2명 이상 우수교사, 1명 정교사. 그 밖에는 결과가 활동교사면 활동교사, 휴면 탭에 있으면 휴교사, 나머지 활동교사.
        tier: count >= 2 ? '우수교사' : count === 1 ? '정교사' : result === '활동교사' ? '활동교사' : dormant[n] ? '휴교사' : '활동교사'
      });
    }
    if (!rows.length) problems.push('명단을 한 명도 읽지 못했습니다.');
    return { rows: rows, dormant: Object.keys(dormant).length, problems: problems };
  }

  var api = { monthTabs: monthTabs, parse: parse };
  root.RosterExcel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
