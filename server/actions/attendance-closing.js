// 출석 마감: 그날 명단을 교사명단과 대조해 정리한 엑셀을 만들어 출석 방에 보낸다.
import { db, run, selectAll } from '../lib/db.js';
import { normId, kstDateTime } from '../lib/util.js';
import { clip } from '../lib/input.js';
import { sheetFiles } from '../lib/xlsx-sheet.js';
import { zip } from '../lib/zip.js';
import { sendAttendFile } from '../lib/attend-bot.js';
import { isAdmin } from './roster.js';
import { loadMeetings, findMeeting, loadRecords, lateText, pickText, isTestMeeting } from './attendance.js';

const ORGS = ['교역자', '자문회', '장년회', '부녀회', '청년회', '기타'];
const EVENING_FROM = '15:00';   // 이 시각부터 출석한 사람은 '저녁'
const ORG_OF_PICK = { 교역자: '교역자', 자문: '자문회', 장년: '장년회', 부녀: '부녀회', 청년: '청년회' };

/** 고유번호를 '00000000-00000' 꼴로(숫자 13자리가 될 때만). */
function formatId(raw) {
  const s = String(raw == null ? '' : raw).trim();
  let d = s.replace(/\D/g, '');
  if (d.length === 11 || d.length === 12) d = ('00' + d).slice(-13);
  return d.length === 13 ? d.slice(0, 8) + '-' + d.slice(8) : s;
}

/** 교·자·장·부·청·기타 중 어디로 셀지: 고른 소속 → 부서 이름 순으로 본다. */
function orgOf(rec, person) {
  if (ORG_OF_PICK[rec.pickOrg]) return ORG_OF_PICK[rec.pickOrg];
  const text = [rec.dept, person?.dept].join(' ');
  return Object.entries(ORG_OF_PICK).find(([k]) => text.includes(k))?.[1] || '기타';
}

/** 번호나 이름이 목록에 있는 사람만 읽는다(200개씩 나눠서). 같은 줄이 두 번 잡히면 한 번만. */
async function peopleMatching(table, columns, order, nids, names) {
  const found = new Map();
  const chunks = (list) => Array.from({ length: Math.ceil(list.length / 200) }, (_, i) => list.slice(i * 200, (i + 1) * 200));
  const queries = [
    ...chunks(nids).map((part) => db().from(table).select(columns).in('nid', part).order(order)),
    ...chunks(names).map((part) => db().from(table).select(columns).in('name', part).order(order)),
  ];
  for (const rows of await Promise.all(queries.map(run))) for (const r of rows) found.set(r[order], r);
  return [...found.values()].sort((a, b) => a[order] - b[order]);
}

/**
 * 출석한 사람들을 찾을 명단(교사명단 + 관리자 명단): 번호가 같은 사람과 이름이 같은 사람만 읽는다.
 * (이름으로도 읽는 까닭 — 번호를 잘못 넣은 사람을 이름으로 찾고, 같은 이름이 몇 명인지 알아야 해서.)
 */
async function loadDirectory(records) {
  const nids = [...new Set(records.map((r) => normId(r.memberId ?? r.member_id)))].filter((n) => n !== '0');
  const names = [...new Set(records.map((r) => r.name).filter(Boolean))];
  const [teachers, admins] = await Promise.all([
    peopleMatching('teachers', 'member_id, nid, name, dept, position, sort_order', 'sort_order', nids, names),
    peopleMatching('admins', 'id, nid, name, dept, position', 'id', nids, names),
  ]);
  const byId = new Map();
  const byName = new Map();
  const add = (nid, person) => {
    byId.set(nid, person);
    if (!byName.has(person.name)) byName.set(person.name, []);
    byName.get(person.name).push(person);
  };
  for (const t of teachers) add(t.nid, { id: formatId(t.member_id), name: t.name, dept: t.dept, position: t.position || '' });
  for (const a of admins) {
    const known = byId.get(a.nid);
    if (known) {
      if (a.position) known.position = a.position;
      if (!known.dept) known.dept = a.dept;
    } else {
      add(a.nid, { id: formatId(a.nid.padStart(13, '0')), name: a.name, dept: a.dept, position: a.position });
    }
  }
  return { byId, byName };
}

