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
import { workbookFiles } from './xlsx-multi.js';
import { zip } from './zip.js';
import { eduCardPng, REASONS } from './edu-card.js';

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const MY_TEST_CHAT = '-1004460094453';
const DEPTS = ['자문회', '장년회', '부녀회', '청년회'];
// 엑셀 오른쪽 집계 표 순서
const GROUPS = ['교회교역', '신학교역', '협력교회', '장로회', '자문회', '장년회', '부녀회', '청년회', '24부서'];
const GROUP_LABEL = { 교회교역: '교회 교역자', 신학교역: '신학부 교역자', 협력교회: '협력 교회', '24부서': '24부서' };
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
// 11/12(사용자): "교역자에서 이용우·김양주는 무조건 참석으로, 앞으로도 계속" — 지파장·지파총무. 모든 타임 정상 참석으로 센다.
const ALWAYS_PRESENT = ['00060830-00001', '00200202-00001'].map(normId);
const comma = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const groupOfKey = (key) => (key === '교역자' ? '교역자' : key.split('/')[0]);

/** 이 모임이 교육별 재적을 쓰면 { series, roster } */
export async function eduFor(m) {
  if (!m || !m.seriesId) return null;
  const [x] = await run(db().from('attend_series').select('series_id, title, roster_key, summary_to').eq('series_id', m.seriesId).limit(1)).catch(() => []);
  if (!x || !x.roster_key) return null;
  const roster = await selectAll(() => db().from('edu_roster').select('nid, member_id, name, dept, region, district, position, sort_order').eq('roster_key', x.roster_key).order('sort_order'));
  if (!roster.length) return null;
  return { series: x, roster };
}

/** 사명자 한 명 → 방 열쇠(교역자 / 부서/지역 / '' = 방 없음) */
// 11/12(사용자): 강지원·김강민 = 무진장·순창 사명자 → 오늘은 '협력 교회'로만 따로(나중에 정확히 정함, 추후 QR 따로)
const DEPT_OVERRIDE = Object.fromEntries([['00120521-00001', '협력교회'], ['00210620-00049', '협력교회']].map(([id, d]) => [normId(id), d]));
const personRoom = (p) => (p.dept === '교회교역' || p.dept === '신학교역' || p.dept === '협력교회' ? '교역자' : DEPTS.includes(p.dept) ? roomKeyOf(p.dept, p.region) : '');

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
  for (const nid of ALWAYS_PRESENT) {
    const att = byNid.get(nid) || {};
    for (const s of sessions) att[s] = { ...(att[s] || {}), late: '정상 출석' };
    byNid.set(nid, att);
  }
  // 11/12(사용자): 원장님들은 계수·참석·불참 명단에서 계속 뺀다(재적 밖 참석에도 안 나오게)
  const EXCLUDED = (p) => String(p.position || '').trim() === '원장';
  const people = edu.roster.filter((p) => !EXCLUDED(p)).map((p) => ({ ...p, dept: DEPT_OVERRIDE[p.nid] || p.dept })).map((p) => ({ ...p, key: personRoom(p), att: byNid.get(p.nid) || {} }));
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

