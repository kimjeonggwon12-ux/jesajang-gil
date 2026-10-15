// 출석 마감: 그날 명단을 교사명단과 대조해 정리한 엑셀을 만들어 출석 방에 보낸다.
import { db, run, selectAll } from '../lib/db.js';
import { normId, kstDateTime } from '../lib/util.js';
import { clip } from '../lib/input.js';
import { workbookFiles } from '../lib/xlsx-multi.js';
import { zip } from '../lib/zip.js';
import { sendAttendFile, sendAttendPhoto, sendAttendText } from '../lib/attend-bot.js';
import { isAdmin } from './roster.js';
import { loadMeetings, findMeeting, loadRecords, lateText, pickText, isTestMeeting, slotOf, slotLabel } from './attendance.js';

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
    peopleMatching('teachers', 'member_id, nid, name, dept, region, position, sort_order', 'sort_order', nids, names),
    peopleMatching('admins', 'id, nid, name, dept, position', 'id', nids, names),
  ]);
  const byId = new Map();
  const byName = new Map();
  const add = (nid, person) => {
    byId.set(nid, person);
    if (!byName.has(person.name)) byName.set(person.name, []);
    byName.get(person.name).push(person);
  };
  for (const t of teachers) add(t.nid, { id: formatId(t.member_id), name: t.name, dept: t.dept, position: t.position || '', region: t.region || '', teacherDept: t.dept || '' });
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
export async function closingData(m) {
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
    // 2026-10-15: 타임이 여러 개인 모임은 온 타임 이름(오전·오후·저녁), 아니면 15시 기준 오전/저녁
    const slot = slotOf(meetingOf.get(r.meetingId), r.at.slice(11, 16));
    const session = slot ? slotLabel(slot.start) : (r.at.slice(11, 16) >= EVENING_FROM ? '저녁' : '오전');
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
      at: r.at, late, title: meetingOf.get(r.meetingId)?.title || '', meetingId: r.meetingId, note, dup,
      teacherDept: person?.teacherDept || '', region: person?.region || '',
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

/**
 * 시트 한 장의 줄들. sessions = 이 시트에 넣을 구분(오전/저녁 …) — 그 구분의 요약과 명단만.
 * 2026-10-15: 오전+저녁이 있는 날은 '합계' 시트(전부)와 '저녁' 시트(저녁만)를 따로 만든다(오전은 오전 마감 때 이미 감).
 */
function sheetRows(title, data, sessions) {
  const rows = [];
  rows.push([cell(title, STYLE.title)]);
  rows.push([cell(`마감 ${kstDateTime().slice(0, 16)} · 고유번호는 교사명단과 대조해 정리 · 노랑=번호 수정, 빨강=확인 필요, 회색=중복`, STYLE.plain)]);
  rows.push([]);

  // 위쪽 요약 표: 오전/저녁 × 교·자·장·부·청·기타
  rows.push([cell('구분', STYLE.head), ...ORGS.map((o) => cell(o, STYLE.head)), cell('합계', STYLE.head), cell('정상 출석', STYLE.head), cell('지각', STYLE.head)]);
  const total = {};
  let onTime = 0, late = 0;
  for (const s of sessions) {
    const lc = data.lateCount[s] || { 정상: 0, 지각: 0 };
    onTime += lc.정상; late += lc.지각;
    let sum = 0;
    const counts = ORGS.map((o) => { const n = data.box[s][o] || 0; sum += n; total[o] = (total[o] || 0) + n; return cell(n, STYLE.cell); });
    rows.push([cell(s, STYLE.session), ...counts, cell(sum, STYLE.total), cell(lc.정상, STYLE.cell), cell(lc.지각, STYLE.cell)]);
  }
  const all = ORGS.reduce((n, o) => n + (total[o] || 0), 0);
  rows.push([cell(sessions.length > 1 ? '합계(연인원)' : '합계', STYLE.total), ...ORGS.map((o) => cell(total[o] || 0, STYLE.total)),
    cell(all, STYLE.total), cell(onTime, STYLE.total), cell(late, STYLE.total)]);
  const mine = data.rows.filter((r) => sessions.includes(r.session));
  if (sessions.length > 1) {
    const people = new Set(mine.filter((r) => !r.dup).map((r) => normId(r.id) + '|' + r.name)).size;
    rows.push([cell('실제 인원(두 번 온 분은 한 번)', STYLE.total), cell(people, STYLE.total)]);
  }
  rows.push([]);

  // 명단
  const headRow = rows.length;
  rows.push(['번호', '구분', '이름', '고유번호', '부서', '직책', '소속·지역', '24부서', '출석시각', '출석 상태', '모임', '비고'].map((h) => cell(h, STYLE.head)));
  for (const r of mine) {
    const noteStyle = r.dup ? STYLE.dup : (r.note ? (r.fixed ? STYLE.fixed : STYLE.warn) : STYLE.text);
    rows.push([cell(r.no, STYLE.cell), cell(r.session, STYLE.cell), cell(r.name, STYLE.cell), cell(r.id, STYLE.cell), cell(r.dept, STYLE.cell),
      cell(r.position, STYLE.cell), cell(r.pick || r.org, STYLE.cell), cell(r.dept24, STYLE.cell), cell(r.at.slice(11), STYLE.cell),
      cell(r.late, /지각/.test(r.late) ? STYLE.warn : STYLE.cell), cell(r.title, STYLE.text), cell(r.note, noteStyle)]);
  }
  return {
    rows, opts: { widths: [6, 9, 10, 17, 10, 18, 16, 9, 10, 11, 22, 44], merges: ['A1:L1', 'A2:L2'], freezeRow: headRow + 1, heights: { 0: 26 } },
  };
}

/** 마감 엑셀 파일과 함께 보낼 설명 글. */
async function closingFile(m) {
  const data = await closingData(m);
  const title = `${m.date} ${[...new Set(data.meetings.map((x) => x.title))].join(' + ')} 출석 명단`;
  const both = data.sessions.length > 1;
  const sheets = [{ name: (both ? '합계 ' : '출석 ') + m.date.slice(5), ...sheetRows(title, data, data.sessions) }];
  if (both) {
    // 이 모임의 구분마다 한 장씩 더(같은 날 앞서 마감된 모임 — 예: 따로 만든 오전 모임 — 은 그때 이미 보냈으므로 합계에만)
    const own = data.sessions.filter((s) => data.rows.some((r) => r.session === s && r.meetingId === m.meetingId));
    for (const s of own) sheets.push({ name: `${s} ${m.date.slice(5)}`, ...sheetRows(`${m.date} ${s} 출석 명단`, data, [s]) });
  }

  const lastTitle = String(data.meetings.at(-1).title).replace(/[\\/:*?"<>|]/g, ' ');
  const fileName = `출석_${m.date}_${lastTitle}${both ? '(오전+저녁)' : ''}.xlsx`;
  const bytes = zip(workbookFiles(sheets), fileName);

  const people = data.rows.filter((r) => !r.dup).length;
  const fixedCount = data.rows.filter((r) => r.fixed).length;
  const checkCount = data.rows.filter((r) => !r.dup && r.note && !r.fixed).length;
  const dupCount = data.rows.length - people;
  const caption = `📎 ${title}\n${boxText(data)}` + (fixedCount ? `\n✏️ 번호 수정 ${fixedCount}명` : '') +
    (checkCount ? `\n⚠️ 확인 필요 ${checkCount}명` : '') + (dupCount ? `\n🔁 중복 출석 ${dupCount}건(인원에서 뺌)` : '');
  return { bytes, fileName, caption, data };
}

// ── 지역별 참석 현황 그래프 (2026-10-15) ──
// 교사교육 모임이 마감되면 교·자·장·부·청 순서로 부서마다 한 장씩: 지역별 막대 = 명단 재적 대비 참석률.
// 모양은 통달 대시보드의 '교회별 참여율' 그래프(QuickChart, #c0206b, "N명\n(x%)" 라벨)와 같다.
// 오전 마감 = 오전 출석만, 저녁 마감 = 그날 오전+저녁 합계(같은 사람은 한 번).
const CHART_DEPTS = ['교역자', '자문회', '장년회', '부녀회', '청년회'];
const REGION_LAST = ['교회', '신학', '유아모', '새신자', '기타'];
export const isTeacherEdu = (m) => /교사\s*교육/.test(String(m.title || ''));

const regionLabel = (r) => (/^\d+지역$/.test(r) ? Number(r.replace(/\D/g, '')) + '지역' : r);
function regionCompare(a, b) {
  const key = (r) => (/^\d+/.test(r) ? [0, Number(r.replace(/\D/g, ''))] : [1, REGION_LAST.includes(r) ? REGION_LAST.indexOf(r) : 99]);
  const [ka, kb] = [key(a), key(b)];
  return ka[0] - kb[0] || ka[1] - kb[1] || (a < b ? -1 : 1);
}
const pct = (n, total) => (total ? Math.round((n / total) * 1000) / 10 : 0);

/** 부서별 · 지역별 재적과 참석(사람 수, 오전·저녁 따로도). */
async function regionStats(data) {
  const roster = await selectAll(() => db().from('teachers').select('dept, region').order('sort_order').order('member_id'), 3);
  const stats = new Map(CHART_DEPTS.map((d) => [d, new Map()]));
  const cellOf = (dept, region) => {
    const regions = stats.get(dept);
    if (!regions.has(region)) regions.set(region, { total: 0, people: new Set(), bySession: {} });
    return regions.get(region);
  };
  for (const t of roster) if (stats.has(t.dept)) cellOf(t.dept, t.region || '기타').total++;
  const outside = {};   // 교사명단에서 못 찾은 출석자(관리자 명단에만 있거나 확인 필요) — 부서별 수
  for (const r of data.rows) {
    if (r.dup) continue;
    if (!stats.has(r.teacherDept)) { outside[r.org] ||= new Set(); outside[r.org].add(normId(r.id) + '|' + r.name); continue; }
    const c = cellOf(r.teacherDept, r.region || '기타');
    const key = normId(r.id);
    c.people.add(key);
    (c.bySession[r.session] ||= new Set()).add(key);
  }
  return { stats, outside };
}

/** QuickChart 로 막대 그래프 PNG 를 받는다(통달 대시보드와 같은 설정). */
async function chartPng(title, subtitle, labels, rates, counts) {
  const config = {
    type: 'bar',
    data: { labels, datasets: [{ label: '참석률(%)', data: rates, backgroundColor: '#c0206b' }] },
    options: {
      layout: { padding: { top: 20 } },
      plugins: {
        legend: { display: false },
        datalabels: { anchor: 'end', align: 'top', font: { size: 15, weight: 'bold' }, color: '#222', formatter: '__RATE_FORMATTER__' },
        title: { display: true, text: title, position: 'top', align: 'center', font: { size: 24, weight: 'bold' }, padding: { top: 10, bottom: 4 } },
        subtitle: { display: true, text: subtitle, font: { size: 15 }, color: '#666', padding: { bottom: 20 } },
      },
      scales: {
        x: { ticks: { font: { size: 15, weight: 'bold' } } },
        y: { beginAtZero: true, grace: '12%', ticks: { font: { size: 13 }, callback: '__PCT_TICK_FORMATTER__' } },
      },
    },
  };
  const json = JSON.stringify(config)
    .replace('"__RATE_FORMATTER__"', `function(value, context) { var counts = ${JSON.stringify(counts)}; return counts[context.dataIndex] + "명\\n(" + value + "%)"; }`)
    .replace('"__PCT_TICK_FORMATTER__"', 'function(value) { return value + "%"; }');
  const width = Math.max(700, labels.length * 70 + 160);
  const url = `https://quickchart.io/chart?width=${width}&height=500&backgroundColor=white&version=3&plugins=datalabels&c=${encodeURIComponent(json)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('그래프 서버 HTTP ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}

/** 부서마다 그래프 한 장 + 아래 설명 글. 출석자가 없는 부서는 건너뛴다. */
export async function regionCharts(m, data) {
  const { stats, outside } = await regionStats(data);
  const both = data.sessions.length > 1;
  const when = `${m.date.slice(5).replace('-', '/')} ` + (both ? `${data.sessions.join('+')} 총계` : `${data.sessions[0] || ''} 교육`);
  const only = ORG_OF_PICK[m.org];   // 부서가 정해진 모임이면 그 부서만
  const charts = [];
  for (const dept of CHART_DEPTS) {
    if (only && only !== dept) continue;
    const regions = [...stats.get(dept)].filter(([, c]) => c.total > 0 || c.people.size > 0).sort(([a], [b]) => regionCompare(a, b));
    const came = regions.reduce((n, [, c]) => n + c.people.size, 0);
    if (!came) continue;
    const total = regions.reduce((n, [, c]) => n + c.total, 0);
    const title = `${dept} 지역별 교사 교육 참석 현황`;
    const subtitle = `${when} · 전체 ${pct(came, total)}% (${came}명 / 재적 ${total}명)`;
    const labels = regions.map(([r]) => regionLabel(r));
    const counts = regions.map(([, c]) => c.people.size);
    const rates = regions.map(([, c]) => pct(c.people.size, c.total));
    const lines = regions.map(([r, c], i) => {
      const split = both ? ` · ${data.sessions.map((s) => `${s} ${c.bySession[s]?.size || 0}`).join('·')}` : '';
      return `${regionLabel(r)} ${counts[i]}/${c.total}명 (${rates[i]}%)${split}`;
    });
    const extra = outside[dept]?.size ? `\n※ 교사명단에서 못 찾은 출석자 ${outside[dept].size}명은 위 수에서 뺌` : '';
    const caption = `📊 ${title}\n📅 ${when}\n✅ 전체 ${pct(came, total)}% (${came}명 / 재적 ${total}명)\n\n${lines.join('\n')}${extra}`;
    charts.push({ dept, caption, png: await chartPng(title, subtitle, labels, rates, counts) });
  }
  return charts;
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
  // 교사교육이면 엑셀 다음에 지역별 참석 현황 그래프(교·자·장·부·청 순서)
  if (isTeacherEdu(m)) {
    try {
      for (const c of await regionCharts(m, file.data)) {
        const photo = await sendAttendPhoto(c.png, c.caption);
        if (!photo.ok) await sendAttendText(`⚠️ ${c.dept} 그래프를 보내지 못했어요: ${photo.error}\n\n${c.caption}`);
      }
    } catch (e) { await sendAttendText('⚠️ 지역별 참석 현황 그래프를 만들지 못했어요: ' + (e.message || e)); }
  }
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