/**
 * 출석한 사람을 명단에서 찾는다.
 * 번호가 맞아도 이름이 다르면 번호를 믿지 않고 이름으로 다시 찾는다(같은 이름이 여럿이면 번호 뒤 5자리로 가린다).
 */
function matchPerson(rec, dir) {
  let person = dir.byId.get(normId(rec.memberId)) || null;
  if (person && person.name && rec.name && person.name !== rec.name) person = null;
  if (person) return { person, note: '' };

  let candidates = dir.byName.get(rec.name) || [];
  const tail = String(rec.memberId).replace(/\D/g, '').slice(-5);
  if (candidates.length > 1 && tail.length === 5) {
    const sameTail = candidates.filter((c) => c.id.replace(/\D/g, '').slice(-5) === tail);
    if (sameTail.length === 1) candidates = sameTail;
  }
  if (candidates.length === 1) return { person: candidates[0], note: `입력번호 ${rec.memberId || '(없음)'} → 명단 이름으로 찾아 수정` };
  const digits = String(rec.memberId).replace(/\D/g, '');
  return {
    person: null,
    note: (digits.length < 11 ? '⚠️ 번호 자릿수 부족·' : '') + '명단에 없음' + (candidates.length > 1 ? `(같은 이름 ${candidates.length}명)` : '') + ' — 확인 필요',
  };
}

/**
 * 그날의 마감 자료: 이 모임과, 같은 날 이 모임보다 먼저(또는 같이) 시작한 모임들의 출석을 합쳐
 * 오전/저녁으로 나누고, 같은 사람의 중복 출석은 인원에서 뺀다.
 */
async function closingData(m) {
  const meetings = (await loadMeetings()).filter((x) => x.date === m.date && !isTestMeeting(x) && (x.start || '') <= (m.start || ''));
  if (!meetings.some((x) => x.meetingId === m.meetingId)) meetings.push(m);
  meetings.sort((a, b) => ((a.start || '') < (b.start || '') ? -1 : 1));
  const meetingOf = new Map(meetings.map((x) => [x.meetingId, x]));

  const records = await loadRecords((q) => q.in('meeting_id', [...meetingOf.keys()]));
  const dir = await loadDirectory(records);
  records.sort((a, b) => (a.at < b.at ? -1 : (a.at > b.at ? 1 : 0)));

  const firstRowOf = new Map();   // "오전|번호" → 처음 나온 줄 번호
  const box = {};
  const lateCount = {};
  const rows = [];
  for (const r of records) {
    const { person, note: matchNote } = matchPerson(r, dir);
    const id = person ? person.id : formatId(r.memberId);
    const session = r.at.slice(11, 16) >= EVENING_FROM ? '저녁' : '오전';
    const org = orgOf(r, person);
    const late = r.late || lateText(meetingOf.get(r.meetingId), r.at);   // 지각 표시가 없는 옛 기록은 시작 시각으로 계산
    const key = `${session}|${normId(id)}`;
    const dup = firstRowOf.has(key);
    let note = matchNote;
    if (dup) {
      note = (note ? note + ' / ' : '') + `중복 출석(${firstRowOf.get(key)}번과 같은 사람, 인원에서 뺌)`;
    } else {
      firstRowOf.set(key, rows.length + 1);
      box[session] ||= {};
      box[session][org] = (box[session][org] || 0) + 1;
      lateCount[session] ||= { 정상: 0, 지각: 0 };
      lateCount[session][/지각/.test(late) ? '지각' : '정상']++;
    }
    rows.push({
      no: rows.length + 1, session, name: r.name, id,
      dept: r.dept || person?.dept || org,
      position: r.position || person?.position || (person ? '교사' : ''),
      org, pick: pickText({ pickOrg: r.pickOrg, pickDistrict: r.pickDistrict, dept24: '' }), dept24: r.dept24,
      at: r.at, late, title: meetingOf.get(r.meetingId)?.title || '', note, dup,
      fixed: !!note && !dup && !note.includes('⚠️') && !note.includes('확인 필요'),
    });
  }
  return { meetings, rows, box, sessions: Object.keys(box).sort(), lateCount };   // '오전' < '저녁'
}

