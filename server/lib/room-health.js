// 11/5(사용자): "전체 텔레그램방 연결 현황 이상 유무 확인" — 글을 보내지 않고 텔레그램에 묻기만 한다(getMe·getChat·getChatMember).
//   보고방(report_rooms) · 교사광장 방(TEACHERSQUARE_CHAT_ID) · 출석 관리 방(ATT_ADMIN_CHAT) · 진행 중 교육 과정 방(cohorts.tg_chat)
//   + 명단에 있는데 지역 방이 없는 부서/지역.
import { db, run, selectAll } from './db.js';
import { loadRoster } from '../actions/roster.js';
import { regionRoomKey, topicPending } from './report-room.js';

const TS_ROOM = '@교사활동현황';
const api = async (token, method, body) => {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    return await r.json();
  } catch (e) { return { ok: false, description: e.message }; }
};
const me = {};
async function botId(token) {
  if (!me[token]) { const j = await api(token, 'getMe'); me[token] = j.ok ? j.result : { error: j.description }; }
  return me[token];
}

/** 방 하나: 있나·봇이 들어 있나·관리자인가·주제(토픽) 방이면 주제 번호가 있나. */
async function checkChat(rawChat, token, label) {
  const [id, th] = String(rawChat).split('/');
  const out = { label, chat: String(rawChat), ok: false, problems: [] };
  if (!token) { out.problems.push('봇 토큰 없음'); return out; }
  const bot = await botId(token);
  out.bot = bot.username || '';
  if (bot.error) { out.problems.push('봇 확인 실패: ' + bot.error); return out; }
  const c = await api(token, 'getChat', { chat_id: id });
  if (!c.ok) {
    const moved = c.parameters && c.parameters.migrate_to_chat_id;
    out.problems.push(moved ? `방 번호가 바뀜(슈퍼그룹) → ${moved}` : '방을 찾지 못함: ' + (c.description || ''));
    return out;
  }
  out.title = c.result.title || '';
  out.forum = !!c.result.is_forum;
  const m = await api(token, 'getChatMember', { chat_id: id, user_id: bot.id });
  out.status = m.ok ? m.result.status : '확인 실패';
  if (!m.ok) out.problems.push('봇 상태 확인 실패: ' + (m.description || ''));
  else if (['left', 'kicked'].includes(m.result.status)) out.problems.push('봇이 방에 없음(' + m.result.status + ')');
  else if (m.result.status === 'restricted' && m.result.can_send_messages === false) out.problems.push('봇이 글을 못 씀(제한)');
  if (out.forum && !th) out.notes = ['주제 방인데 주제 번호 없이 일반 주제로 보냄'];
  if (th) out.thread = Number(th);
  out.ok = !out.problems.length;
  return out;
}

export async function roomHealth() {
  const att = process.env.ATT_BOT_TOKEN || process.env.TEACHERSQUARE_BOT_TOKEN;
  const ts = process.env.TEACHERSQUARE_BOT_TOKEN;
  const [rooms, cohorts, roster] = await Promise.all([
    run(db().from('report_rooms').select('*').order('dept')),
    run(db().from('cohorts').select('id, title, tg_chat, status').eq('status', '진행')).catch(() => []),
    loadRoster(),
  ]);
  const checks = [];
  checks.push(await checkChat(process.env.TEACHERSQUARE_CHAT_ID, ts, '교사광장 방(서머리·알림)'));
  if (process.env.ATT_ADMIN_CHAT) checks.push(await checkChat(process.env.ATT_ADMIN_CHAT, att, '출석 관리 방(마감 엑셀)'));
  for (const r of rooms) {
    if (!r.active) { checks.push({ label: r.dept, chat: r.chat_id, ok: true, off: true, title: r.title, problems: [] }); continue; }
    const c = String(r.chat_id) === TS_ROOM ? await checkChat(process.env.TEACHERSQUARE_CHAT_ID, ts, r.dept) : await checkChat(r.chat_id, att, r.dept);
    c.saved = r.title;
    if (topicPending(r)) { c.problems.push('주제 번호를 아직 모름 — 그 주제에 글 1개 필요(그 전엔 안 보냄)'); c.ok = false; }
    checks.push(c);
  }
  for (const co of cohorts) if (co.tg_chat) checks.push({ ...(await checkChat(co.tg_chat, att, '교육 과정: ' + co.title)) });
  // 같은 방 번호를 여러 연결이 함께 쓰는지(의도일 수 있음)
  const byChat = {};
  for (const r of rooms.filter((x) => x.active)) (byChat[String(r.chat_id).split('/')[0]] ||= []).push(r.dept);
  const shared = Object.entries(byChat).filter(([, d]) => d.length > 1).map(([chat, depts]) => ({ chat, depts }));
  // 명단 지역인데 지역 방이 없는 곳(교사 수)
  const keys = new Set(rooms.filter((x) => x.active).map((x) => x.dept));
  const missing = {};
  for (const t of roster) {
    const k = regionRoomKey(t); if (!k) continue;
    const dept = k.split('/')[0];
    if (!['교역자', '자문회', '장년회', '부녀회', '청년회'].includes(dept)) continue;
    if (!keys.has(k)) missing[k] = (missing[k] || 0) + 1;
  }
  const deptHasWhole = (d) => keys.has(d);
  return {
    ok: checks.every((c) => c.ok),
    total: checks.length, bad: checks.filter((c) => !c.ok).length,
    checks, shared,
    missingRegions: Object.entries(missing).sort().map(([k, n]) => ({ room: k, teachers: n, wholeRoom: deptHasWhole(k.split('/')[0]) })),
  };
}
