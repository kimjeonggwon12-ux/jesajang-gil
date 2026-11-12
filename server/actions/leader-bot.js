// ── 사명자 서머리 (2026-11-12) ── 사용자: "-1003952888077 이 김정권·서강희·김논 방이야. 지금까지 텔레봇은 교자장부청 조직만 있었는데,
//   전체 사명자 1, 2, 3 등 여러 종을 만들어줘." → 이 방엔 기존 서머리 말고 사명자 서머리만(사용자 선택).
//   사명자 = 관리자 명단(admins, 133명: 중진·회장단·부장·지역장·교관…). 밤 10시 10분에 하루 한 번 세 통:
//   ① 직책별 활동 현황(오늘·이번 달 기록, 앱 입장, 명함)  ② 오늘 활동한 사명자 이름·항목  ③ 이번 달 기록 0건 사명자 명단
import { db, run, selectAll } from '../lib/db.js';
import { kstDate, kstDateTime } from '../lib/util.js';
import { esc } from '../lib/alerts.js';
import { fixActivityNids } from './roster.js';

export const LEADER_CHAT = '-1003952888077';
const MY_TEST_CHAT = '-1004460094453';
const GROUPS = [['중진', '🏛'], ['회장단·부장', '👑'], ['지역장', '📍'], ['교관', '🎓']];
const DEPT_ORDER = ['중진', '전도부', '교역자', '자문회', '장년회', '부녀회', '청년회'];
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const weekdayOf = (day) => WEEKDAYS[new Date(day + 'T12:00:00+09:00').getDay()];
const percent = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '0%');
const authorized = (body) => !!process.env.TEACHERSQUARE_CRON_KEY && body.key === process.env.TEACHERSQUARE_CRON_KEY;

/** 직책 → 묶음 */
function groupOf(a) {
  const pos = String(a.position || ''), dept = String(a.dept || '');
  if (dept === '중진' || pos === '중진') return '중진';
  if (pos.includes('교관')) return '교관';
  if (pos.includes('지역장')) return '지역장';
  return '회장단·부장';
}
const deptRank = (d) => { const i = DEPT_ORDER.indexOf(d); return i < 0 ? 99 : i; };
const byDeptName = (a, b) => deptRank(a.dept) - deptRank(b.dept) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const itemsOf = (a) => (a.activities || []).flatMap((s) => String(s).split(',')).map((s) => s.trim()).filter(Boolean);

async function leaderData(day) {
  const monthStart = day.slice(0, 8) + '01';
  const [admins, monthActs, cards, visits] = await Promise.all([
    run(db().from('admins').select('nid, name, dept, region, position').order('id')),
    selectAll(() => db().from('activities').select('nid, name, activities, submitted_at')
      .gte('submitted_at', `${monthStart} 00:00:00`).lte('submitted_at', `${day} 23:59:59`).order('id')),
    selectAll(() => db().from('connect_cards').select('id, nid').neq('member_id', '').order('id')),
    selectAll(() => db().from('app_visits').select('nid, visits').gt('visits', 0).order('nid')),
  ]);
  const acts = await fixActivityNids(monthActs);
  const seenNid = new Set();
  const leaders = admins.filter((a) => a.nid && !/^ZZTEST/i.test(a.name) && !seenNid.has(a.nid) && seenNid.add(a.nid))
    .map((a) => ({ ...a, name: String(a.name || '').trim(), dept: String(a.dept || '').trim(), group: groupOf(a), today: [], month: 0 }));
  const map = new Map(leaders.map((l) => [l.nid, l]));
  for (const a of acts) {
    const l = map.get(a.nid);
    if (!l) continue;
    l.month++;
    if (String(a.submitted_at).slice(0, 10) === day) l.today.push(a);
  }
  const card = new Set(cards.map((c) => c.nid)), seen = new Set(visits.map((v) => v.nid));
  for (const l of leaders) { l.card = card.has(l.nid); l.seen = seen.has(l.nid); }
  return leaders;
}

/** 오늘 것을 밤 10시 전에 보내면(손으로) 지금 시각 기준으로 적는다 */
const asOf = (day) => { const now = kstDateTime(); return now.slice(0, 10) === day && now.slice(11, 16) < '22:00' ? now.slice(11, 16) : '밤 10시'; };
const head = (n, title, desc, day) => [`📣 <b>사명자 서머리 ${n} ${title}</b>`, `📅 ${day} (${weekdayOf(day)}) ${asOf(day)} 기준`, `📖 ${desc}`, ''];

function composeOne(leaders, day) {
  const lines = head('①', '직책별 활동 현황', '사명자 전원을 직책별로 묶어 오늘·이번 달 활동 기록과 앱 입장·명함 등록을 비교해요.', day);
  const block = (label, icon, list) => {
    const n = list.length;
    const todayP = list.filter((l) => l.today.length).length, todayN = list.reduce((s, l) => s + l.today.length, 0);
    const monthP = list.filter((l) => l.month).length, monthN = list.reduce((s, l) => s + l.month, 0);
    return [`${icon} <b>${label}</b> ${n}명`,
      `   📝 오늘 기록 ${todayP}명 · ${todayN}건`,
      `   🗓 이번 달 기록 ${monthP}/${n}명 (${percent(monthP, n)}) · ${monthN}건`,
      `   📲 앱 입장 ${list.filter((l) => l.seen).length}/${n}명 · 🪪 명함 ${list.filter((l) => l.card).length}/${n}명`, ''];
  };
  for (const [g, icon] of GROUPS) { const list = leaders.filter((l) => l.group === g); if (list.length) lines.push(...block(g, icon, list)); }
  lines.push(...block('사명자 전체', '⛪', leaders));
  // 부서별 한 줄(이번 달 기록한 사명자 비율)
  const depts = [...new Set(leaders.map((l) => l.dept))].sort((a, b) => deptRank(a) - deptRank(b));
  lines.push('🏢 <b>부서별 이번 달 기록 사명자</b>');
  for (const d of depts) {
    const list = leaders.filter((l) => l.dept === d);
    const p = list.filter((l) => l.month).length;
    lines.push(`   ${esc(d)} ${p}/${list.length}명 (${percent(p, list.length)})`);
  }
  return lines;
}

