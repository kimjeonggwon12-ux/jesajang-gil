// 11/3(사용자): 교육(출석 모임) 방별 출석 서머리 — 개설자가 걸어 놓은 타임 끝나는 시각마다(예: 오전 10:30, 저녁 21:00)
//   지역 방·교역자 방·부서 총합 방·부서 전체 방에 그 방 사람 출석. 마지막 타임 끝(=모임 끝) = 하루 총 참석.
//   교사는 명단에 등록된 지역(고른 지역이 아니라), 비교사는 적은 부서·지역 방으로. 교육 과정(cohort)·[TEST] 모임은 뺀다.
import { db, run, selectAll } from './db.js';
import { kstDate, kstDateTime } from './util.js';
import { sendRoomText, topicPending, orgLabel } from './report-room.js';

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const isRoomAttMeeting = (m) => !!m && !m.cohortId && !String(m.title || '').startsWith('[TEST]');
const DEPTS = ['자문회', '장년회', '부녀회', '청년회'];
const ALIAS = { '청년회/새신자': '청년회/기타' };
// '3지역'·'03지역' → '03지역'(방 열쇠 모양)
const regionKey = (r) => { const s = String(r || '').trim(); const m = s.match(/^0*(\d+)지역$/); return m ? m[1].padStart(2, '0') + '지역' : (s || '기타'); };
const roomKeyOf = (dept, region) => { const k = `${dept}/${regionKey(region)}`; return ALIAS[k] || k; };
const regionShow = (r) => { const m = String(r).match(/^0*(\d+)지역$/); return m ? Number(m[1]) + '지역' : r; };
// 회장단(부녀회/기타)은 '출결' 주제로 멤버 출결이 따로 가므로 여기선 뺀다. 활동현황 채널도 뺀다.
const SKIP = (dept) => dept === '*' || dept === '부녀회/기타' || dept.includes('#출결') || dept.includes(':활동현황') || dept.includes(':회장단');
const SESSION_ICON = { 오전: '🌅', 오후: '☀️', 저녁: '🌙' };
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
const nameOf = (r) => esc(r.name) + (r.guest ? '(비교사)' : '') + (/지각/.test(r.late || '') ? '(지각)' : '');
const uniq = (rows) => new Set(rows.map((r) => (r.guest ? 'g:' : '') + String(r.id).replace(/\D/g, '') + '|' + r.name)).size;
const allOf = (sess) => Object.values(sess).flat();
// 11/3(사용자): 글 맨 아래 정상 출석·지각 수(출석 건수 기준 — 오전·저녁 각각 센다)
const isLate = (r) => /지각/.test(r.late || '');
const lateLine = (list) => `⏰ 정상 출석 <b>${list.filter((r) => !isLate(r)).length}명</b> / 지각 <b>${list.filter(isLate).length}명</b>`;
const headOf = (phase) => (phase === '최종' ? '교육 마감 · 총 참석' : `${phase} 교육 마감`);
const splitText = (sess, order) => order.filter((s) => sess[s]?.length).map((s) => `${s} ${sess[s].length}`).join(' · ');

