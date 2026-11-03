// 11/3(사용자): 화요전도단 출석 — 오전·저녁 교육이 마감되면 지역 방·교역자 방·부서 총합 방마다 그 방 사람 출석 서머리.
//   교사는 명단에 등록된 지역(고른 지역이 아니라), 비교사는 적은 부서·지역 방으로. 저녁 마감 때 하루 총 참석 수.
import { db, run, selectAll } from './db.js';
import { kstDate, kstDateTime } from './util.js';
import { sendRoomText, topicPending, orgLabel } from './report-room.js';

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const ROOM_ATT_TITLES = [/화요\s*전도단/];
export const isRoomAttMeeting = (m) => !!m && !m.cohortId && ROOM_ATT_TITLES.some((re) => re.test(String(m.title || '')));
export const MORNING_POST = '10:30';   // 11/3(사용자): 오전 교육 끝나는 시각 = 오전 마감 서머리 시각(이때까지 온 '오전' 출석)
const DEPTS = ['자문회', '장년회', '부녀회', '청년회'];
const ALIAS = { '청년회/새신자': '청년회/기타' };
// '3지역'·'03지역' → '03지역'(방 열쇠 모양)
const regionKey = (r) => { const s = String(r || '').trim(); const m = s.match(/^0*(\d+)지역$/); return m ? m[1].padStart(2, '0') + '지역' : (s || '기타'); };
const roomKeyOf = (dept, region) => { const k = `${dept}/${regionKey(region)}`; return ALIAS[k] || k; };
const regionShow = (r) => { const m = String(r).match(/^0*(\d+)지역$/); return m ? Number(m[1]) + '지역' : r; };
// 회장단(부녀회/기타)은 '출결' 주제로 멤버 출결이 따로 가므로 여기선 뺀다. 활동현황 채널도 뺀다.
const SKIP = (dept) => dept === '*' || dept === '부녀회/기타' || dept.includes('#출결') || dept.includes(':활동현황') || dept.includes(':회장단') || DEPTS.includes(dept);

/** 그날 자료(closingData)를 방 열쇠별로: { key: { 오전:[row], 저녁:[row] } } — 중복·명단 못 찾은 줄은 뺀다. */
function groupRows(data) {
  const by = new Map();
  for (const r of data.rows) {
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

/** 지역 방(또는 교역자 방) 한 곳의 글. phase '오전' | '최종'. */
function roomText(m, key, sess, total, phase) {
  const am = sess['오전'] || [], pm = sess['저녁'] || [];
  const who = key === '교역자' ? '교역자' : `${key.split('/')[0]} ${orgLabel(key.split('/')[0], regionShow(key.split('/')[1]))}`;
  const day = m.date.slice(5).replace('-', '/');
  const lines = [`📋 <b>${esc(m.title)} — ${phase === '오전' ? '오전 교육 마감' : '저녁 교육 마감 · 총 참석'}</b> (${day})`, `📍 ${esc(who)}${total ? ` · 재적 ${total}명` : ''}`];
  if (phase === '오전') {
    lines.push(`✅ 오전 출석 <b>${am.length}명</b>`);
    if (am.length) lines.push('🙋 ' + am.map(nameOf).join(', '));
  } else {
    const all = uniq([...am, ...pm]);
    lines.push(`✅ 총 참석 <b>${all}명</b> (오전 ${am.length} · 저녁 ${pm.length}${am.length && pm.length ? ', 두 번 온 분은 한 번만' : ''})`);
    if (am.length) lines.push('🌅 오전: ' + am.map(nameOf).join(', '));
    if (pm.length) lines.push('🌙 저녁: ' + pm.map(nameOf).join(', '));
  }
  if (!am.length && !pm.length) lines.push('(출석한 분이 없어요)');
  return lines.join('\n');
}
/** 부서 총합 방의 글 — 지역별 줄. */
function wholeText(m, dept, by, counts, phase) {
  const keys = [...new Set([...counts.keys(), ...by.keys()])].filter((k) => k.startsWith(dept + '/'))
    .sort((a, b) => { const o = (k) => (k.endsWith('/기타') && dept === '부녀회' ? -1 : (/\/\d+지역$/.test(k) ? Number(k.replace(/\D/g, '')) : 100)); return o(a) - o(b) || (a < b ? -1 : 1); });
  const day = m.date.slice(5).replace('-', '/');
  let sum = 0;
  const rows = keys.map((k) => {
    const s = by.get(k) || {}; const am = s['오전'] || [], pm = s['저녁'] || [];
    const n = phase === '오전' ? am.length : uniq([...am, ...pm]);
    sum += n;
    const g = [...am, ...pm].filter((r) => r.guest).length;
    return `• ${esc(orgLabel(dept, regionShow(k.split('/')[1])))} <b>${n}</b>${counts.get(k) ? `/${counts.get(k)}` : ''}${phase !== '오전' && (am.length || pm.length) ? ` (오전 ${am.length}·저녁 ${pm.length})` : ''}${g ? ` · 비교사 ${g}` : ''}`;
  });
  return [`📋 <b>${esc(m.title)} — ${esc(dept)} ${phase === '오전' ? '오전 교육 마감' : '저녁 교육 마감 · 총 참석'}</b> (${day})`,
    `✅ ${phase === '오전' ? '오전 출석' : '총 참석'} <b>${sum}명</b> (지역: 출석/재적)`, ...rows].join('\n');
}

/** 보낼 방과 글 목록. */
export async function buildRoomAttendance(m, phase) {
  const { closingData } = await import('../actions/attendance-closing.js');
  const data = await closingData(m);
  if (phase === '오전') data.rows = data.rows.filter((r) => r.session === '오전');
  const by = groupRows(data);
  const counts = await rosterCounts();
  const rooms = await run(db().from('report_rooms').select('*').eq('active', true));
  const out = [], seenChat = new Set();
  for (const room of rooms) {
    if (SKIP(room.dept) || topicPending(room)) continue;
    let text = null;
    if (room.dept.includes('#총합')) {
      const dept = room.dept.split('#')[0];
      if (seenChat.has(dept + '|' + room.chat_id)) continue;
      seenChat.add(dept + '|' + room.chat_id);
      if (![...by.keys()].some((k) => k.startsWith(dept + '/'))) continue;   // 그 부서에서 아무도 안 왔으면 안 올림
      text = wholeText(m, dept, by, counts, phase);
    } else {
      if (!by.has(room.dept)) continue;   // 아무도 안 온 지역 방엔 글을 안 올림
      text = roomText(m, room.dept, by.get(room.dept) || {}, counts.get(room.dept) || 0, phase);
    }
    out.push({ room, text });
  }
  return out;
}

/** 실제로 올림(방·모임·단계마다 한 번). prefix 가 있으면 샘플(기록 안 남김). */
export async function postRoomAttendance(m, phase, prefix = '') {
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

/** 5분 주기(attAutoSummary)에서: 오늘 열린 화요전도단 모임이 오전 마감 시각을 지났으면 오전 서머리. */
export async function roomAttendanceMorningTick(meetings) {
  const now = kstDateTime().slice(11, 16);
  if (now < MORNING_POST) return [];
  const done = [];
  for (const m of meetings) {
    if (!isRoomAttMeeting(m) || m.date !== kstDate() || m.status === '삭제') continue;
    if ((m.end || '') <= MORNING_POST) continue;   // 오전에 끝나는 모임은 마감 때 최종 한 번만
    done.push(...(await postRoomAttendance(m, '오전')).map((d) => m.meetingId + ':' + d));
  }
  return done;
}