function composeTwo(leaders, day) {
  const lines = head('②', '오늘 활동한 사명자', '오늘 활동을 기록한 사명자와 기록한 항목이에요. 서로 칭찬하고 응원해요.', day);
  let any = 0;
  for (const [g, icon] of GROUPS) {
    const list = leaders.filter((l) => l.group === g && l.today.length).sort((a, b) => b.today.length - a.today.length || byDeptName(a, b));
    if (!list.length) continue;
    lines.push(`${icon} <b>${g}</b> ${list.length}명`);
    for (const l of list) {
      const c = {};
      for (const a of l.today) for (const it of itemsOf(a).length ? itemsOf(a) : ['기록']) c[it] = (c[it] || 0) + 1;
      const items = Object.keys(c).sort((a, b) => c[b] - c[a]).map((it) => `${esc(it)} ${c[it]}`).join(', ');
      lines.push(`• <b>${esc(l.name)}</b> (${esc(l.dept)}·${esc(l.position || g)}) ${l.today.length}건 — ${items}`);
      any++;
    }
    lines.push('');
  }
  if (!any) lines.push('오늘 기록한 사명자가 아직 없어요.', '');
  lines.push(`✅ 오늘 기록 사명자 ${any}/${leaders.length}명`);
  return lines;
}

function composeThree(leaders, day) {
  const lines = head('③', '이번 달 기록 없는 사명자', `${Number(day.slice(5, 7))}월 1일부터 오늘까지 활동 기록이 한 건도 없는 사명자예요. 먼저 연락해 함께 시작해요.`, day);
  const idle = leaders.filter((l) => !l.month);
  for (const [g, icon] of GROUPS) {
    const list = idle.filter((l) => l.group === g).sort(byDeptName);
    if (!list.length) continue;
    lines.push(`${icon} <b>${g}</b> ${list.length}명`);
    const depts = [...new Set(list.map((l) => l.dept))];
    for (const d of depts) lines.push(`   ${esc(d)}: ${list.filter((l) => l.dept === d).map((l) => esc(l.name) + (l.seen ? '' : '📵')).join(', ')}`);
    lines.push('');
  }
  if (!idle.length) lines.push('🎉 이번 달 사명자 전원이 기록했어요!', '');
  else lines.push(`⚠️ 기록 없음 ${idle.length}/${leaders.length}명 · 📵 = 앱에 한 번도 들어오지 않음`);
  return lines;
}

/** 줄 목록 → 3900자 넘지 않게 나눈 글들 */
function split(lines) {
  const parts = [];
  let cur = '';
  for (const line of lines) {
    if (cur && cur.length + line.length + 1 > 3900) { parts.push(cur); cur = ''; }
    cur += (cur ? '\n' : '') + line;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

export async function composeLeader(day) {
  const leaders = await leaderData(day);
  return { count: leaders.length, parts: [composeOne, composeTwo, composeThree].map((f) => split(f(leaders, day))) };
}

/** 교사광장 봇으로, 안 되면 출석 봇으로(방에 들어가 있는 봇). */
async function sendTo(chat, text) {
  const tokens = [process.env.TEACHERSQUARE_BOT_TOKEN, process.env.ATT_BOT_TOKEN].filter(Boolean);
  let last = '';
  for (const token of tokens) {
    const j = await (await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: text.slice(0, 4096), parse_mode: 'HTML', link_preview_options: { is_disabled: true } }),
    })).json().catch((e) => ({ description: String(e) }));
    if (j.ok) return { ok: true };
    last = j.description || '';
  }
  return { ok: false, error: last };
}

/** 하루 한 번(cohort_summary_log '#leader-room'). force 면 다시, to:'test' 면 나만의 교사광장 시험 방으로. */
export async function sendLeaderSummary({ date, force, to } = {}) {
  const day = date || kstDate();
  const chat = to === 'test' ? MY_TEST_CHAT : LEADER_CHAT;
  const logged = !force && to !== 'test';
  if (logged) {
    const { error } = await db().from('cohort_summary_log').insert({ cohort_id: '#leader-room', kind: '사명자', ref_id: 'all', date: day, sent_at: kstDateTime() });
    if (error) return { skipped: true, date: day };
  }
  const r = await composeLeader(day);
  const sent = [];
  for (const [i, parts] of r.parts.entries()) for (const p of parts) sent.push([`사명자${i + 1}`, await sendTo(chat, p)]);
  const ok = sent.every(([, x]) => x.ok);
  if (!ok && logged) await db().from('cohort_summary_log').delete().eq('cohort_id', '#leader-room').eq('kind', '사명자').eq('ref_id', 'all').eq('date', day);
  return { ok, date: day, chat, leaders: r.count, sent: sent.map(([k, x]) => [k, x.ok ? '성공' : '실패 ' + x.error]) };
}

/** { action:'tsLeaderSummary', key, date?, force?, to?:'test', preview?:true } */
async function tsLeaderSummary(body) {
  if (!authorized(body)) return { error: 'unauthorized' };
  if (body.preview) { const r = await composeLeader(body.date || kstDate()); return { leaders: r.count, parts: r.parts.flat() }; }
  return sendLeaderSummary(body);
}

export default { tsLeaderSummary };
