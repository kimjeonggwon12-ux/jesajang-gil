// ── 교육별 재적 출석 서머리 (2026-11-12) ── 사용자: "목요 사명자 교육은 교사 재적이 아니라 부구역장 이상 사명자 재적으로 참석률을.
//   각 방마다 그 지역 사명자 대상 기준 새 데이터, 오전·저녁 따로 + 통합, 오전·저녁 참석자 명단, 교역자는 교회 교역자와 신학부
//   (센터 강사·센터 전도사·신학부장·원장 등) 분리, 지각자·불참자 명단까지 텔레방에."
//   정기 교육(attend_series)에 roster_key 가 걸려 있으면 room-attendance.js postRoomAttendance 가 이쪽으로 넘긴다.
//   재적 = edu_roster(roster_key). 엑셀 부서: 교회교역·신학교역 → 교역자 방(둘로 나눠), 자문·장년·부녀·청년 → '부서/지역' 방,
//   장로회·24부서 → 방 없음(교육 방 통합에만). 교육 방 = report_rooms '#교육:<정기 교육 번호>'(도우미연결에서 연결).
//   summary_to='test' 면 실제 방 대신 나만의 교사광장 시험 방으로(어느 방에 갈 글인지 머리에 적어서).
import { db, run, selectAll } from './db.js';
import { kstDateTime, normId } from './util.js';
import { sendRoomText, sendRoomBoard, topicPending, orgLabel, BOARD_THEME } from './report-room.js';
import { tablePng } from './table-image.js';

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const MY_TEST_CHAT = '-1004460094453';
const DEPTS = ['자문회', '장년회', '부녀회', '청년회'];
// 엑셀 오른쪽 집계 표 순서
const GROUPS = ['교회교역', '신학교역', '장로회', '자문회', '장년회', '부녀회', '청년회', '24부서'];
const GROUP_LABEL = { 교회교역: '교회 교역자', 신학교역: '신학부 교역자', '24부서': '24부서' };
const ALIAS = { '청년회/새신자': '청년회/기타' };
const regionKey = (r) => { const s = String(r || '').trim(); const m = s.match(/^0*(\d+)지역$/); return m ? m[1].padStart(2, '0') + '지역' : (s || '기타'); };
const roomKeyOf = (dept, region) => { const k = `${dept}/${regionKey(region)}`; return ALIAS[k] || k; };
const regionShow = (r) => { const m = String(r).match(/^0*(\d+)지역$/); return m ? Number(m[1]) + '지역' : r; };
const SKIP = (dept) => dept === '*' || dept === '부녀회/기타' || dept.includes('#출결') || dept.includes(':활동현황') || dept.includes(':회장단');
const ICON = { 오전: '🌅', 오후: '☀️', 저녁: '🌙' };
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const LINE = '━━━━━━━━━━━━';
const slotName = (start) => (start < '12:00' ? '오전' : start < '17:00' ? '오후' : '저녁');
const dayOf = (m) => { const [y, mo, d] = m.date.split('-').map(Number); return `${mo}/${d}(${WD[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]})`; };
const pct = (a, b) => (b ? (Math.round((a / b) * 1000) / 10).toFixed(1) + '%' : '-');
const isLate = (r) => !!r && /지각/.test(r.late || '');
const lateMin = (r) => (String(r.late || '').match(/(\d+)분/) || [])[1] || '';
const comma = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const groupOfKey = (key) => (key === '교역자' ? '교역자' : key.split('/')[0]);

/** 이 모임이 교육별 재적을 쓰면 { series, roster } */
export async function eduFor(m) {
  if (!m || !m.seriesId) return null;
  const [x] = await run(db().from('attend_series').select('series_id, title, roster_key, summary_to').eq('series_id', m.seriesId).limit(1)).catch(() => []);
  if (!x || !x.roster_key) return null;
  const roster = await selectAll(() => db().from('edu_roster').select('nid, member_id, name, dept, region, position, sort_order').eq('roster_key', x.roster_key).order('sort_order'));
  if (!roster.length) return null;
  return { series: x, roster };
}

/** 사명자 한 명 → 방 열쇠(교역자 / 부서/지역 / '' = 방 없음) */
const personRoom = (p) => (p.dept === '교회교역' || p.dept === '신학교역' ? '교역자' : DEPTS.includes(p.dept) ? roomKeyOf(p.dept, p.region) : '');

