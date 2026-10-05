// ══════════════════════════════════════════════════════════════════════
// 출석 관리 시스템 — Google Apps Script 추가 코드
// 2026-10-05 by 제사장의 길 앱 (kimjeonggwon12-ux/jesajang-gil)
//
// [사용법]
// 1. Apps Script 편집기에 이 파일 내용을 붙여넣기
// 2. TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_CHAT_ID 채워넣기
// 3. 기존 doPost()의 switch/if 블록에 아래 케이스 추가:
//
//    case 'createMeeting':        return respond(createMeeting(p));
//    case 'recordAttendance':     return respond(recordAttendance(p));
//    case 'getMyAttendance':      return respond(getMyAttendance(p));
//    case 'getAttendanceSummary': return respond(getAttendanceSummary(p));
//    case 'getMeetingList':       return respond(getMeetingList(p));
//
// 4. 새 버전으로 재배포
// ══════════════════════════════════════════════════════════════════════

// ── 텔레그램 설정 ─────────────────────────────────────────────────────
const ATT_TELEGRAM_BOT_TOKEN  = 'YOUR_BOT_TOKEN';   // ← 봇 토큰 입력
const ATT_TELEGRAM_ADMIN_CHAT = 'YOUR_CHAT_ID';     // ← 관리자 채팅 ID

// ── 시트 이름 ─────────────────────────────────────────────────────────
const ATT_SHEET_NAME     = '출석';
const MEETING_SHEET_NAME = '모임';

// ── 시트 초기화 (없으면 자동 생성) ───────────────────────────────────
function attGetOrCreateSheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.getRange(1, 1, 1, headers.length)
      .setBackground('#4F46E5').setFontColor('#fff').setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function getAttSheet_() {
  return attGetOrCreateSheet_(ATT_SHEET_NAME, [
    '출석ID', '모임ID', '모임명', '부서', '모임일시',
    '회원ID', '이름', '참석유형', '기록시각', '기기정보'
  ]);
}

function getMeetingSheet_() {
  return attGetOrCreateSheet_(MEETING_SHEET_NAME, [
    '모임ID', '모임명', '부서', '주최자ID', '주최자명',
    '예정일시', '장소', '생성시각', '상태'
  ]);
}

// ── 모임 생성 ─────────────────────────────────────────────────────────
// payload: { meetingName, dept, hostId, hostName, scheduledAt, place }
function createMeeting(p) {
  const sh = getMeetingSheet_();
  const meetingId = 'M' + Date.now();
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  sh.appendRow([
    meetingId,
    p.meetingName || '모임',
    p.dept        || '',
    p.hostId      || '',
    p.hostName    || '',
    p.scheduledAt || now,
    p.place       || '',
    now,
    '활성'
  ]);

  // QR 진입 URL 생성
  const BASE = 'https://kimjeonggwon12-ux.github.io/jesajang-gil/app.html';
  const qrUrl = BASE
    + '?att=1'
    + '&meetingId='   + encodeURIComponent(meetingId)
    + '&meetingName=' + encodeURIComponent(p.meetingName || '모임')
    + '&dept='        + encodeURIComponent(p.dept || '');

  return { ok: true, meetingId, qrUrl };
}

// ── 출석 등록 ─────────────────────────────────────────────────────────
// payload: { meetingId, meetingName, dept, memberId, name, attType, device }
function recordAttendance(p) {
  const sh = getAttSheet_();

  // 중복 체크 (같은 모임 + 같은 회원)
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) === String(p.meetingId) &&
        String(data[i][5]) === String(p.memberId)) {
      return { ok: false, error: '이미 출석 등록되어 있어요', alreadyDone: true };
    }
  }

  const attId = 'A' + Date.now();
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  sh.appendRow([
    attId,
    p.meetingId   || '',
    p.meetingName || '',
    p.dept        || '',
    now,             // 모임일시 = 등록 시각으로 자동
    p.memberId    || '',
    p.name        || '',
    p.attType     || '정상출석',
    now,
    (p.device     || '').slice(0, 80)
  ]);

  // 텔레그램 알림
  attSendTelegramAlert_(p);

  return { ok: true, attId };
}

// ── 내 출석 이력 조회 ─────────────────────────────────────────────────
// payload: { memberId, limit }
function getMyAttendance(p) {
  const sh = getAttSheet_();
  const data = sh.getDataRange().getValues();
  const rows = [];
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][5]) !== String(p.memberId)) continue;
    rows.push({
      attId:       data[i][0],
      meetingId:   data[i][1],
      meetingName: data[i][2],
      dept:        data[i][3],
      meetingDate: data[i][4],
      attType:     data[i][7],
      recordedAt:  data[i][8]
    });
    if (rows.length >= (p.limit || 30)) break;
  }
  return { ok: true, rows };
}