// ── 집계 엑셀(11/12 사용자: "오전 집계 엑셀, 저녁 끝나면 오전·저녁 총합 집계 파일 — 매주 자동") ──
const XS = { plain: 0, head: 1, cell: 2, title: 3, session: 4, warn: 6, total: 7, text: 8 };
const xc = (v, st = XS.cell) => ({ v, s: st });
// 카드·총합 시트 줄(사용자 9/10 표 순서 + 교역자 둘을 맨 위에)
const CARD_ROWS = [['교회 교역자', ['교회교역']], ['신학부 교역자', ['신학교역']], ['협력 교회', ['협력교회']], ['24부서', ['24부서']], ['장로, 자문회', ['장로회', '자문회']], ['장년회', ['장년회']], ['부녀회', ['부녀회']], ['청년회', ['청년회']]];
/** 같은 정기 교육의 바로 앞 모임(지난주) 부서별 참석률 { label: 숫자% } — 없으면 null */
const ORG_DEFS = CARD_ROWS.map(([l, d]) => [l, (p) => d.includes(p.dept)]);
async function prevRates(m, edu, defs = ORG_DEFS) {
  if (!m.seriesId) return null;
  const [row] = await run(db().from('attend_meetings').select('meeting_id').eq('series_id', m.seriesId).lt('date', m.date).neq('status', '삭제').order('date', { ascending: false }).limit(1)).catch(() => []);
  if (!row) return null;
  const { findMeeting } = await import('../actions/attendance.js');
  const pm = await findMeeting(row.meeting_id);
  if (!pm) return null;
  const Q = await prepare(pm, '최종', edu);
  const out = {};
  for (const [label, fn] of [...defs, ['종합', null]]) {
    const l = fn ? Q.people.filter(fn) : Q.people.filter((p) => !defs.scope || defs.scope(p));
    const t = statOf(l, Q.sessions);
    out[label] = t.n ? (t.came / t.n) * 100 : null;
  }
  return out;
}
const pctNum = (a, b) => (b ? (a / b) * 100 : 0);
function cardData(m, P, prev, defs = ORG_DEFS, scope = null, head = '') {
  const one = (label, list) => {
    const t = statOf(list, P.sessions);
    const pv = prev && prev[label] != null ? prev[label].toFixed(1) + '%' : '-';
    return { label, n: t.n, came: t.came, rate: pct(t.came, t.n), prev: pv, absent: t.absent, absentRate: pct(t.absent, t.n), late: t.late, by: t.by, rateNum: pctNum(t.came, t.n), prevNum: prev ? prev[label] : null };
  };
  const all = scope ? P.people.filter(scope) : P.people;
  const rows = defs.map(([l, fn]) => one(l, all.filter(fn))).filter((r) => r.n);
  const total = one('종합', all);
  const [mo, d] = m.date.slice(5).split('-').map(Number);
  const title = `${mo}/${d} ${head}${m.title} ${P.phase === '최종' ? '' : P.phase + ' '}출석현황`;
  return { title, rows, total, reasonTotal: total.absent, firstHead: scope ? '지역' : '부서' };
}
/** 결론 줄(글자) */
function conclusion(C, P) {
  const T = C.total;
  const L = [];
  const diff = T.prevNum != null ? ` · 지난주 ${T.prevNum.toFixed(1)}% 대비 ${T.rateNum - T.prevNum >= 0 ? '▲' : '▼'}${Math.abs(T.rateNum - T.prevNum).toFixed(1)}%p` : '';
  L.push(`전체 참석률 ${T.rate} (대상 ${comma(T.n)}명 중 ${comma(T.came)}명 참석)${diff}`);
  if (P.sessions.length > 1) L.push(P.sessions.map((s) => `${s} ${comma(T.by[s])}명`).join(' · ') + ' (두 번 온 분은 한 번)');
  const sorted = [...C.rows].sort((a, b) => b.rateNum - a.rateNum);
  if (sorted.length > 1) L.push(`가장 높은 곳 ${sorted[0].label} ${sorted[0].rate} · 가장 낮은 곳 ${sorted.at(-1).label} ${sorted.at(-1).rate}`);
  const low = sorted.filter((r) => r.rateNum < 50).map((r) => r.label);
  if (low.length) L.push(`참석률 50% 아래: ${low.join(' · ')} — 집중 독려 필요`);
  L.push(`불참 ${comma(T.absent)}명(${T.absentRate}) · 지각 ${comma(T.late)}명 · 불참 사유는 아직 받지 않아 칸이 비어 있음`);
  return L;
}
function eduCard(m, P, C) {
  let png = null;
  try { png = eduCardPng(C); } catch (e) { console.log('출석현황 카드 오류: ' + e.message); }
  const caption = [`📊 <b>${esc(C.title)}</b> (사명자 재적 기준)`, '', ...conclusion(C, P).map((l) => '▸ ' + esc(l))].join(String.fromCharCode(10));
  const text = [caption, '', ...C.rows.map((r) => ` ▸ ${esc(r.label)} ${r.came}/${r.n} (${r.rate}) · 불참 ${r.absent}`)].join(String.fromCharCode(10));
  return { png, caption, text };
}