async function prepare(m, phase, edu) {
  const { closingData } = await import('../actions/attendance-closing.js');
  const data = await closingData(m);
  const rows = data.rows.filter((r) => r.meetingId === m.meetingId && !r.dup);
  const order = [...new Set([...(m.slots || []).map((s) => slotName(s.start)), ...rows.map((r) => r.session)])];
  if (!order.length) order.push('오전', '저녁');
  const sessions = phase === '최종' ? order : [phase];
  const byNid = new Map();
  for (const r of rows) {
    if (!sessions.includes(r.session)) continue;
    const nid = normId(r.id);
    if (!byNid.has(nid)) byNid.set(nid, {});
    byNid.get(nid)[r.session] ||= r;
  }
  const people = edu.roster.map((p) => ({ ...p, key: personRoom(p), att: byNid.get(p.nid) || {} }));
  const inRoster = new Set(edu.roster.map((p) => p.nid));
  // 재적 밖 참석(교사·일반) — 교사면 등록 지역 방, 아니면 적은 부서
  const outside = [];
  for (const [nid, att] of byNid) {
    if (inRoster.has(nid)) continue;
    const r = Object.values(att)[0];
    const td = r.teacherDept || (/교역자|중진/.test(r.dept || '') ? '교역자' : '');
    outside.push({ name: r.name, key: td === '교역자' ? '교역자' : td ? roomKeyOf(td, r.region) : '', att });
  }
  return { people, outside, sessions, order };
}

/** 한 묶음 숫자 */
function statOf(list, sessions) {
  const st = { n: list.length, by: {}, came: 0, late: 0, absent: 0 };
  for (const s of sessions) st.by[s] = list.filter((p) => p.att[s]).length;
  for (const p of list) {
    const came = sessions.some((s) => p.att[s]);
    if (came) st.came++; else st.absent++;
    if (sessions.some((s) => isLate(p.att[s]))) st.late++;
  }
  return st;
}
const nameRows = (names, per = 5) => {
  const out = [];
  for (let i = 0; i < names.length; i += per) out.push('   ' + names.slice(i, i + per).join(' · '));
  return out;
};
const headLine = (phase, sessions) => (phase === '최종' ? (sessions.length > 1 ? `${sessions.map((s) => ICON[s] + ' ' + s).join(' · ')} 교육 마감 · 하루 통합` : '교육 마감') : `${ICON[phase] || '🙋'} ${phase} 교육 마감`);

/** 한 묶음(지역·교회 교역자·신학부)의 숫자 + 명단 줄 */
function sectionLines(label, list, outside, phase, sessions) {
  const st = statOf(list, sessions);
  const L = [`📍 <b>${esc(label)}</b> · 사명자 재적 ${st.n}명`, LINE];
  if (phase === '최종' && sessions.length > 1) {
    L.push(sessions.map((s) => `${ICON[s] || '🙋'} ${s} ${st.by[s]}명`).join(' · '));
    L.push(`👥 합계 <b>${st.came}명</b> / ${st.n}명 (${pct(st.came, st.n)})`);
  } else {
    L.push(`${ICON[sessions[0]] || '👥'} ${sessions[0]} 참석 <b>${st.came}명</b> / ${st.n}명 (${pct(st.came, st.n)})`);
  }
  L.push(`⏰ 지각 ${st.late}명 · ❌ ${phase === '최종' ? '불참' : '미참석'} ${st.absent}명`, LINE);
  for (const s of sessions) {
    const came = list.filter((p) => p.att[s]);
    L.push(`${ICON[s] || '🙋'} <b>${s} 참석자 ${came.length}명</b>`);
    if (came.length) L.push(...nameRows(came.map((p) => esc(p.name))));
    else L.push('   없음');
  }
  const late = list.filter((p) => sessions.some((s) => isLate(p.att[s])));
  if (late.length) {
    L.push(`⏰ <b>지각자 ${late.length}명</b>`);
    L.push(...nameRows(late.map((p) => esc(p.name) + '(' + sessions.filter((s) => isLate(p.att[s])).map((s) => (sessions.length > 1 ? s : '') + lateMin(p.att[s]) + '분').join('·') + ')'), 4));
  }
  const absent = list.filter((p) => !sessions.some((s) => p.att[s]));
  L.push(`❌ <b>${phase === '최종' ? '불참자' : sessions[0] + ' 미참석자'} ${absent.length}명</b>`);
  L.push(...(absent.length ? nameRows(absent.map((p) => esc(p.name))) : ['   없음 🎉']));
  if (outside.length) {
    L.push(`🙋 사명자 재적 밖 참석 ${outside.length}명 (참석률에 안 셈)`);
    L.push(...nameRows(outside.map((o) => esc(o.name))));
  }
  return L;
}
const top = (m, phase, sessions) => [`📋 <b>${esc(m.title)}</b> (사명자 재적 기준)`, `🗓 ${dayOf(m)} · ${headLine(phase, sessions)}`];

