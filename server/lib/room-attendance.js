// 11/3(사용자): 교육(출석 모임) 방별 출석 서머리 — 개설자가 걸어 놓은 타임 끝나는 시각마다(예: 오전 10:30, 저녁 21:00)
//   지역 방·교역자 방·부서 총합 방·부서 전체 방에 그 방 사람 출석. 마지막 타임 끝(=모임 끝) = 하루 총 참석.
//   교사는 명단에 등록된 지역(고른 지역이 아니라), 비교사는 적은 부서·지역 방으로. 교육 과정(cohort)·[TEST] 모임은 뺀다.
// 11/4(사용자: "출석도 이런 식으로 정갈하게, 조직적으로"): 활동 서머리와 같은 틀 — 지역 → 부서 → 교자장부청.
//   지역 방(교역자 방) = 숫자 요약(한 줄에 하나) + 타임별 정상/지각으로 나눈 이름(한 줄에 4명).
//   부서 총합·전체 방 = 지역 × (재적·타임·총 참석·출석률·정상·지각·비교사) 민트 표 사진 + 요약 글.
//   교자장부청 = 같은 칸의 보라 표(ATT_TOTAL_ROOM — 사용자 확인 전까지는 시험 방에만).
import { db, run, selectAll } from './db.js';
import { kstDate, kstDateTime } from './util.js';
import { sendRoomText, sendRoomBoard, topicPending, orgLabel, BOARD_THEME } from './report-room.js';
import { tablePng } from './table-image.js';

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const isRoomAttMeeting = (m) => !!m && !m.cohortId && !String(m.title || '').startsWith('[TEST]');
const DEPTS = ['자문회', '장년회', '부녀회', '청년회'];
const ORGS = [['교역자', '교역자회'], ['자문회', '자문회'], ['장년회', '장년회'], ['부녀회', '부녀회'], ['청년회', '청년회']];
// 교자장부청 출석 보라 표를 올릴 방(report-room.js 의 '@교사활동현황' = 교사광장 소통 방). 빈 값이면 실제 방엔 안 올림.
const ATT_TOTAL_ROOM = '';
const ALIAS = { '청년회/새신자': '청년회/기타' };
// '3지역'·'03지역' → '03지역'(방 열쇠 모양)
const regionKey = (r) => { const s = String(r || '').trim(); const m = s.match(/^0*(\d+)지역$/); return m ? m[1].padStart(2, '0') + '지역' : (s || '기타'); };
const roomKeyOf = (dept, region) => { const k = `${dept}/${regionKey(region)}`; return ALIAS[k] || k; };
const regionShow = (r) => { const m = String(r).match(/^0*(\d+)지역$/); return m ? Number(m[1]) + '지역' : r; };
// 회장단(부녀회/기타)은 '출결' 주제로 멤버 출결이 따로 가므로 여기선 뺀다. 활동현황 채널도 뺀다.
const SKIP = (dept) => dept === '*' || dept === '부녀회/기타' || dept.includes('#출결') || dept.includes(':활동현황') || dept.includes(':회장단');
const SESSION_ICON = { 오전: '🌅', 오후: '☀️', 저녁: '🌙' };
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const slotName = (start) => (start < '12:00' ? '오전' : start < '17:00' ? '오후' : '저녁');   // attendance.js slotLabel 과 같게

/** 개설자가 정한 타임들 [{ name, end }] — 타임이 1개 이하면 []. */
export const slotsOf = (m) => ((m.slots || []).length > 1 ? m.slots.map((s) => ({ name: slotName(s.start), end: s.end })) : []);

/** 그날 자료(closingData)를 방 열쇠별로: { key: { 오전:[row], 저녁:[row] } } — 중복·명단 못 찾은 줄은 뺀다. */
function groupRows(rows) {
  const by = new Map();
  for (const r of rows) {
    // 교역자는 관리자 명단에만 있는 분도 있어 부서로 본다
    const td = r.teacherDept || (/교역자/.test(r.dept || '') ? '교역자' : '');
    if (r.dup || !td) continue;
    const key = td === '교역자' ? '교역자' : roomKeyOf(td, r.region);
    if (!by.has(key)) by.set(key, {});
    (by.get(key)[r.session] ||= []).push(r);
  }
  return by;
}
async function rosterCounts() {
  const rows = await selectAll(() => db().from('teachers').select('dept, region').order('sort_order').order('member_id'), 3);
  const c = new Map();
  for (const t of rows) { const k = t.dept === '교역자' ? '교역자' : roomKeyOf(t.dept, t.region); c.set(k, (c.get(k) || 0) + 1); }
  return c;
}
const personKey = (r) => (r.guest ? 'g:' : '') + String(r.id).replace(/\D/g, '') + '|' + r.name;
const uniq = (rows) => new Set(rows.map(personKey)).size;
const allOf = (sess) => Object.values(sess).flat();
const isLate = (r) => /지각/.test(r.late || '');
const headOf = (phase) => (phase === '최종' ? '교육 마감 · 총 참석' : `${phase} 교육 마감`);
const dayOf = (m) => { const [y, mo, d] = m.date.split('-').map(Number); return `${mo}/${d}(${WD[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]})`; };
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const LINE = '━━━━━━━━━━━━';