function eduExcel(m, P, C) {
  const both = P.sessions.length > 1;
  const kind = both ? '오전·저녁 총합' : P.sessions[0] + ' 집계';
  const title = `${m.date} ${m.title} ${kind} (사명자 재적 기준)`;
  // 11/12(사용자): 총합 시트 = 9/10 출석현황 표 서식 + 결론
  const H = (v) => xc(v, XS.head), E = () => xc('', XS.head);
  const rows1 = [[xc(C.title, XS.title)], [xc(`만든 시각 ${kstDateTime().slice(0, 16)} · 대상 = 사명자 재적(교사 재적 아님)`, XS.plain)],
    [H('부서'), H('대상'), H('참석'), H('참석률'), H('이전 참석률'), H('불참'), H('불참률'), H(`불참자 사유 (${C.reasonTotal}명)`), E(), E(), E()],
    [E(), E(), E(), E(), E(), E(), E(), ...REASONS.map(H)]];
  const cardRow = (r, st) => [xc(r.label, st), xc(r.n, st), xc(r.came, st), xc(r.rate, st), xc(r.prev, st), xc(r.absent, st), xc(r.absentRate, st), ...REASONS.map(() => xc('', st))];
  for (const r of C.rows) rows1.push(cardRow(r, XS.cell));
  rows1.push(cardRow(C.total, XS.total));
  if (both) {
    rows1.push([], [H('타임'), ...C.rows.map((r) => H(r.label)), H('종합')]);
    for (const x of P.sessions) rows1.push([xc(x, XS.session), ...C.rows.map((r) => xc(r.by[x])), xc(C.total.by[x], XS.total)]);
  }
  rows1.push([], [xc('결론', XS.title)], ...conclusion(C, P).map((l) => [xc('▸ ' + l, XS.text)]));
  const head = { length: 11 };
  // 명단(전원) — 결과: 참석/지각/불참
  const rows2 = [[xc(title + ' — 명단', XS.title)], [],
    ['번호', '부서', '지역', '이름', '고유번호', '직책', ...P.sessions.flatMap((x) => [x + ' 시각', x + ' 상태']), '결과'].map((h) => xc(h, XS.head))];
  P.people.forEach((p, i) => {
    const came = P.sessions.some((x) => p.att[x]), late = P.sessions.some((x) => isLate(p.att[x]));
    rows2.push([xc(i + 1), xc(GROUP_LABEL[p.dept] || p.dept), xc(regionShow(regionKey(p.region))), xc(p.name), xc(p.member_id), xc(p.position),
      ...P.sessions.flatMap((x) => [xc(p.att[x]?.at ? String(p.att[x].at).slice(11, 16) : ''), xc(p.att[x] ? p.att[x].late || '참석' : '', isLate(p.att[x]) ? XS.warn : XS.cell)]),
      xc(!came ? '불참' : late ? '지각' : '참석', !came || late ? XS.warn : XS.cell)]);
  });
  const rows3 = [[xc('사명자 재적 밖 참석(참석률에 안 셈)', XS.title)], [], ['번호', '이름', ...P.sessions.map((x) => x + ' 상태')].map((h) => xc(h, XS.head)),
    ...P.outside.map((o, i) => [xc(i + 1), xc(o.name), ...P.sessions.map((x) => xc(o.att[x] ? o.att[x].late || '참석' : ''))])];
  const n = head.length;
  const col = (k) => String.fromCharCode(64 + k);
  const sheets = [
    { name: '총합', rows: rows1, opts: { widths: [16, 9, 9, 10, 11, 9, 10, 9, 9, 9, 9], merges: ['A1:K1', 'A2:K2', 'H3:K3', ...'ABCDEFG'.split('').map((k) => `${k}3:${k}4`)], heights: { 0: 30 } } },
    { name: '명단', rows: rows2, opts: { widths: [6, 14, 9, 10, 17, 22, ...P.sessions.flatMap(() => [9, 11]), 8], freezeRow: 3, heights: { 0: 26 } } },
    { name: '재적 밖 참석', rows: rows3, opts: { widths: [6, 12, ...P.sessions.map(() => 12)] } },
  ];
  const fileName = `${m.title.replace(/[\/:*?"<>|]/g, ' ')}_${m.date}_${both ? '오전저녁총합' : P.sessions[0]}.xlsx`;
  const t = statOf(P.people, P.sessions);
  const docCaption = `📎 <b>${esc(m.title)} ${kind}</b> 엑셀
🗓 ${dayOf(m)} · 사명자 재적 ${comma(t.n)}명 · 참석 ${comma(t.came)}명 (${pct(t.came, t.n)}) · 지각 ${t.late} · ${P.phase === '최종' ? '불참' : '미참석'} ${t.absent}
시트: 총합(출석현황·결론) · 명단(전원, 참석/지각/불참) · 재적 밖 참석`;
  return { doc: zip(workbookFiles(sheets), fileName), fileName, docCaption };
}
async function sendRoomDoc(chat, bytes, fileName, caption) {
  const [id, th] = String(chat).split('/');
  let last = '';
  for (const token of [process.env.ATT_BOT_TOKEN, process.env.TEACHERSQUARE_BOT_TOKEN].filter(Boolean)) {
    const form = new FormData();
    form.set('chat_id', id);
    if (th) form.set('message_thread_id', th);
    form.set('caption', String(caption).slice(0, 1000));
    form.set('parse_mode', 'HTML');
    form.set('document', new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileName);
    const j = await (await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: 'POST', body: form })).json().catch((e) => ({ description: String(e) }));
    if (j.ok) return;
    last = j.description || '';
  }
  throw new Error('엑셀 전송 실패: ' + last);
}