/** 표(지역·조직 × 숫자) 사진 + 요약 글 */
function board({ m, title, firstHead, groups, phase, sessions, theme, sumLabel }) {
  const T = BOARD_THEME[theme] || BOARD_THEME.yellow;
  const split = sessions.length > 1;
  const head = [firstHead, '인원', ...sessions, ...(split ? ['합계'] : []), '출석률', '지각', phase === '최종' ? '불참' : '미참석'];
  const cell = (v) => (v ? comma(v) : '-');
  const all = groups.flatMap(([, list]) => list);
  const row = (label, st) => [label, comma(st.n), ...sessions.map((s) => cell(st.by[s])), ...(split ? [cell(st.came)] : []), pct(st.came, st.n), cell(st.late), cell(st.absent)];
  const stats = groups.map(([label, list]) => [label, statOf(list, sessions)]);
  const sum = statOf(all, sessions);
  const rows = [...stats.map(([l, st]) => row(l, st)), row(sumLabel, sum)];
  const last = rows.length - 1, totalCol = 1 + sessions.length + (split ? 1 : 0);
  let png = null;
  try {
    png = tablePng({
      title, sub: `${m.title} · ${dayOf(m)} · ${headLine(phase, sessions)}`,
      foot: '※ 인원 = 사명자 재적(교사 재적 아님) · 출석률 = 참석 ÷ 인원 · 오전·저녁 두 번 온 분은 합계에 한 번',
      head, rows, align: ['left'], headColor: T.head, stripe: T.stripe,
      style: (r, c, v) => {
        if (r === last) return { fill: c ? T.sumFill : T.sumFill0, bold: true, color: T.sumText };
        if (v === '-') return { color: T.dash };
        if (c === 0) return { bold: true };
        if (c === totalCol) return { bold: true, color: T.sumCol };
        return null;
      },
    });
  } catch (e) { console.log('사명자 출석 표 이미지 오류: ' + e.message); }
  const caption = [`📊 <b>${esc(title)}</b> (사명자 재적 기준)`, `📌 ${esc(m.title)} · ${dayOf(m)} · ${headLine(phase, sessions)}`, '',
    `👥 인원 ${comma(sum.n)}명 · ${sessions.map((s) => `${ICON[s] || ''}${s} ${comma(sum.by[s])}`).join(' · ')}${split ? ` · 합계 <b>${comma(sum.came)}</b>` : ''} (${pct(sum.came, sum.n)})`,
    `⏰ 지각 ${sum.late}명 · ❌ ${phase === '최종' ? '불참' : '미참석'} ${comma(sum.absent)}명`].join('\n');
  const text = [caption, '', ...stats.map(([l, st]) => ` ▸ ${esc(l)} <b>${st.came}</b>/${st.n} (${pct(st.came, st.n)})${st.late ? ` · 지각 ${st.late}` : ''}`)].join('\n');
  return { png, caption, text };
}

const regionOrder = (k) => (/\/\d+지역$/.test(k) ? Number(k.replace(/\D/g, '')) : k.endsWith('/기타') ? 200 : k.endsWith('/새신자') ? 100 : 150);
function deptBoard(m, dept, P) {
  const keys = [...new Set(P.people.filter((p) => p.dept === dept).map((p) => p.key))].sort((a, b) => regionOrder(a) - regionOrder(b) || (a < b ? -1 : 1));
  return board({ m, title: `${dept} 지역별 사명자 출석`, firstHead: dept, theme: 'yellow', sumLabel: '합계', phase: P.phase, sessions: P.sessions,
    groups: keys.map((k) => [orgLabel(dept, regionShow(k.split('/')[1])), P.people.filter((p) => p.key === k)]) });
}
function orgBoard(m, P) {
  const groups = GROUPS.map((g) => [GROUP_LABEL[g] || g, P.people.filter((p) => p.dept === g)]).filter(([, l]) => l.length);
  return board({ m, title: '목사교 사명자 출석 현황', firstHead: '부서', theme: 'blue', sumLabel: '사명자 전체', phase: P.phase, sessions: P.sessions, groups });
}