// ── 전체 출석 현황 (관리자) ───────────────────────────────────────────
// payload: { meetingId?, dept? }
function getAttendanceSummary(p) {
  const sh = getAttSheet_();
  const data = sh.getDataRange().getValues();
  const rows = [];
  for (let i = data.length - 1; i >= 1; i--) {
    const row = {
      attId:       data[i][0],
      meetingId:   data[i][1],
      meetingName: data[i][2],
      dept:        data[i][3],
      meetingDate: data[i][4],
      memberId:    data[i][5],
      name:        data[i][6],
      attType:     data[i][7],
      recordedAt:  data[i][8]
    };
    if (p.meetingId && row.meetingId !== p.meetingId) continue;
    if (p.dept      && row.dept      !== p.dept)      continue;
    rows.push(row);
  }
  return { ok: true, rows, total: rows.length };
}

// ── 모임 목록 조회 ────────────────────────────────────────────────────
// payload: { dept?, hostId? }
function getMeetingList(p) {
  const sh = getMeetingSheet_();
  const data = sh.getDataRange().getValues();
  const rows = [];
  for (let i = data.length - 1; i >= 1; i--) {
    const row = {
      meetingId:   data[i][0],
      meetingName: data[i][1],
      dept:        data[i][2],
      hostId:      data[i][3],
      hostName:    data[i][4],
      scheduledAt: data[i][5],
      place:       data[i][6],
      createdAt:   data[i][7],
      status:      data[i][8]
    };
    if (p.dept   && row.dept   !== p.dept)   continue;
    if (p.hostId && row.hostId !== p.hostId) continue;
    rows.push(row);
    if (rows.length >= 50) break;
  }
  return { ok: true, rows };
}

// ── 텔레그램 출석 알림 ────────────────────────────────────────────────
function attSendTelegramAlert_(p) {
  if (!ATT_TELEGRAM_BOT_TOKEN || ATT_TELEGRAM_BOT_TOKEN === 'YOUR_BOT_TOKEN') return;
  try {
    const msg = `✅ 출석 완료\n`
      + `👤 ${p.name} (${p.memberId})\n`
      + `📋 ${p.meetingName}${p.dept ? ' · ' + p.dept : ''}\n`
      + `🏷️ ${p.attType}\n`
      + `🕐 ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`;
    UrlFetchApp.fetch(
      `https://api.telegram.org/bot${ATT_TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ chat_id: ATT_TELEGRAM_ADMIN_CHAT, text: msg })
      }
    );
  } catch(e) { Logger.log('텔레그램 알림 오류: ' + e); }
}

// ── 텔레봇 명령어 처리 (기존 봇 doPost에 추가) ───────────────────────
// 기존 봇의 doPost() 안에서 text 기반 분기 처리 시 아래 함수를 호출하세요:
//   handleAttBotCommand(text, chatId);
function handleAttBotCommand(text, chatId) {
  const parts = (text || '').trim().split(/\s+/);
  const cmd = parts[0];

  if (cmd === '/출석현황' || cmd === '/att') {
    const meetingId = parts[1] || '';
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ATT_SHEET_NAME);
    if (!sh) { attSendMsg_(chatId, '출석 시트가 없어요'); return; }
    const data = sh.getDataRange().getValues();
    const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
    const rows = data.slice(1).filter(r =>
      (!meetingId || String(r[1]) === meetingId) &&
      String(r[8]).startsWith(today)
    );
    if (!rows.length) { attSendMsg_(chatId, `📋 오늘(${today}) 출석 데이터가 없어요`); return; }
    const cnt = rows.reduce((a, r) => { a[r[7]] = (a[r[7]]||0)+1; return a; }, {});
    const summary = Object.entries(cnt).map(([t,n]) => `  ${t}: ${n}명`).join('\n');
    const names   = rows.map(r => `• ${r[6]} (${r[7]})`).join('\n');
    attSendMsg_(chatId, `📋 오늘 출석 현황\n총 ${rows.length}명\n${summary}\n\n${names}`);
    return;
  }

  if (cmd === '/출석부서') {
    const dept = parts.slice(1).join(' ');
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ATT_SHEET_NAME);
    if (!sh) { attSendMsg_(chatId, '출석 시트가 없어요'); return; }
    const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
    const data  = sh.getDataRange().getValues();
    const todayRows = data.slice(1).filter(r =>
      (!dept || String(r[3]).includes(dept)) &&
      String(r[8]).startsWith(today)
    );
    attSendMsg_(chatId,
      `📌 ${dept||'전체'} 오늘 출석: ${todayRows.length}명\n` +
      todayRows.map(r => `• ${r[6]} (${r[7]})`).join('\n')
    );
    return;
  }

  if (cmd === '/모임목록') {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MEETING_SHEET_NAME);
    if (!sh) { attSendMsg_(chatId, '모임 시트가 없어요'); return; }
    const data = sh.getDataRange().getValues();
    const recent = data.slice(1).slice(-10).reverse(); // 최근 10개
    if (!recent.length) { attSendMsg_(chatId, '모임이 없어요'); return; }
    const list = recent.map(r => `• ${r[1]} [${r[2]}] — ${r[0]}`).join('\n');
    attSendMsg_(chatId, `📂 최근 모임 목록\n${list}`);
    return;
  }
}

function attSendMsg_(chatId, text) {
  try {
    UrlFetchApp.fetch(
      `https://api.telegram.org/bot${ATT_TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ chat_id: chatId, text })
      }
    );
  } catch(e) { Logger.log('텔레그램 전송 오류: ' + e); }
}