/** 한 묶음(지역·부서)의 숫자. phase '최종' = 하루(타임 합, 같은 사람 한 번), 아니면 그 타임만. */
function statOf(sess, phase, order) {
  const list = phase === '최종' ? allOf(sess) : (sess[phase] || []);
  const people = new Map();
  for (const r of list) people.set(personKey(r), r);
  const n = people.size;
  const guests = [...people.values()].filter((r) => r.guest).length;
  return {
    n, guests, teachers: n - guests,
    bySession: Object.fromEntries(order.map((s) => [s, phase === '최종' || s === phase ? uniq(sess[s] || []) : 0])),
    normal: list.filter((r) => !isLate(r)).length, late: list.filter(isLate).length,
  };
}
/** 숫자 요약(한 줄에 하나) */
function summaryLines(st, roster, used, phase) {
  const lines = [`👥 ${phase === '최종' ? '참석' : phase + ' 출석'} <b>${st.n}명</b>${roster ? ` / 재적 ${roster}명 (${pct(st.teachers, roster)}%)` : ''}`];
  if (phase === '최종' && used.length > 1) for (const s of used) lines.push(`   ${SESSION_ICON[s] || '🙋'} ${s} ${st.bySession[s]}명`);
  lines.push(`   ✅ 정상 ${st.normal}명`, `   ⏰ 지각 ${st.late}명`);
  if (st.guests) lines.push(`   🙋 비교사 ${st.guests}명`);
  return lines;
}
/** 이름을 한 줄에 4명씩 */
const nameRows = (list) => {
  const names = list.map((r) => esc(r.name) + (r.guest ? '(비)' : ''));
  const out = [];
  for (let i = 0; i < names.length; i += 4) out.push('   ' + names.slice(i, i + 4).join(' · '));
  return out;
};