/** "📊 교자장부청" 요약 글. */
function boxText(data) {
  const short = (o) => o.replace('회', '');
  const total = {};
  const lines = data.sessions.map((s) => {
    const b = data.box[s];
    let sum = 0;
    const parts = ORGS.filter((o) => b[o]).map((o) => { sum += b[o]; total[o] = (total[o] || 0) + b[o]; return `${short(o)} ${b[o]}`; });
    const lc = data.lateCount[s];
    return `▪ ${s} ${sum}명 — ${parts.join(' · ')}` + (lc?.지각 ? `\n   (정상 ${lc.정상} · 지각 ${lc.지각})` : '');
  });
  if (data.sessions.length > 1) {
    const all = ORGS.reduce((n, o) => n + (total[o] || 0), 0);
    lines.push(`▪ 합계 ${all}명 — ${ORGS.filter((o) => total[o]).map((o) => `${short(o)} ${total[o]}`).join(' · ')}`);
  }
  return '📊 교자장부청\n' + lines.join('\n');
}

export const closingBoxText = async (m) => boxText(await closingData(m));

// 엑셀 서식 번호(lib/xlsx-sheet.js 의 cellXfs 순서)
const STYLE = { plain: 0, head: 1, cell: 2, title: 3, session: 4, fixed: 5, warn: 6, total: 7, text: 8, dup: 9 };
const cell = (v, s) => ({ v, s });