function kyoTexts(m, phase, P) {
  const outside = P.outside.filter((o) => o.key === '교역자');
  return [['교회교역', '교회 교역자'], ['신학교역', '신학부 교역자 (센터 강사·센터 전도사 등)'], ['협력교회', '협력 교회 (무진장·순창)']]
    .map(([g, label]) => [label, P.people.filter((p) => p.dept === g), g === '교회교역' ? outside : []])
    .filter(([, list]) => list.length)
    .map(([label, list, out]) => [...top(m, phase, P.sessions), ...sectionLines(label, list, out, phase, P.sessions)].join(String.fromCharCode(10)));
}

// 11/12: 교육 방에 손으로 다시 올리기 { action:'tsEduAttSend', key, meetingId, phase, part?:'교역자' } — 기록(한 번만) 안 남김
async function tsEduAttSend(body) {
  if (!process.env.TEACHERSQUARE_CRON_KEY || body.key !== process.env.TEACHERSQUARE_CRON_KEY) return { error: 'unauthorized' };
  const { findMeeting } = await import('../actions/attendance.js');
  const m = await findMeeting(String(body.meetingId || ''));
  const edu = m && await eduFor(m);
  if (!edu) return { error: '재적이 걸린 정기 교육 모임이 아니에요' };
  const list = (await buildEduAttendance(m, String(body.phase || '오전'), edu, { eduOnly: true }))
    .filter((p) => !body.part || p.part === body.part);
  const sent = [];
  for (const p of list) {
    try {
      if (p.doc) await sendRoomDoc(p.room.chat_id, p.doc, p.fileName, p.docCaption);
      else if (p.caption) await sendRoomBoard(p.room, p.png, p.caption, p.text);
      else await sendRoomText(p.room.chat_id, p.text);
      sent.push('성공');
    } catch (e) { sent.push('실패 ' + e.message); }
  }
  return { ok: sent.every((x) => x === '성공'), sent };
}