/** 지역 방(또는 교역자 방) 한 곳의 글. phase = 타임 이름('오전'…) 또는 '최종'. */
function roomText(m, key, sess, total, phase, order) {
  const who = key === '교역자' ? '교역자' : `${key.split('/')[0]} ${orgLabel(key.split('/')[0], regionShow(key.split('/')[1]))}`;
  const day = m.date.slice(5).replace('-', '/');
  const lines = [`📋 <b>${esc(m.title)} — ${headOf(phase)}</b> (${day})`, `📍 ${esc(who)}${total ? ` · 재적 ${total}명` : ''}`];
  if (phase !== '최종') {
    const list = sess[phase] || [];
    lines.push(`✅ ${phase} 출석 <b>${list.length}명</b>`);
    if (list.length) lines.push('🙋 ' + list.map(nameOf).join(', '));
  } else {
    const used = order.filter((s) => sess[s]?.length);
    lines.push(`✅ 총 참석 <b>${uniq(allOf(sess))}명</b>` + (used.length > 1 ? ` (${splitText(sess, order)}, 두 번 온 분은 한 번만)` : ''));
    for (const s of used) lines.push(`${SESSION_ICON[s] || '🙋'} ${s}: ` + sess[s].map(nameOf).join(', '));
  }
  lines.push(lateLine(phase === '최종' ? allOf(sess) : (sess[phase] || [])));
  return lines.join('\n');
}
/** 부서 총합 방·부서 전체 방의 글 — 지역별 줄(출석/재적). */
function wholeText(m, dept, by, counts, phase, order) {
  const keys = [...new Set([...counts.keys(), ...by.keys()])].filter((k) => k.startsWith(dept + '/'))
    .sort((a, b) => { const o = (k) => (k.endsWith('/기타') && dept === '부녀회' ? -1 : (/\/\d+지역$/.test(k) ? Number(k.replace(/\D/g, '')) : 100)); return o(a) - o(b) || (a < b ? -1 : 1); });
  const day = m.date.slice(5).replace('-', '/');
  let sum = 0, rosterSum = 0, guests = 0; const every = [];
  const lines = keys.map((k) => {
    const s = by.get(k) || {};
    const list = phase === '최종' ? allOf(s) : (s[phase] || []);
    const n = phase === '최종' ? uniq(list) : list.length;
    const g = list.filter((r) => r.guest).length;
    sum += n; guests += g; rosterSum += counts.get(k) || 0; every.push(...list);
    const split = phase === '최종' && order.filter((x) => s[x]?.length).length > 1 ? ` (${splitText(s, order)})` : '';
    return `• ${esc(orgLabel(dept, regionShow(k.split('/')[1])))} <b>${n}</b>${counts.get(k) ? `/${counts.get(k)}` : ''}${split}${g ? ` · 비교사 ${g}` : ''}`;
  });
  return [`📋 <b>${esc(m.title)} — ${esc(dept)} ${headOf(phase)}</b> (${day})`,
    `✅ ${phase === '최종' ? '총 참석' : phase + ' 출석'} <b>${sum}명</b> / 재적 ${rosterSum}명${guests ? ` (비교사 ${guests}명 포함)` : ''}`,
    '(지역: 출석/재적)', ...lines, lateLine(every)].join('\n');
}

/** 보낼 방과 글 목록. phase = 타임 이름 또는 '최종'. */
export async function buildRoomAttendance(m, phase) {
  const { closingData } = await import('../actions/attendance-closing.js');
  const data = await closingData(m);
  // 같은 날 다른 모임 출석은 섞지 않는다(이 모임 것만)
  const rows = data.rows.filter((r) => r.meetingId === m.meetingId && (phase === '최종' || r.session === phase));
  const order = [...new Set([...slotsOf(m).map((s) => s.name), '오전', '오후', '저녁', ...rows.map((r) => r.session)])];
  const by = groupRows(rows);
  const counts = await rosterCounts();
  const rooms = await run(db().from('report_rooms').select('*').eq('active', true));
  const out = [], seenChat = new Set();
  for (const room of rooms) {
    if (SKIP(room.dept) || topicPending(room)) continue;
    let text = null;
    const dept = room.dept.split('#')[0];
    if (room.dept.includes('#총합') || DEPTS.includes(room.dept)) {
      // 11/3(사용자): 부서 전체 방에도 총 취합 — 부서 전체 방과 총합 방이 같은 방이면 한 번만
      if (seenChat.has(dept + '|' + String(room.chat_id).split('/')[0])) continue;
      seenChat.add(dept + '|' + String(room.chat_id).split('/')[0]);
      if (![...by.keys()].some((k) => k.startsWith(dept + '/'))) continue;   // 그 부서에서 아무도 안 왔으면 안 올림
      text = wholeText(m, dept, by, counts, phase, order);
    } else {
      if (!by.has(room.dept)) continue;   // 아무도 안 온 지역 방엔 글을 안 올림
      text = roomText(m, room.dept, by.get(room.dept), counts.get(room.dept) || 0, phase, order);
    }
    out.push({ room, text });
  }
  return out;
}

/** 실제로 올림(방·모임·단계마다 한 번). prefix 가 있으면 샘플(기록 안 남김). */
export async function postRoomAttendance(m, phase, prefix = '') {
  if (!isRoomAttMeeting(m)) return [];
  const sent = [];
  for (const { room, text } of await buildRoomAttendance(m, phase)) {
    if (!prefix) {
      const { error } = await db().from('cohort_summary_log').insert({ cohort_id: '#room-att', kind: phase, ref_id: `${room.dept}|${m.meetingId}`, date: m.date, sent_at: kstDateTime() });
      if (error) continue;   // 이미 보냄
    }
    try { await sendRoomText(room.chat_id, prefix + text); sent.push(room.dept); }
    catch (e) { console.log(`방 출석 서머리 실패 ${room.dept}: ${e.message}`); }
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