/** 지역 방(또는 교역자 방) 한 곳의 글. phase = 타임 이름('오전'…) 또는 '최종'. */
function roomText(m, key, sess, total, phase, order) {
  const who = key === '교역자' ? '교역자회' : `${key.split('/')[0]} ${orgLabel(key.split('/')[0], regionShow(key.split('/')[1]))}`;
  const used = phase === '최종' ? order.filter((s) => sess[s]?.length) : [phase];
  const st = statOf(sess, phase, order);
  const lines = [`📋 <b>${esc(m.title)}</b>`, `🗓 ${dayOf(m)} · ${headOf(phase)}`, `📍 <b>${esc(who)}</b>`, LINE, ...summaryLines(st, total, used, phase), LINE];
  for (const s of used) {
    const list = sess[s] || [];
    if (!list.length) continue;
    const ok = list.filter((r) => !isLate(r)), late = list.filter(isLate);
    lines.push(`${SESSION_ICON[s] || '🙋'} <b>${s} ${list.length}명</b>`);
    if (ok.length) lines.push(`✅ 정상 ${ok.length}`, ...nameRows(ok));
    if (late.length) lines.push(`⏰ 지각 ${late.length}`, ...nameRows(late));
    lines.push('');
  }
  if (phase === '최종' && used.length > 1 && st.n < used.reduce((a, s) => a + (sess[s]?.length || 0), 0)) lines.push('※ 오전·저녁 두 번 온 분은 참석 수에 한 번만');
  if (st.guests) lines.push('(비) = 비교사');
  while (lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

/** 행 × 출석 칸 표(민트·보라) + 요약 글. groups = [[이름, sess, 재적]] */
function attBoard({ m, title, firstHead, groups, phase, order, theme, sumLabel, place }) {
  const T = BOARD_THEME[theme] || BOARD_THEME.mint;
  const used = phase === '최종' ? order.filter((s) => groups.some(([, sess]) => sess[s]?.length)) : [phase];
  const split = phase === '최종' && used.length > 1;
  const head = [firstHead, '재적', ...(split ? used : []), phase === '최종' ? '총 참석' : `${phase} 출석`, '출석률', '정상', '지각', '비교사'];
  const allSess = {};
  for (const [, sess] of groups) for (const [s, list] of Object.entries(sess)) (allSess[s] ||= []).push(...list);
  const rosterSum = groups.reduce((a, [, , r]) => a + (r || 0), 0);
  const comma = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const cell = (v) => (v ? comma(v) : '-');
  const row = (label, st, roster) => [label, roster ? comma(roster) : '-', ...(split ? used.map((s) => cell(st.bySession[s])) : []), cell(st.n),
    roster ? `${pct(st.teachers, roster)}%` : '-', cell(st.normal), cell(st.late), cell(st.guests)];
  const stats = groups.map(([label, sess, roster]) => [label, statOf(sess, phase, order), roster]);
  const all = statOf(allSess, phase, order);
  const rows = [...stats.map(([l, st, r]) => row(l, st, r)), row(sumLabel, all, rosterSum)];
  const last = rows.length - 1, totalCol = 2 + (split ? used.length : 0);
  let png = null;
  try {
    png = tablePng({
      title, sub: `${m.title} · ${dayOf(m)} · ${headOf(phase)} · 출석률 = 교사 참석 ÷ 재적(비교사 제외) · 정상·지각 = 출석 건수`,
      head, rows, align: ['left'], headColor: T.head, stripe: T.stripe,
      style: (r, c, v) => {
        if (r === last) return { fill: c ? T.sumFill : T.sumFill0, bold: true, color: T.sumText };
        if (v === '-') return { color: T.dash };
        if (c === 0) return { bold: true };
        if (c === totalCol) return { bold: true, color: T.sumCol };
        return null;
      },
    });
  } catch (e) { console.log('출석 표 이미지 오류: ' + e.message); }
  const came = stats.filter(([, st]) => st.n).length;
  const caption = [`📊 <b>${esc(title)}</b>`, `📌 ${esc(m.title)} · ${dayOf(m)} · ${headOf(phase)}`, '',
    ...summaryLines(all, rosterSum, used, phase), `🗂️ 출석한 ${place} ${came}/${groups.length}`].join('\n');
  // 사진을 못 보낼 때의 글: 줄마다 한 묶음
  const text = [caption, '', `🗂️ ${place}별 (참석/재적)`,
    ...stats.map(([l, st, r]) => ` ▸ ${esc(l)} <b>${st.n}</b>${r ? `/${r}` : ''}${st.late ? ` · 지각 ${st.late}` : ''}${st.guests ? ` · 비교사 ${st.guests}` : ''}`)].join('\n');
  return { png, caption, text, total: all.n };
}

const regionOrder = (dept) => (k) => (k.endsWith('/기타') && dept === '부녀회' ? -1 : (/\/\d+지역$/.test(k) ? Number(k.replace(/\D/g, '')) : 100));
/** 부서 총합 방·부서 전체 방: 지역 × 출석 민트 표. */
function deptBoard(m, dept, by, counts, phase, order) {
  const o = regionOrder(dept);
  const keys = [...new Set([...counts.keys(), ...by.keys()])].filter((k) => k.startsWith(dept + '/'))
    .sort((a, b) => o(a) - o(b) || (a < b ? -1 : 1));
  return attBoard({ m, title: `${dept} 지역별 출석 현황`, firstHead: '지역', theme: 'mint', sumLabel: '총합', place: '지역', phase, order,
    groups: keys.map((k) => [orgLabel(dept, regionShow(k.split('/')[1])), by.get(k) || {}, counts.get(k) || 0]) });
}
/** 교자장부청: 부서 × 출석 보라 표. */
function orgBoard(m, by, counts, phase, order) {
  const groups = ORGS.map(([dept, label]) => {
    const keys = (k) => (dept === '교역자' ? k === '교역자' : k.startsWith(dept + '/'));
    const sess = {};
    for (const [k, s] of by) if (keys(k)) for (const [x, list] of Object.entries(s)) (sess[x] ||= []).push(...list);
    const roster = [...counts].filter(([k]) => keys(k)).reduce((a, [, n]) => a + n, 0);
    return [label, sess, roster];
  });
  return attBoard({ m, title: '교자장부청 출석 현황', firstHead: '부서', theme: 'purple', sumLabel: '5개 조직 총합', place: '조직', phase, order, groups });
}

async function prepare(m, phase) {
  const { closingData } = await import('../actions/attendance-closing.js');
  const data = await closingData(m);
  // 같은 날 다른 모임 출석은 섞지 않는다(이 모임 것만)
  const rows = data.rows.filter((r) => r.meetingId === m.meetingId && (phase === '최종' || r.session === phase));
  const order = [...new Set([...slotsOf(m).map((s) => s.name), '오전', '오후', '저녁', ...rows.map((r) => r.session)])];
  return { by: groupRows(rows), counts: await rosterCounts(), order };
}

/** 보낼 방과 글 목록 → [{ room, text, png?, caption? }]. phase = 타임 이름 또는 '최종'. */
export async function buildRoomAttendance(m, phase) {
  const { by, counts, order } = await prepare(m, phase);
  const rooms = await run(db().from('report_rooms').select('*').eq('active', true));
  const out = [], seenChat = new Set();
  for (const room of rooms) {
    if (SKIP(room.dept) || topicPending(room)) continue;
    const dept = room.dept.split('#')[0];
    if (room.dept.includes('#총합') || DEPTS.includes(room.dept)) {
      // 11/3(사용자): 부서 전체 방에도 총 취합 — 부서 전체 방과 총합 방이 같은 방이면 한 번만
      if (seenChat.has(dept + '|' + String(room.chat_id).split('/')[0])) continue;
      seenChat.add(dept + '|' + String(room.chat_id).split('/')[0]);
      if (![...by.keys()].some((k) => k.startsWith(dept + '/'))) continue;   // 그 부서에서 아무도 안 왔으면 안 올림
      out.push({ room, ...deptBoard(m, dept, by, counts, phase, order) });
    } else {
      if (!by.has(room.dept)) continue;   // 아무도 안 온 지역 방엔 글을 안 올림
      out.push({ room, text: roomText(m, room.dept, by.get(room.dept), counts.get(room.dept) || 0, phase, order) });
    }
  }
  if (ATT_TOTAL_ROOM && by.size) out.push({ room: { dept: '#교자장부청', chat_id: ATT_TOTAL_ROOM }, ...orgBoard(m, by, counts, phase, order) });
  return out;
}

/** 시험 방 미리보기용: 지역 글 몇 개 + 부서 민트 표 + 교자장부청 보라 표. */
export async function attendancePreview(m, phase, regionSamples = 2) {
  const { by, counts, order } = await prepare(m, phase);
  const regionKeys = [...by.keys()].filter((k) => k !== '교역자').sort((a, b) => allOf(by.get(b)).length - allOf(by.get(a)).length).slice(0, regionSamples);
  if (by.has('교역자')) regionKeys.unshift('교역자');
  const texts = regionKeys.map((k) => roomText(m, k, by.get(k), counts.get(k) || 0, phase, order));
  const depts = DEPTS.filter((d) => [...by.keys()].some((k) => k.startsWith(d + '/'))).map((d) => ({ dept: d, ...deptBoard(m, d, by, counts, phase, order) }));
  return { texts, depts, org: by.size ? orgBoard(m, by, counts, phase, order) : null };
}

/** 실제로 올림(방·모임·단계마다 한 번). prefix 가 있으면 샘플(기록 안 남김). */
export async function postRoomAttendance(m, phase, prefix = '') {
  if (!isRoomAttMeeting(m)) return [];
  const sent = [];
  for (const p of await buildRoomAttendance(m, phase)) {
    const { room } = p;
    if (!prefix) {
      const { error } = await db().from('cohort_summary_log').insert({ cohort_id: '#room-att', kind: phase, ref_id: `${room.dept}|${m.meetingId}`, date: m.date, sent_at: kstDateTime() });
      if (error) continue;   // 이미 보냄
    }
    try {
      if (p.caption) await sendRoomBoard(room, p.png, prefix + p.caption, prefix + p.text);
      else await sendRoomText(room.chat_id, prefix + p.text);
      sent.push(room.dept);
    } catch (e) { console.log(`방 출석 서머리 실패 ${room.dept}: ${e.message}`); }
  }
  return sent;
}

/** 5분 주기(attAutoSummary)에서: 오늘 열린 모임의 앞 타임들(마지막 제외)이 끝났으면 그 타임 서머리. 마지막 타임 = 모임 끝 = 최종(마감 때). */
export async function roomAttendanceSlotTick(meetings) {
  const now = kstDateTime().slice(11, 16);
  const done = [];
  for (const m of meetings) {
    if (!isRoomAttMeeting(m) || m.date !== kstDate() || m.status === '삭제') continue;
    const slots = slotsOf(m).slice(0, -1);
    for (const s of slots) {
      if (now < s.end) continue;
      if (slots.filter((x) => x.name === s.name).length > 1 && s !== slots.filter((x) => x.name === s.name).at(-1)) continue;   // 같은 이름 타임이 여럿이면 마지막 것 끝날 때 한 번
      done.push(...(await postRoomAttendance(m, s.name)).map((d) => `${m.meetingId}:${s.name}:${d}`));
    }
  }
  return done;
}