// 11/12(사용자): 부서 대표 방(지역 없이 연결한 부서 전체 방) = 지역별 출석현황 카드 + 지역마다 참석자·지각자·불참자 글. 먼저 청년회.
const DEPT_ROOMS_ON = ['청년회'];
function deptDefs(P, dept) {
  const keys = [...new Set(P.people.filter((p) => p.dept === dept).map((p) => p.key))].sort((a, b) => regionOrder(a) - regionOrder(b) || (a < b ? -1 : 1));
  const defs = keys.map((k) => [orgLabel(dept, regionShow(k.split('/')[1])), (p) => p.key === k, k]);
  defs.scope = (p) => p.dept === dept;
  return defs;
}
async function deptParts(m, phase, P, edu, dept) {
  const defs = deptDefs(P, dept);
  const C = cardData(m, P, await prevRates(m, edu, defs).catch(() => null), defs, defs.scope, dept + ' ');
  const parts = [{ ...eduCard(m, P, C) }];
  for (const [label, fn, k] of defs) {
    parts.push({ text: [...top(m, phase, P.sessions), ...sectionLines(`${dept} ${label}`, P.people.filter(fn), P.outside.filter((o) => o.key === k), phase, P.sessions)].join(String.fromCharCode(10)) });
  }
  return parts;
}

/** 보낼 것 목록 [{ room, text } | { room, png, caption, text }] */
export async function buildEduAttendance(m, phase, edu, { test = false, allRegions = false, eduOnly = false } = {}) {
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
    if (room.dept === eduKey) {   // 11/12(사용자): 교육 방 = 집계 엑셀 + 목사교 사명자 출석 현황 표(부서 총합·교회 총합). 지역별은 안 올림
      if (!once('edu|' + chat)) continue;
      const C = cardData(m, P, await prevRates(m, edu).catch(() => null));
      out.push({ room, ...eduExcel(m, P, C) });
      out.push({ room, ...eduCard(m, P, C) });
      // 11/12(사용자): 교역자는 교육 방에도 교회 교역자 / 신학부 교역자 따로(참석자·지각자·불참자 명단)
      for (const t of kyoTexts(m, phase, P)) out.push({ room, text: t, part: '교역자' });
      continue;
    }
    if (eduOnly) {
      if (DEPT_ROOMS_ON.includes(room.dept) && once('dept|' + room.dept)) for (const x of await deptParts(m, phase, P, edu, room.dept)) out.push({ room, ...x, part: '부서' });
      continue;
    }
    if (room.dept.startsWith('#')) continue;
    const dept = room.dept.split('#')[0];
    if (dept === '교역자') {   // 교역자 방: 교회 교역자 / 신학부 교역자 따로 두 통
      if (!once('교역자|' + chat)) continue;
      const outside = P.outside.filter((o) => o.key === '교역자');
      for (const [g, label] of [['교회교역', '교회 교역자'], ['신학교역', '신학부 교역자 (센터 강사·센터 전도사 등)']]) {
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
  // summary_to: 'room' = 교육 방에만(11/12 사용자: 지역별은 필요 없어), 'live' = 교역자·부서·지역 방까지, 'test' = 시험 방
  const list = await buildEduAttendance(m, phase, edu, { test, eduOnly: edu.series.summary_to === 'room' });
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
      if (p.doc) await sendRoomDoc(to.chat_id, p.doc, p.fileName, pre + p.docCaption);
      else if (p.caption) await sendRoomBoard(to, p.png, pre + p.caption, pre + p.text);
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
      if (p.doc) await sendRoomDoc(to.chat_id, p.doc, p.fileName, pre + p.docCaption);
      else if (p.caption) await sendRoomBoard(to, p.png, pre + p.caption, pre + p.text);
      else await sendRoomText(MY_TEST_CHAT, pre + p.text);
      sent.push([p.room.dept, '성공']);
    } catch (e) { sent.push([p.room.dept, '실패 ' + e.message]); }
  }
  return { ok: sent.every(([, r]) => r === '성공'), phase, sent };
}
export default { tsEduAttTest, tsEduAttSend };