/** 마감 엑셀 파일과 함께 보낼 설명 글. */
async function closingFile(m) {
  const data = await closingData(m);
  const title = `${m.date} ${[...new Set(data.meetings.map((x) => x.title))].join(' + ')} 출석 명단`;
  const rows = [];
  rows.push([cell(title, STYLE.title)]);
  rows.push([cell(`마감 ${kstDateTime().slice(0, 16)} · 고유번호는 교사명단과 대조해 정리 · 노랑=번호 수정, 빨강=확인 필요, 회색=중복`, STYLE.plain)]);
  rows.push([]);

  // 위쪽 요약 표: 오전/저녁 × 교·자·장·부·청·기타
  rows.push([cell('구분', STYLE.head), ...ORGS.map((o) => cell(o, STYLE.head)), cell('합계', STYLE.head), cell('정상 출석', STYLE.head), cell('지각', STYLE.head)]);
  const total = {};
  let onTime = 0, late = 0;
  for (const s of data.sessions) {
    const lc = data.lateCount[s] || { 정상: 0, 지각: 0 };
    onTime += lc.정상; late += lc.지각;
    let sum = 0;
    const counts = ORGS.map((o) => { const n = data.box[s][o] || 0; sum += n; total[o] = (total[o] || 0) + n; return cell(n, STYLE.cell); });
    rows.push([cell(s, STYLE.session), ...counts, cell(sum, STYLE.total), cell(lc.정상, STYLE.cell), cell(lc.지각, STYLE.cell)]);
  }
  const all = ORGS.reduce((n, o) => n + (total[o] || 0), 0);
  rows.push([cell(data.sessions.length > 1 ? '합계(연인원)' : '합계', STYLE.total), ...ORGS.map((o) => cell(total[o] || 0, STYLE.total)),
    cell(all, STYLE.total), cell(onTime, STYLE.total), cell(late, STYLE.total)]);
  rows.push([]);

  // 명단
  const headRow = rows.length;
  rows.push(['번호', '구분', '이름', '고유번호', '부서', '직책', '소속·지역', '24부서', '출석시각', '출석 상태', '모임', '비고'].map((h) => cell(h, STYLE.head)));
  for (const r of data.rows) {
    const noteStyle = r.dup ? STYLE.dup : (r.note ? (r.fixed ? STYLE.fixed : STYLE.warn) : STYLE.text);
    rows.push([cell(r.no, STYLE.cell), cell(r.session, STYLE.cell), cell(r.name, STYLE.cell), cell(r.id, STYLE.cell), cell(r.dept, STYLE.cell),
      cell(r.position, STYLE.cell), cell(r.pick || r.org, STYLE.cell), cell(r.dept24, STYLE.cell), cell(r.at.slice(11), STYLE.cell),
      cell(r.late, /지각/.test(r.late) ? STYLE.warn : STYLE.cell), cell(r.title, STYLE.text), cell(r.note, noteStyle)]);
  }

  const lastTitle = String(data.meetings.at(-1).title).replace(/[\\/:*?"<>|]/g, ' ');
  const fileName = `출석_${m.date}_${lastTitle}${data.sessions.length > 1 ? '(오전+저녁)' : ''}.xlsx`;
  const bytes = zip(sheetFiles('출석 ' + m.date.slice(5), rows, {
    widths: [6, 9, 10, 17, 10, 18, 16, 9, 10, 11, 22, 44], merges: ['A1:L1', 'A2:L2'], freezeRow: headRow + 1, heights: { 0: 26 },
  }, fileName));

  const people = data.rows.filter((r) => !r.dup).length;
  const fixedCount = data.rows.filter((r) => r.fixed).length;
  const checkCount = data.rows.filter((r) => !r.dup && r.note && !r.fixed).length;
  const dupCount = data.rows.length - people;
  const caption = `📎 ${title}\n${boxText(data)}` + (fixedCount ? `\n✏️ 번호 수정 ${fixedCount}명` : '') +
    (checkCount ? `\n⚠️ 확인 필요 ${checkCount}명` : '') + (dupCount ? `\n🔁 중복 출석 ${dupCount}건(인원에서 뺌)` : '');
  return { bytes, fileName, caption, data };
}

/** 출석 기록의 번호를 명단에 있는 꼴(00000000-00000)로 맞춰 둔다 — 같은 사람이면 표기만 고친다. */
async function tidyRecordIds(meetingIds) {
  const rows = await selectAll(() => db().from('attend_records').select('id, member_id, name').in('meeting_id', meetingIds).neq('member_id', '').order('id'));
  const dir = await loadDirectory(rows);
  for (const r of rows) {
    const fixed = dir.byId.get(normId(r.member_id))?.id || formatId(r.member_id);
    if (fixed !== r.member_id && normId(fixed) === normId(r.member_id)) {
      await run(db().from('attend_records').update({ member_id: fixed }).eq('id', r.id));
    }
  }
}

/** 마감 파일을 만들어 출석 방에 보낸다. */
export async function sendClosing(m) {
  const file = await closingFile(m);
  try { await tidyRecordIds(file.data.meetings.map((x) => x.meetingId)); } catch (e) { console.log('번호 정리 오류: ' + e); }
  const sent = await sendAttendFile(file.bytes, file.fileName, file.caption);
  return { ok: sent.ok, error: sent.error, count: file.data.rows.length, fileName: file.fileName, caption: file.caption };
}

/** 관리자가 직접 누르는 "마감 명단 보내기". dryRun 이면 보내지 않고 파일만 돌려준다. */
async function attSendClosing(body) {
  const mid = clip(body.memberId, 40);
  if (!mid || !(await isAdmin(mid))) return { error: '관리자만 할 수 있어요.' };
  const m = await findMeeting(clip(body.meetingId, 40));
  if (!m) return { error: '모임을 찾을 수 없어요.' };
  if (body.dryRun) {
    const file = await closingFile(m);
    return { ok: true, dryRun: true, fileName: file.fileName, caption: file.caption, base64: file.bytes.toString('base64') };
  }
  return sendClosing(m);
}

export default { attSendClosing };