/** 지각자·불참자 전체 명단(교육 방) — 부서 → 지역 */
function nameListTexts(m, P, kind) {
  const pick = kind === '지각' ? (p) => P.sessions.some((s) => isLate(p.att[s])) : (p) => !P.sessions.some((s) => p.att[s]);
  const label = kind === '지각' ? '⏰ 지각자 명단' : P.phase === '최종' ? '❌ 불참자 명단' : `❌ ${P.phase} 미참석자 명단`;
  const shown = (p) => esc(p.name) + (kind === '지각' ? '(' + P.sessions.filter((s) => isLate(p.att[s])).map((s) => (P.sessions.length > 1 ? s : '') + lateMin(p.att[s]) + '분').join('·') + ')' : '');
  const lines = [...top(m, P.phase, P.sessions), `${label} (사명자 재적 기준)`, ''];
  let total = 0;
  for (const g of GROUPS) {
    const list = P.people.filter((p) => p.dept === g && pick(p));
    if (!list.length) continue;
    total += list.length;
    lines.push(`🏢 <b>${GROUP_LABEL[g] || g}</b> ${list.length}명`);
    const regs = [...new Set(list.map((p) => p.region))];
    if (DEPTS.includes(g)) {
      regs.sort((a, b) => regionOrder(roomKeyOf(g, a)) - regionOrder(roomKeyOf(g, b)));
      for (const r of regs) lines.push(`  ▸ ${esc(regionShow(regionKey(r)))}: ${list.filter((p) => p.region === r).map(shown).join(', ')}`);
    } else lines.push('  ' + list.map(shown).join(', '));
    lines.push('');
  }
  lines.push(total ? `합계 ${total}명` : '없음 🎉');
  const parts = [];
  let cur = '';
  for (const l of lines) { if (cur && cur.length + l.length + 1 > 3900) { parts.push(cur); cur = ''; } cur += (cur ? '\n' : '') + l; }
  if (cur) parts.push(cur);
  return parts;
}

/** 보낼 것 목록 [{ room, text } | { room, png, caption, text }] */
export async function buildEduAttendance(m, phase, edu, { test = false, allRegions = false } = {}) {
  const P = { ...(await prepare(m, phase, edu)), phase };
  const rooms = await run(db().from('report_rooms').select('*').eq('active', true));
  const out = [], seen = new Set();
  const once = (k) => (seen.has(k) ? false : (seen.add(k), true));
  const eduKey = '#교육:' + edu.series.series_id;
  // 시험: 교육 방이 아직 연결 전이어도 보여 주고, 같은 표 사본(부서 총합 방·전체 방)은 한 번, 지역 방은 견본 3곳만
  if (test && !rooms.some((r) => r.dept === eduKey)) rooms.unshift({ dept: eduKey, chat_id: MY_TEST_CHAT, title: `${edu.series.title} 방(도우미연결에서 연결 전)` });
  let samples = 0;
  for (const room of rooms) {
    if (SKIP(room.dept) || topicPending(room)) continue;
    const chat = String(room.chat_id).split('/')[0];
    if (room.dept === eduKey) {   // 교육 방: 조직 파랑 표 + 부서 노랑 표 4장 + 지각자·불참자 명단
      if (!once('edu|' + chat)) continue;
      out.push({ room, ...orgBoard(m, P) });
      for (const d of DEPTS) if (P.people.some((p) => p.dept === d)) out.push({ room, ...deptBoard(m, d, P) });
      for (const t of nameListTexts(m, P, '지각')) out.push({ room, text: t });
      if (phase === '최종') for (const t of nameListTexts(m, P, '불참')) out.push({ room, text: t });
      continue;
    }
    if (room.dept.startsWith('#')) continue;
    const dept = room.dept.split('#')[0];
    if (dept === '교역자') {   // 교역자 방: 교회 교역자 / 신학부 교역자 따로 두 통
      if (!once('교역자|' + chat)) continue;
      const outside = P.outside.filter((o) => o.key === '교역자');
      for (const [g, label] of [['교회교역', '교회 교역자'], ['신학교역', '신학부 교역자 (센터 강사·센터 전도사·원장 등)']]) {
        const list = P.people.filter((p) => p.dept === g);
        if (list.length) out.push({ room, text: [...top(m, phase, P.sessions), ...sectionLines(label, list, g === '교회교역' ? outside : [], phase, P.sessions)].join('\n') });
      }
      continue;
    }
    if (room.dept.includes('#총합') || DEPTS.includes(room.dept)) {   // 부서 총합·전체 방: 지역별 노랑 표
      if (!DEPTS.includes(dept) || !once(dept + '|' + (test ? '' : chat))) continue;
      if (P.people.some((p) => p.dept === dept)) out.push({ room, ...deptBoard(m, dept, P) });
      continue;
    }
    const list = P.people.filter((p) => p.key === room.dept);   // 지역 방
    if (!list.length || (test && !allRegions && ++samples > 3)) continue;
    const [d, r] = room.dept.split('/');
    out.push({ room, text: [...top(m, phase, P.sessions), ...sectionLines(`${d} ${orgLabel(d, regionShow(r))}`, list, P.outside.filter((o) => o.key === room.dept), phase, P.sessions)].join('\n') });
  }
  return out;
}

/** 실제로 올림(방·모임·단계마다 한 번). summary_to='test' 면 시험 방으로만(어느 방 글인지 머리에). */
export async function postEduAttendance(m, phase, edu, prefix = '') {
  const test = edu.series.summary_to === 'test';
  const list = await buildEduAttendance(m, phase, edu, { test });
  const sent = [];
  const done = new Set();
  for (const p of list) {
    const { room } = p;
    const logRef = (test ? 'test:' : '') + `${room.dept}|${m.meetingId}`;
    if (!prefix && !done.has(logRef)) {
      const { error } = await db().from('cohort_summary_log').insert({ cohort_id: '#edu-att', kind: phase, ref_id: logRef, date: m.date, sent_at: kstDateTime() });
      if (error) continue;   // 이미 보냄
      done.add(logRef);
    }
    const to = test ? { ...room, chat_id: MY_TEST_CHAT } : room;
    const pre = prefix + (test ? `🧪 <b>[시험]</b> 실제로는 → ${esc(room.title || room.dept)} (${esc(room.dept)})\n` : '');
    try {
      if (p.caption) await sendRoomBoard(to, p.png, pre + p.caption, pre + p.text);
      else await sendRoomText(to.chat_id, pre + p.text);
      sent.push(room.dept);
    } catch (e) { console.log(`사명자 출석 서머리 실패 ${room.dept}: ${e.message}`); }
  }
  return sent;
}

// 11/12: 시험 발송 — DB에 재적을 넣기 전에도 엑셀 명단을 실어 보내 나만의 교사광장 방에서 미리 본다.
//   { action:'tsEduAttTest', key, meetingId, phase:'오전'|'최종', title?, roster:[{member_id,name,dept,region,position}] }
async function tsEduAttTest(body) {
  if (!process.env.TEACHERSQUARE_CRON_KEY || body.key !== process.env.TEACHERSQUARE_CRON_KEY) return { error: 'unauthorized' };
  const { findMeeting } = await import('../actions/attendance.js');
  const m = await findMeeting(String(body.meetingId || ''));
  if (!m) return { error: '모임 없음' };
  let edu = await eduFor(m);
  if (!edu) {
    const roster = (Array.isArray(body.roster) ? body.roster : []).map((p, i) => ({ ...p, nid: normId(p.member_id), sort_order: i }));
    if (!roster.length) return { error: '재적 없음' };
    edu = { series: { series_id: m.seriesId || 'PREVIEW', title: body.title || m.title }, roster };
  }
  edu = { ...edu, series: { ...edu.series, summary_to: 'test' } };
  const phase = String(body.phase || '오전');
  const list = await buildEduAttendance(m, phase, edu, { test: true, allRegions: body.all !== false });
  const sent = [];
  const skip = new Set(Array.isArray(body.skip) ? body.skip.map(String) : []);
  for (const p of list) {
    if (skip.has(p.room.dept)) continue;
    const pre = `🧪 <b>[시험]</b> 실제로는 → ${esc(p.room.title || p.room.dept)} (${esc(p.room.dept)})\n`;
    const to = { ...p.room, chat_id: MY_TEST_CHAT };
    try {
      if (p.caption) await sendRoomBoard(to, p.png, pre + p.caption, pre + p.text);
      else await sendRoomText(MY_TEST_CHAT, pre + p.text);
      sent.push([p.room.dept, '성공']);
    } catch (e) { sent.push([p.room.dept, '실패 ' + e.message]); }
  }
  return { ok: sent.every(([, r]) => r === '성공'), phase, sent };
}
export default { tsEduAttTest };
