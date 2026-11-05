// 교사광장 봇의 정기 서머리: 아침 7시(교사 활동 현황: 명함·기록·입장·등급, 누적), 정오(오늘 오전 교자장부청 표), 저녁 10시(오늘 교자장부청 표), 밤 11시(오늘 활동, 부서별 이름)
// 11/5(사용자): 아침 7시 서머리(활동 글)를 전날 밤 11시에 올리고, 밤 11시 '교사 활동 현황 서머리'를 아침 7시로 — 서로 맞바꿈.
// 10/30(사용자): 활동 방엔 개별 실시간 알림은 올리지 않고(events.js INSTANT_ALERTS) 서머리 세 번만.
// 11/4(사용자): 정오·저녁 = 교자장부청 × 활동 항목 보라 표 사진 + 항목별 5개 조직 총합 글. 저녁 참여율 막대·등급 현황 글은 더 안 올림
//   (등급은 밤 11시 '교사 활동 현황 서머리'에 휴·활·정·우 채움 막대로).
import { db, run, selectAll } from '../lib/db.js';
import { normId, kstDate, kstDateTime, fmtTs } from '../lib/util.js';
import { sendAlert, alreadySent, logAlert, esc } from '../lib/alerts.js';
import { afterAction, onStageReached } from '../lib/events.js';
import { teachersByNid, rosterCounts, loadRoster, fixActivityNids, adminsAsTeachers } from './roster.js';
import { progressPng } from '../lib/progress-image.js';
import { boardTable, boardTotalLines, BOARD_COLS, boardLabel, countPairs } from '../lib/report-room.js';
import { askAiModels } from '../lib/gemini.js';
import { newsCardPng } from '../lib/news-card.js';

// 11/5(사용자): "서머리 다섯 개에 번호를 매기고 머릿말에 어떤 서머리인지 설명" — 하루 순서대로 ①~⑤
const SUMMARY_HEAD = {
  status: ['①', '☀️', '아침 7시 · 교사 활동 현황', '교자장부청별 명함 등록·활동 기록 참여·앱 입장(누적)과 교사 등급(휴·활·정·우)을 한눈에 보는 아침 점검표예요.'],
  noon: ['②', '🕛', '정오 · 오전 활동 총합', '오늘 0시~12시에 올라온 보고를 교자장부청 × 활동 항목 표로 합쳤어요. 오전에 어디가 먼저 움직였는지 봐요.'],
  dept: ['③', '📊', '밤 10시 · 부서 지역별 총합', '우리 부서 지역마다 오늘 보고를 활동 항목별로 합친 표예요. 지역끼리 나란히 비교해요.'],
  evening: ['④', '🌙', '밤 10시 · 하루 활동 총합', '오늘 하루 전체 보고를 교자장부청 × 활동 항목 표로 합쳤어요. 5개 조직의 하루를 비교해요.'],
  daily: ['⑤', '🌃', '밤 11시 · 오늘 활동한 교사', '오늘 활동을 기록한 교사 이름과 활동 내용을 부서별로 모았어요. 서로 칭찬하고 응원해요.'],
};
export const summaryHead = (k) => { const [n, icon, title, desc] = SUMMARY_HEAD[k]; return [`${icon} <b>서머리 ${n} ${title}</b>`, `📖 ${desc}`]; };

// [명단의 부서 이름, 알림에 쓰는 이름]
const DEPTS = [['교역자', '교역자회'], ['자문회', '자문회'], ['장년회', '장년회'], ['부녀회', '부녀회'], ['청년회', '청년회']];
const TIER_ICONS = [['휴교사', '🔴'], ['기타', '⚪'], ['활동교사', '🟡'], ['정교사', '🟢'], ['우수교사', '🏆']];
// 등급 채움 막대(왼쪽부터): 휴 = 붉은색 → 우수 = 금색('gold' = progress-image.js 의 금빛 그라데이션)
const TIER_STACK = [['휴교사', '휴', '#e5484d'], ['기타', '기타', '#a3a9b8'], ['활동교사', '활', '#f59e42'], ['정교사', '정', '#2f9e6e'], ['우수교사', '우수', 'gold']];
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

const comma = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const percent = (a, b) => (b ? Math.round((a / b) * 1000) / 10 + '%' : '0%');
const weekdayOf = (day) => WEEKDAYS[new Date(day + 'T12:00:00+09:00').getDay()];
const authorized = (body) => !!process.env.TEACHERSQUARE_CRON_KEY && body.key === process.env.TEACHERSQUARE_CRON_KEY;

// ── 자료 ──

/** from~to 날짜(포함)의 활동 기록. */
const activitiesBetween = (from, to) => selectAll(() => db().from('activities')
  .select('nid, name, submitted_at, activities, roles, target_name, target_stage')
  .gte('submitted_at', `${from} 00:00:00`).lte('submitted_at', `${to} 23:59:59`).order('id'));

/** 복음방을 진행한 (교사, 대상자) 쌍. */
function gospelPairs(activities, keyOf) {
  const pairs = new Set();
  for (const a of activities) {
    const target = a.target_name.trim();
    if (target && (a.activities.join(', ').includes('복음방') || a.target_stage === '복음방')) pairs.add(`${keyOf(a)}|${target}`);
  }
  return pairs;
}

/** from~to 사이에 센터에 인도된 사람 수: 단계가 센터수강으로 바뀐 대상자 + 센터인도실적. */
async function centerLeadCount(from, to) {
  const [history, leads] = await Promise.all([
    selectAll(() => db().from('target_history').select('target_id').eq('to_stage', '센터수강').neq('from_stage', '센터수강')
      .gte('changed_at', `${from} 00:00:00`).lte('changed_at', `${to} 23:59:59`).order('id')),
    selectAll(() => db().from('center_leads').select('nid, lead_name').gte('lead_date', from).lte('lead_date', to).order('id')),
  ]);
  return new Set([...history.map((h) => 'T|' + h.target_id), ...leads.map((l) => `C|${l.nid}|${l.lead_name}`)]).size;
}

// ── 아침 서머리 ──

/** "이름 🎯🏆  역할(항목 n건, …) / 역할(…)" */
function personLine(x) {
  const marks = (x.gospel ? ' 🎯' : '') + (x.center ? ' 🏆' : '');
  const roles = x.roleOrder.map((role) => {
    const counts = x.roles[role];
    const items = Object.keys(counts).filter((it) => counts[it] > 0)
      .sort((a, b) => counts[b] - counts[a] || (a < b ? -1 : 1))
      .map((it) => `${esc(it)} ${counts[it]}건`);
    return `${esc(role)}(${items.join(', ')})`;
  });
  return `<b>${esc(x.name)}</b>${marks}  ${roles.join(' / ')}`;
}

/** 그날 활동을 부서별·사람별로 묶은 글. 길면 여러 통으로 나눈다. */
async function composeDaily(day) {
  const [activities, center, cards] = await Promise.all([
    activitiesBetween(day, day), centerLeadCount(day, day),
    db().from('connect_cards').select('*', { count: 'exact', head: true }).neq('member_id', ''),
  ]);
  const byNid = await teachersByNid(activities.map((a) => a.nid));   // 그날 활동한 사람의 명단만
  const byDept = Object.fromEntries([...DEPTS.map(([dept]) => dept), '기타'].map((d) => [d, new Map()]));
  const people = new Set();
  const keyOf = (a) => a.nid || (byNid.get(a.nid)?.name || a.name || '이름미상');

  for (const a of activities) {
    const p = byNid.get(a.nid);
    const dept = p && byDept[p.dept] ? p.dept : '기타';
    const key = keyOf(a);
    if (!byDept[dept].has(key)) byDept[dept].set(key, { name: p?.name || a.name || '이름미상', n: 0, roles: {}, roleOrder: [], gospel: false, center: false });
    const person = byDept[dept].get(key);
    person.n++;
    const roles = a.roles.map((s) => s.trim()).filter(Boolean);
    const items = a.activities.flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean);
    for (const role of roles.length ? roles : ['기타']) {
      if (!person.roles[role]) { person.roles[role] = {}; person.roleOrder.push(role); }
      for (const item of items.length ? items : ['기록']) {
        person.roles[role][item] = (person.roles[role][item] || 0) + 1;
        if (item === '복음방') person.gospel = true;
        if (item === '센터소개' || item === '센터수강') person.center = true;
      }
    }
    people.add(key);
  }

  const lines = [...summaryHead('daily'), `📅 ${day} (${weekdayOf(day)}) 오늘 활동`, ''];
  const sections = byDept['기타'].size ? [...DEPTS, ['기타', '기타']] : DEPTS;
  for (const [dept, label] of sections) {
    const list = [...byDept[dept].values()].sort((a, b) => b.n - a.n || (a.name < b.name ? -1 : 1));
    lines.push(`🏢 <b>${label}</b>`);
    if (!list.length) lines.push('활동 없음 ⚠️');
    for (const person of list) lines.push(personLine(person));
    lines.push(`→ 합계 ${list.reduce((sum, x) => sum + x.n, 0)}건`, '');
  }
  lines.push(`📈 <b>전체</b>: ${activities.length}건 / ${people.size}명 참여`);
  lines.push(`🎯 <b>복음방 진행</b>: ${gospelPairs(activities, keyOf).size}명`);
  lines.push(`🏆 <b>센터 인도</b>: ${center}명`);
  lines.push(`🤝 <b>연결방 명함</b>: ${cards.count || 0}명`);

  const parts = [];
  let cur = '';
  for (const line of lines) {
    if (cur && cur.length + line.length + 1 > 3900) { parts.push(cur); cur = ''; }
    cur += (cur ? '\n' : '') + line;
  }
  if (cur) parts.push(cur);
  return { parts, total: activities.length };
}

/** 오늘(또는 지정한 날) 활동 서머리를 보낸다 — 11/5부터 밤 11시. 같은 날 것은 한 번만(force 면 다시, 중복 표시도 남기지 않는다). */
async function sendDailySummary({ date, force }) {
  try {
    const day = date || kstDate();
    const { parts, total } = await composeDaily(day);
    if (!force && await alreadySent('서머리|' + day)) return { ok: false, date: day, total, skipped: true };
    let ok = true;
    for (const [i, part] of parts.entries()) {
      const key = force ? '' : `서머리|${day}${i ? '|' + (i + 1) : ''}`;
      ok = (await sendAlert(part, '일일서머리', key)) && ok;
    }
    return { ok, date: day, total, messages: parts.length, skipped: false };
  } catch (err) {
    console.log('[교사광장 봇] 서머리 오류 ' + err);
    return { ok: false, error: String(err) };
  }
}

// ── 정오·저녁 교자장부청 서머리 (10/30 → 11/4 표 사진) ──
// 11/4(사용자): "정오 서머리도 같은 페이지(지역별 일일 보고 총합 표)로, 교자장부청 × 같은 항목으로, 교자장부청 토탈은 보라 계열.
//   저녁 10시도 Y축 교자장부청, 옆으로 교사광장 활동 항목(동행 복음방·식구 복음방·섭외 전단지 등)을 쭉 — 표로.
//   총합 글은 부서별로 나열하지 말고 항목만 5개 조직 합해서(예: 새찾기 00건)."
//   셈은 부서 지역별 총합(report-room.js boardTable)과 같다: 섭외자-인도자 한 쌍 = 1건, 섭외자 없는 기록은 한 건씩.
const BOARD_KIND = {
  noon: { head: summaryHead('noon').join('\n'), title: '교자장부청 오전 보고 총합', when: ' · 12시까지' },
  evening: { head: summaryHead('evening').join('\n'), title: '교자장부청 일일 보고 총합', when: '' },
};

/** 그날(지금까지) 기록 → 교자장부청 × 활동 항목 보라 표 사진 + 설명 글(항목별 5개 조직 총합, 한 줄에 하나). */
async function composeBoard(day, kind = 'evening') {
  const K = BOARD_KIND[kind] || BOARD_KIND.evening;
  const acts = await fixActivityNids(await selectAll(() => db().from('activities')
    .select('id, member_id, nid, name, activities, roles, target_name, report, submitted_at')
    .gte('submitted_at', `${day} 00:00:00`).lte('submitted_at', `${day} 23:59:59`).order('id')));
  const byNid = await teachersByNid(acts.map((a) => a.nid));
  const missing = [...new Set(acts.map((a) => a.nid).filter((n) => n && !byNid.has(n)))];
  for (const t of await adminsAsTeachers(missing)) byNid.set(t.nid, t);   // 관리자 명단에만 있는 분(회장 등)
  const byDept = new Map(DEPTS.map(([d]) => [d, []]));
  for (const a of acts) { const list = byDept.get(String(byNid.get(a.nid)?.dept || '').trim()); if (list) list.push(a); }
  const counted = [...byDept.values()].flat();
  const people = new Set(counted.map((a) => a.nid)).size;
  const [y, m, d] = day.split('-').map(Number);
  const { total, sum, png } = boardTable({
    title: K.title, theme: 'purple', firstHead: '부서', sumLabel: '5개 조직 총합',
    sub: `${y - 1983}.${m}.${d}.${weekdayOf(day)}요일${K.when} · 섭외자-인도자 한 쌍 = 1건 (섭외자 없는 기록은 한 건씩)`,
    groups: DEPTS.map(([dept, label]) => [label, byDept.get(dept)]),
  });
  const lines = boardTotalLines(total);
  const caption = [K.head, `📅 ${day} (${weekdayOf(day)})`, '',
    `👥 참여 ${comma(people)}명 · 기록 ${comma(counted.length)}건 · 합계 <b>${comma(sum)}건</b>`, '',
    '🧭 <b>항목별 총합</b> (교자장부청 5개 조직)',
    ...(lines.length ? lines : ['아직 기록 없음'])].join('\n');
  return { caption, text: caption, png, total: counted.length };
}

/** 표 사진 + 설명을 소통 방(TEACHERSQUARE_CHAT_ID)에. 사진을 못 보내면 글로. */
async function sendBoard(day, kind, key, logKind) {
  const r = await composeBoard(day, kind);
  let ok = r.png ? await sendChart(r.png, r.caption, key, logKind) : false;
  if (!ok) ok = await sendAlert(r.text, logKind, key);
  return { ok, date: day, total: r.total, photo: !!r.png };
}

/** 정오 서머리: 오늘 0시~지금(12시) 교자장부청. 같은 날 한 번만. */
async function sendNoonSummary({ date, force } = {}) {
  const day = date || kstDate();
  const key = force ? '' : 'noon_' + day;
  if (key && await alreadySent(key)) return { ok: false, date: day, skipped: true };
  return sendBoard(day, 'noon', key, '정오서머리');
}

// ── 밤 11시 현황 (10/30) ── 사용자: "교자장부청별 명함 등록·활동 기록 참여자·입장 1회 이상 — 몇 명 중 몇 명"
async function composeStatus(day, { picture = true } = {}) {
  const [roster, cards, acts, visits, tierCounts] = await Promise.all([
    loadRoster(),
    selectAll(() => db().from('connect_cards').select('id, nid').neq('member_id', '').order('id')),
    selectAll(() => db().from('activities').select('id, nid').order('id')),
    selectAll(() => db().from('app_visits').select('nid, visits').gt('visits', 0).order('nid')),
    rosterCounts(),
  ]);
  const card = new Set(cards.map((c) => c.nid)), act = new Set(acts.map((a) => a.nid)), seen = new Set(visits.map((v) => v.nid));
  const blank = () => ({ total: 0, card: 0, act: 0, seen: 0 });
  const stat = Object.fromEntries(DEPTS.map(([d]) => [d, blank()]));
  const all = blank();
  for (const t of roster) {
    const nid = normId(t.memberId);
    for (const s of [stat[String(t.dept || '').trim()], all].filter(Boolean)) {
      s.total++;
      if (card.has(nid)) s.card++;
      if (act.has(nid)) s.act++;
      if (seen.has(nid)) s.seen++;
    }
  }
  const cell = (n, total) => `${comma(n)} / ${comma(total)}명 (${percent(n, total)})`;
  const block = (label, s) => [`🏢 <b>${label}</b> (교사 ${comma(s.total)}명)`,
    `   🪪 명함 등록 ${cell(s.card, s.total)}`, `   📝 활동 기록 참여 ${cell(s.act, s.total)}`, `   📲 앱 입장 1회 이상 ${cell(s.seen, s.total)}`];
  const lines = [...summaryHead('status'), `📅 ${day} (${weekdayOf(day)}) 아침 7시 기준 · 누적`, ''];
  for (const [dept, label] of DEPTS) lines.push(...block(label, stat[dept]), '');
  lines.push(...block('⛪ 전주교회 전체', all).map((l, i) => (i ? l : l.replace('🏢 ', ''))));
  // 10/30(사용자): 옆으로 뻗는 채움 막대 사진(조직마다 막대 = 전체 인원, 채운 만큼 = 해당 인원) + 짧은 설명
  // 11/4(사용자): 등급(휴·활·정·우)을 4번째로 묶어 '교사 활동 현황 서머리' 4종 — 막대 전체 = 100%, 왼쪽부터 휴→활→정→우 채움
  const orgs = [...DEPTS.map(([d, label]) => [label, stat[d]]), ['전주교회 전체', all]];
  const tierOf = Object.fromEntries([...DEPTS.map(([d]) => d), '*'].map((d) => [d, {}]));
  for (const c of tierCounts) for (const k of [String(c.dept || '').trim(), '*']) if (tierOf[k]) tierOf[k][c.tier] = (tierOf[k][c.tier] || 0) + c.n;
  const tierRows = [...DEPTS.map(([d]) => tierOf[d]), tierOf['*']];
  let png = null;
  if (picture) try {
    png = progressPng({
      title: '교사 활동 현황 서머리', sub: `${day} (${weekdayOf(day)}) 아침 7시 기준 · 누적 · 막대 끝 = 그 조직 전체 교사`,
      labels: orgs.map(([l]) => l), totals: orgs.map(([, s]) => s.total), sumLabel: '전주교회 전체',
      panels: [
        { title: '명함 등록', color: '#00AE82', values: orgs.map(([, s]) => s.card) },
        { title: '활동 기록 참여', color: '#2F6BFF', values: orgs.map(([, s]) => s.act) },
        { title: '앱 입장 1회 이상', color: '#F08A00', values: orgs.map(([, s]) => s.seen) },
        { title: '교사 등급 (휴·활·정·우)', stack: TIER_STACK.map(([tier, short, color]) => ({ label: short, name: tier, color, values: tierRows.map((t) => t[tier] || 0) })) },
      ],
    });
  } catch (e) { console.log('[교사광장 봇] 참여 현황 그림 오류 ' + e); }
  const caption = [...summaryHead('status'), `📅 ${day} (${weekdayOf(day)}) 아침 7시 기준 · 누적`, '',
    ...orgs.map(([l, s]) => `${l === '전주교회 전체' ? '⛪' : '🏢'} <b>${l}</b> ${comma(s.total)}명 — 명함 ${comma(s.card)} · 기록 ${comma(s.act)} · 입장 ${comma(s.seen)}`)].join('\n');
  return { text: lines.join('\n'), caption, png, stat, all, tierOf };
}
async function sendStatusSummary({ date, force } = {}) {
  const day = date || kstDate();
  const key = force ? '' : 'status_' + day;
  if (key && await alreadySent(key)) return { ok: false, date: day, skipped: true };
  const r = await composeStatus(day);
  let ok = r.png ? await sendChart(r.png, r.caption, key, '참여현황') : false;
  if (!ok) ok = await sendAlert(r.text, '참여현황', key);   // 사진을 못 보내면 글로
  return { ok, date: day, photo: !!r.png };
}

/** 5분마다(attAutoSummary): 12시가 지나면 정오 서머리(오후 3시까지만 — 늦게 켜져도 밤에 '정오'가 나가지 않게), 22시 저녁 서머리, 23시 오늘 활동 서머리(11/5~, 예전 아침 7시 것). */
export async function summaryTick() {
  const hm = kstDateTime().slice(11, 16);
  const out = {};
  if (hm >= '12:00' && hm < '15:00') out.noon = await sendNoonSummary().catch((e) => ({ error: String(e) }));
  if (hm >= '22:00') out.evening = await sendEveningSummary({ tick: true }).catch((e) => ({ error: String(e) }));
  if (hm >= '23:00') out.daily = await sendDailySummary({ date: kstDate() }).catch((e) => ({ error: String(e) }));
  // 11/5(사용자): "한 줄 데이터 뉴스 — 매일 밤 10시 맨 마지막, 글만, 내일(11/6)부터" → 22시 표들(③·④)이 먼저 나가게 22:05부터, 하루 한 번
  if (hm >= '22:05' && hm < '23:00' && kstDate() >= NEWS_START) out.news = await sendNewsOneline({ date: kstDate() }).catch((e) => ({ error: String(e) }));
  return out;
}

// ── 저녁 서머리 ──

/** 그달 1일~그날: 부서별 참여율(설명 글 + 그래프 재료)과 등급 현황 글. */
async function composeEvening(day) {
  const monthStart = day.slice(0, 8) + '01';
  const [counts, activities, center] = await Promise.all([
    rosterCounts(), activitiesBetween(monthStart, day), centerLeadCount(monthStart, day),
  ]);
  const byNid = await teachersByNid(activities.map((a) => a.nid));   // 이번 달 활동한 사람의 명단만
  const stat = Object.fromEntries(DEPTS.map(([dept]) => [dept, { total: 0, tiers: {}, people: new Set(), acts: 0 }]));
  const allTiers = {};
  let teacherCount = 0;
  for (const c of counts) {   // 부서·등급별 인원은 DB 가 센 값
    teacherCount += c.n;
    allTiers[c.tier] = (allTiers[c.tier] || 0) + c.n;
    const s = stat[c.dept];
    if (!s) continue;
    s.total += c.n;
    s.tiers[c.tier] = (s.tiers[c.tier] || 0) + c.n;
  }
  for (const a of activities) {
    const s = stat[byNid.get(a.nid)?.dept];
    if (s) { s.people.add(a.nid); s.acts++; }
  }

  const month = Number(day.slice(5, 7));
  const caption = ['🌙 <b>저녁 10시 서머리</b> 🌙',
    `📅 ${Number(day.slice(0, 4))}년 ${month}월 ${Number(day.slice(8, 10))}일 (${weekdayOf(day)}) 기준`, '',
    `📊 <b>부서별 참여율</b> (${month}월, 참여 / 전체)`];
  const labels = [], totals = [], joined = [];
  for (const [dept, label] of DEPTS) {
    const n = stat[dept].people.size;
    labels.push(label); totals.push(stat[dept].total); joined.push(n);
    caption.push(`🏢 <b>${label}</b>  ${comma(n)} / ${comma(stat[dept].total)}명 (${percent(n, stat[dept].total)})`);
  }
  const allJoined = joined.reduce((a, b) => a + b, 0);
  const allTotal = totals.reduce((a, b) => a + b, 0);
  caption.push('', `📈 <b>전체 참여</b>  ${comma(allJoined)} / ${comma(allTotal)}명 (${percent(allJoined, allTotal)})`);

  const lines = [];
  const tierBlock = (title, total, counts) => {
    lines.push(`📋 <b>${title} 등급 현황</b> (전체 ${comma(total)}명)`);
    for (const [tier, icon] of TIER_ICONS) lines.push(`${icon} <b>${tier}</b>: ${comma(counts[tier] || 0)}명 (${percent(counts[tier] || 0, total)})`);
    lines.push('');
  };
  tierBlock('전주교회 교사', teacherCount, allTiers);
  for (const [dept, label] of DEPTS) tierBlock(label, stat[dept].total, stat[dept].tiers);
  const best = DEPTS.map(([dept, label]) => ({ name: label, n: stat[dept].acts })).reduce((b, d) => (d.n > 0 && (!b || d.n > b.n) ? d : b), null);
  lines.push(`🎯 <b>이번 달 복음방 진행</b>: ${gospelPairs(activities, (a) => a.nid).size}명`);
  lines.push(`🏅 <b>이번 달 센터 인도</b>: ${center}명`);
  lines.push(`🏆 <b>가장 활발한 부서</b>: ${best ? `${best.name} (${comma(best.n)}건)` : '없음'}`);
  return { caption: caption.join('\n'), tiers: lines.join('\n'), labels, totals, joined, month };
}

// 11/4: 저녁 참여율 막대그래프(participationChart·textBars)는 지움 — 사용자: "일반 참여율이니 삭제하고 앞으론 올리지 마"

/** 그래프 사진 + 설명을 보낸다. 같은 중복키로 이미 보냈으면 다시 보내지 않는다. */
async function sendChart(png, caption, dedupKey, kind = '저녁서머리') {
  try {
    if (await alreadySent(dedupKey)) return true;
    if (!process.env.TEACHERSQUARE_BOT_TOKEN || !process.env.TEACHERSQUARE_CHAT_ID) return false;
    const form = new FormData();
    form.set('chat_id', process.env.TEACHERSQUARE_CHAT_ID);
    form.set('caption', caption.slice(0, 1024));
    form.set('parse_mode', 'HTML');
    form.set('photo', new Blob([png], { type: 'image/png' }), 'participation.png');
    const r = await fetch(`https://api.telegram.org/bot${process.env.TEACHERSQUARE_BOT_TOKEN}/sendPhoto`, { method: 'POST', body: form });
    if (!r.ok) console.log(`[교사광장 봇] 사진 전송 실패 ${r.status} ${(await r.text()).slice(0, 300)}`);
    await logAlert(kind, '[그래프] ' + caption, r.ok, dedupKey);
    return r.ok;
  } catch (e) {
    console.log('[교사광장 봇] 사진 전송 오류 ' + e);
    return false;
  }
}

/** 저녁 서머리: 오늘 하루 교자장부청 × 활동 항목 표(11/4부터 한 통). */
async function sendEveningSummary({ date, force, tick }) {
  try {
    // 10/30: 22시로 옮김 — 21시에 도는 옛 예약(ts-evening-summary)은 건너뛰고 5분 틱(summaryTick)이 22시에 보낸다
    if (!tick && !date && !force && kstDateTime().slice(11, 16) < '22:00') return { ok: false, skipped: true, reason: '22시 전' };
    const day = date || kstDate();
    const dedupKey = 'evening_' + day;
    if (!force && await alreadySent(dedupKey + '|0')) return { ok: false, date: day, skipped: true };
    // 11/4(사용자): 교자장부청 × 활동 항목 보라 표 한 통만. 참여율 막대그래프(일반 참여율)·등급 현황 글은 더 안 올림
    const r = await sendBoard(day, 'evening', force ? '' : dedupKey + '|0', '저녁서머리');
    return { ...r, skipped: false };
  } catch (err) {
    console.log('[교사광장 봇] 저녁 서머리 오류 ' + err);
    return { ok: false, error: String(err) };
  }
}

const NEWS_START = '2026-11-06';
const NEWS_INTRO = ['🔴오늘 하루에 올라온 데이터를 한 줄로 요약한', '한 줄 데이터 뉴스입니다.', '읽어보시고, 오늘 하루 올라온 데이터를 이해하실 수 있습니다.'];
// ── 📰 교사광장 전도 뉴스 (2026-11-05) ── 사용자: "다섯 개 서머리의 부서별 특징을 그날그날 — 전도 뉴스처럼. 아침 7시에 전날 것이,
//   뉴스처럼 느껴지게." 전날 기록을 부서별 숫자로 모으고(오전·하루·지역·항목·교사·첫 기록·누적 현황) AI가 기사로 쓴다.
//   AI에는 숫자와 교사 이름만 보낸다(섭외자 이름·연락처는 보내지 않음). AI가 안 되면 숫자 기사(newsPlain)로.
const NEWS_MODELS = ['gemini-3.5-flash', 'gemini-3.8-flash'];
const dayBefore = (d) => kstDate(new Date(new Date(d + 'T12:00:00+09:00').getTime() - 24 * 3600 * 1000));
const actsOn = async (day) => fixActivityNids(await selectAll(() => db().from('activities')
  .select('id, member_id, nid, name, activities, roles, target_name, submitted_at')
  .gte('submitted_at', `${day} 00:00:00`).lte('submitted_at', `${day} 23:59:59`).order('id')));

async function newsFacts(day) {
  const prev = dayBefore(day);
  const [acts, prevActs, status, earlier, roster] = await Promise.all([
    actsOn(day), actsOn(prev), composeStatus(kstDate(), { picture: false }),
    selectAll(() => db().from('activities').select('id, nid').lt('submitted_at', `${day} 00:00:00`).order('id')),
    loadRoster(),
  ]);
  const nids = [...new Set([...acts, ...prevActs].map((a) => a.nid).filter(Boolean))];
  const byNid = await teachersByNid(nids);
  for (const t of await adminsAsTeachers(nids.filter((n) => !byNid.has(n)))) byNid.set(t.nid, t);
  const before = new Set(earlier.map((a) => a.nid));
  const deptOf = (a) => String(byNid.get(a.nid)?.dept || '').trim();
  const itemsOf = (list) => BOARD_COLS.map((c) => [boardLabel(c), countPairs(list, c[2])]).filter(([, n]) => n).sort((a, b) => b[1] - a[1]);
  const depts = DEPTS.map(([dept, label]) => {
    const list = acts.filter((a) => deptOf(a) === dept);
    const morning = list.filter((a) => String(a.submitted_at).slice(11, 13) < '12');
    const regions = new Map(), people = new Map();
    for (const a of list) {
      const t = byNid.get(a.nid) || {};
      const rg = String(t.region || '').trim() || '기타';
      regions.set(rg, (regions.get(rg) || 0) + 1);
      const nm = t.name || a.name || '';
      if (nm) people.set(nm, (people.get(nm) || 0) + 1);
    }
    const st = status.stat[dept] || { total: 0, card: 0, act: 0, seen: 0 };
    const tiers = status.tierOf[dept] || {};
    // 11/5 5차(사용자): "부서별로 아직 부족한 부분에 포커스, 부서끼리 차이를 잘 짚게" — 부족 지표
    const allRegions = [...new Set(roster.filter((t) => String(t.dept || '').trim() === dept).map((t) => String(t.region || '').trim()).filter(Boolean))].sort();
    const silentRegions = allRegions.filter((r) => !regions.has(r));
    const zeroCore = NEWS_CORE.filter((c) => !countPairs(list, c[2])).map((c) => boardLabel(c));
    return {
      dayRate: st.total ? people.size / st.total : 0, allRegions: allRegions.length, silentRegions, zeroCore,
      label, records: list.length, prevRecords: prevActs.filter((a) => deptOf(a) === dept).length,
      teachers: people.size, morningRecords: morning.length, morningItems: itemsOf(morning).slice(0, 3),
      items: itemsOf(list).slice(0, 5),
      topRegions: [...regions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3), regionsActive: regions.size,
      topTeachers: [...people.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
      firstTimers: [...new Set(list.filter((a) => a.nid && !before.has(a.nid)).map((a) => byNid.get(a.nid)?.name || a.name).filter(Boolean))].slice(0, 5),
      gospel: countPairs(list, ['복음방']), center: countPairs(list, ['센터소개', '센터수강']),
      status: { total: st.total, card: st.card, act: st.act, seen: st.seen, tiers },
    };
  });
  // 5개 부서 중 순위(1 = 가장 높음)
  const rankBy = (key, val) => { const sorted = [...depts].sort((a, b) => val(b) - val(a)); depts.forEach((d) => { d.rank = d.rank || {}; d.rank[key] = sorted.indexOf(d) + 1; }); };
  rankBy('day', (d) => d.dayRate);
  rankBy('card', (d) => (d.status.total ? d.status.card / d.status.total : 0));
  rankBy('seen', (d) => (d.status.total ? d.status.seen / d.status.total : 0));
  rankBy('act', (d) => (d.status.total ? d.status.act / d.status.total : 0));
  const sum = (k) => depts.reduce((n, d) => n + d[k], 0);
  return { day, prev, depts, total: { records: sum('records'), prevRecords: sum('prevRecords'), teachers: sum('teachers'), morning: sum('morningRecords'), gospel: sum('gospel'), center: sum('center') }, items: itemsOf(acts.filter((a) => DEPTS.some(([d]) => d === deptOf(a)))).slice(0, 5) };
}

const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '-');
// 단계 진행 핵심 항목(BOARD_COLS 이름) — 부서에서 0건이면 '빈 단계'로 짚는다
const NEWS_CORE = BOARD_COLS.filter((c) => ['섭외찾기(전단지)', '만남', '상담1', '상담2', '복음방', '센터수강생관리'].includes(boardLabel(c)));
function factsText(F) {
  const kv = (arr, unit = '건') => arr.map(([k, n]) => `${k} ${n}${unit}`).join(', ') || '없음';
  return [
    `날짜: ${F.day} (${weekdayOf(F.day)}) / 비교: 그 전날 ${F.prev}`,
    `전체: 기록 ${F.total.records}건(전날 ${F.total.prevRecords}건), 활동 교사 ${F.total.teachers}명, 오전(12시 전) 기록 ${F.total.morning}건, 복음방 ${F.total.gospel}건, 센터 소개·수강 ${F.total.center}건`,
    `전체 많은 활동 항목: ${kv(F.items)}`,
    `5개 부서 어제 참여율(활동 교사/전체 교사): ${F.depts.map((d) => `${d.label} ${pct(d.teachers, d.status.total)}`).join(', ')}`,
    ...F.depts.map((d) => [
      `[${d.label}] 기록 ${d.records}건(전날 ${d.prevRecords}건) · 활동 교사 ${d.teachers}명 · 보고한 지역 ${d.regionsActive}곳`,
      `  ② 정오까지(오전): ${d.morningRecords}건 — ${kv(d.morningItems)}`,
      `  ④ 하루 항목: ${kv(d.items)} / 복음방 ${d.gospel}건 · 센터 ${d.center}건`,
      `  ③ 지역: ${kv(d.topRegions)}`,
      `  ⑤ 많이 기록한 교사: ${kv(d.topTeachers)}${d.firstTimers.length ? ` / 처음 기록한 교사: ${d.firstTimers.join(', ')}` : ''}`,
      `  ★ 부족·차이 지표: 어제 참여율 ${d.teachers}/${d.status.total}명(${pct(d.teachers, d.status.total)}, 5개 부서 중 ${d.rank.day}위) · 보고 없는 지역 ${d.silentRegions.length}/${d.allRegions}곳${d.silentRegions.length ? `(${d.silentRegions.slice(0, 6).join(', ')}${d.silentRegions.length > 6 ? ' 외' : ''})` : ''} · 0건인 핵심 단계: ${d.zeroCore.join(', ') || '없음'} · 오전 비중 ${pct(d.morningRecords, d.records)} · 명함 등록률 ${d.rank.card}위 · 기록 참여(누적) ${d.rank.act}위 · 앱 입장률 ${d.rank.seen}위 · 휴교사 비율 ${pct(d.status.tiers['휴교사'] || 0, d.status.total)}`,
      `  ① 누적 현황: 교사 ${d.status.total}명 중 명함 ${d.status.card}(${pct(d.status.card, d.status.total)}) · 기록 참여 ${d.status.act}(${pct(d.status.act, d.status.total)}) · 앱 입장 ${d.status.seen}(${pct(d.status.seen, d.status.total)}) · 등급 ${TIER_STACK.map(([t, sh]) => `${sh} ${d.status.tiers[t] || 0}`).join(' ')}`,
    ].join('\n')),
  ].join('\n');
}

/** 숫자만으로 쓴 기사(AI가 안 될 때). */
function newsPlain(F) {
  const up = (a, b) => (a > b ? `▲${a - b}` : a < b ? `▼${b - a}` : '전날과 같음');
  const lines = [`🔴 <b>어제 ${F.total.records}건 · 교사 ${F.total.teachers}명</b> (${up(F.total.records, F.total.prevRecords)})`];
  for (const d of F.depts) {
    lines.push(`🏢 ${d.label} · ${d.records ? `${d.records}건 (${up(d.records, d.prevRecords)})${d.items[0] ? `, ${esc(d.items[0][0])} ${d.items[0][1]}건` : ''}` : '기록 없음'}`);
  }
  return lines.join('\n');
}

/** 마크다운(**굵게**) 조금 → 텔레그램 HTML. */
const mdToTg = (t) => esc(String(t).replace(/^#+\s*/gm, '').replace(/\r/g, '')).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^\s*[-*]\s+/gm, '• ').replace(/\n{3,}/g, '\n\n').trim();

// 11/5(사용자): "교자장부청 한 줄 뉴스 — 소속을 굵게, ● 기호를 앞에, '한 줄 데이터 뉴스'라고" → opts.oneline
//   opts.today: 그날 저녁에 그날 것('어제' 대신 '오늘')
export async function composeNews(day, opts = {}) {
  const F = await newsFacts(day);
  const md = `${Number(day.slice(5, 7))}월 ${Number(day.slice(8, 10))}일(${weekdayOf(day)})`;
  const head = ['📰 <b>교사광장 전도 뉴스</b>', `🗞 ${md} · 헤드라인`, ''];
  // 11/5 2차(사용자): "활기차게·힘을 보탰다 같은 기사 문체는 줄이고 헤드라인 뉴스처럼 포인트만, 내용은 1/4로 — 실제 기사를 쓸 필요는 없다"
  const prompt = [
    '아래 어제 하루 데이터(교사광장 서머리 ①~⑤)로 "헤드라인 뉴스"를 만드세요. 기사 본문은 쓰지 않습니다. 화면 아래 자막처럼 한 줄 포인트만.',
    '',
    '[데이터]', factsText(F), '',
    '[규칙]',
    // 11/5 3차(사용자): "부서마다 간단한 특징을 읽어 주도록 — 숫자만은 의미가 없다. 건조한 뉴스체, 다정한 것 말고, 간단하게, 팩트만"
    // 11/5 5차(사용자): "부서별 특징이 아직 부족한 부분에 포커스를 맞춰서, 부서별로 차이를 잘 짚어 주고"
    '- 부서 줄 = 그 부서가 지금 가장 부족한 점 하나 + 다른 부서와의 차이. ★ 부족·차이 지표(어제 참여율과 순위, 보고 없는 지역, 0건인 핵심 단계, 오전 비중, 누적 순위, 휴교사 비율)에서 그 부서에 가장 큰 빈 곳을 골라 근거 숫자 1~2개로.',
    '- 다섯 부서가 같은 말(예: 모두 "감소")이 되지 않게, 부서마다 서로 다른 부족한 점을 고르고 순위·다른 부서 수치와 나란히 비교하세요(예: "5개 부서 중 최저", "부녀회 13% 대비 2%").',
    '- 잘한 점만 쓰지 말 것. 기록이 많은 부서도 빈 지역·빈 단계·낮은 참여율 같은 부족한 점을 짚으세요.',
    '  예: "부녀회 · 기록 최다지만 참여율 13%, 보고 없는 지역 5곳" / "청년회 · 복음방·상담2 0건, 피드백에 기록 편중" / "자문회 · 이틀째 0건, 명함 등록률 5개 부서 중 최하위" / "장년회 · 참여율 2%로 5개 부서 중 최저"',
    '- 건조한 뉴스 자막체. 한 줄 20~45자, 명사형으로 끝내기. "~했습니다/~했어요"·인사·감탄 금지.',
    '- 팩트만: 해석은 데이터로 바로 확인되는 것까지만(원인 추측·평가·칭찬·응원·당부 금지). 꾸밈말(활기차게, 힘을 보탰다, 뜨거운, 빛났다, 돋보였다, 눈부신) 금지.',
    '- 데이터에 있는 숫자·이름만. 전날 비교는 ▲/▼. 섭외자 이야기 금지. 교사 이름은 쓰지 않음(첫 기록 인원 수는 가능).',
    '- 아래 형식 그대로, 다른 줄·제목 없이. 전체 500자 안쪽. 굵게(**두 별표**)는 🔴 줄에만.',
    '🔴 (어제 부서 간 가장 큰 차이 또는 전체의 가장 큰 빈 곳 한 줄)',
    '⛪ 교역자회 · (부족한 점 + 차이 한 줄)',
    '🌿 자문회 · (부족한 점 + 차이 한 줄)',
    '🌳 장년회 · (부족한 점 + 차이 한 줄)',
    '🌸 부녀회 · (부족한 점 + 차이 한 줄)',
    '🔥 청년회 · (부족한 점 + 차이 한 줄)',
  ].join('\n');
  let body = '', ai = false, raw = '';
  try {
    const t = await askAiModels(opts.today ? prompt.replaceAll('어제', '오늘') : prompt, NEWS_MODELS);
    if (t && !t.startsWith('⚠️')) { body = mdToTg(t); ai = true; raw = t; }
  } catch (e) { console.log('[교사광장 봇] 뉴스 AI 오류 ' + e); }
  if (!body) body = newsPlain(F);
  let text = [...head, body, '', `📎 데이터: 서머리 ①~⑤ · 기록 ${F.total.records}건 · 교사 ${F.total.teachers}명`].join('\n');
  // 11/5 4차(사용자): "가독성 있게 카드 뉴스로 — 텍스트는 밑에 달고, 데이터는 가독성 있는 카드" → 사진 = 카드, 글 = 사진 아래 설명
  const rawLines = raw.split('\n').map((l) => l.replace(/\*\*/g, '').trim()).filter(Boolean);
  const headline = (rawLines.find((l) => l.startsWith('🔴')) || '').replace(/^🔴\s*/, '') || `어제 기록 ${comma(F.total.records)}건 · 활동 교사 ${comma(F.total.teachers)}명`;
  const depts = F.depts.map((d) => {
    const l = rawLines.find((x) => new RegExp(d.label + '\\s*·').test(x));
    const line = l ? l.slice(l.indexOf(d.label) + d.label.length).replace(/^\s*·\s*/, '') : (d.items[0] ? `${d.items[0][0]} 중심(${d.items[0][1]}건)` : '기록 없음');
    return { label: d.label, records: d.records, prevRecords: d.prevRecords, teachers: d.teachers, rate: d.status.total ? pct(d.teachers, d.status.total) : '', line };
  });
  if (opts.oneline) {
    text = ['📰 <b>한 줄 데이터 뉴스</b>', `🗞 ${md} · 교자장부청`, '', ...NEWS_INTRO, '',
      ...depts.map((d) => `● <b>${esc(d.label)}</b> · ${esc(d.line)}`), '',
      `📎 데이터: 서머리 ①~⑤ · 기록 ${comma(F.total.records)}건 · 교사 ${comma(F.total.teachers)}명`].join('\n');
  }
  let png = null;
  try { png = newsCardPng({ date: md, headline: opts.today ? headline.replace(/^어제/, '오늘') : headline, total: F.total, depts, title: opts.oneline ? '한 줄 데이터 뉴스' : '' }); } catch (e) { console.log('[교사광장 봇] 뉴스 카드 그림 오류 ' + e); }
  return { text: text.length > 1000 ? text.slice(0, 990) + '…' : text, ai, facts: F, png };
}

// ── 주기 실행·운영용 action ── (key = TEACHERSQUARE_CRON_KEY)

// 11/5: 아침 7시 예약(ts-daily-summary → tsDailySummary)은 이제 '교사 활동 현황 서머리'. 활동 글을 손으로 다시 보낼 땐 tsActivitySummary.
const tsDailySummary = async (body) => (authorized(body) ? sendStatusSummary({ date: body.date, force: !!body.force }) : { error: 'unauthorized' });
const tsActivitySummary = async (body) => (authorized(body) ? sendDailySummary({ date: body.date, force: !!body.force }) : { error: 'unauthorized' });
const tsEveningSummary = async (body) => (authorized(body) ? sendEveningSummary({ date: body.date, force: !!body.force }) : { error: 'unauthorized' });
const tsStatusSummary = async (body) => (authorized(body) ? sendStatusSummary({ date: body.date, force: !!body.force }) : { error: 'unauthorized' });
const tsNoonSummary = async (body) => (authorized(body) ? sendNoonSummary({ date: body.date, force: !!body.force }) : { error: 'unauthorized' });

/** 봇 설정 여부와 최근 알림 10건. preview 에 'daily'|'evening' 을 주면 보내지 않고 글만 만들어 돌려준다. */
async function tsStatus(body) {
  if (!authorized(body)) return { error: 'unauthorized' };
  if (body.preview === 'daily') return { ok: true, ...(await composeDaily(body.date || kstDate(new Date(Date.now() - 24 * 3600 * 1000)))) };
  if (body.preview === 'status') { const r = await composeStatus(body.date || kstDate()); return { ok: true, text: r.text, caption: r.caption, photo: !!r.png, png: body.png && r.png ? r.png.toString('base64') : undefined }; }
  if (body.preview === 'noon' || body.preview === 'today') { const r = await composeBoard(body.date || kstDate(), body.preview === 'noon' ? 'noon' : 'evening'); return { ok: true, caption: r.caption, total: r.total, photo: !!r.png, png: body.png ? r.png.toString('base64') : undefined }; }
  if (body.preview === 'evening') { const { caption, tiers } = await composeEvening(body.date || kstDate()); return { ok: true, caption, tiers }; }
  const recent = await run(db().from('alert_log').select('*').order('id', { ascending: false }).limit(10));
  return {
    ok: true, hasToken: !!process.env.TEACHERSQUARE_BOT_TOKEN, chatId: process.env.TEACHERSQUARE_CHAT_ID || null,
    recent: recent.reverse().map((l) => [l.sent_at, l.kind, l.summary, l.ok ? '성공' : '실패', l.dedup_key]),
  };
}

/** 알림 시험: 저장은 하지 않고 알림만 보낸다. */
async function tsTest(body) {
  if (!authorized(body)) return { error: 'unauthorized' };
  if (body.kind === 'stage') await onStageReached(body.memberId, 'TEST-' + Date.now(), '', body.stage || '복음방');
  else await afterAction(body.kind || 'submitActivity', body, { ok: true });
  return { ok: true };
}

// ── 나만의 교사광장(시험 방) ── 11/4(사용자): "-1004460094453 여기는 나만의 교사광장이야, 여기에 테스트 같은 거 해보려고 해"
//   실제 방에는 보내지 않고 이 방에만 하루 서머리 세트를 순서대로(설명 붙여) 올린다. 중복 표시(alert_log)도 남기지 않는다.
//   { action:'tsTestRoom', key, date?, only?:['morning','noon','dept','evening','status'], intro?:false }
const MY_TEST_CHAT = '-1004460094453';

/** 시험 방에 글·사진 — 교사광장 봇으로, 안 되면 출석 봇으로(어느 봇이 들어가 있든). */
async function testSend(method, fields, photo) {
  const tokens = [process.env.TEACHERSQUARE_BOT_TOKEN, process.env.ATT_BOT_TOKEN].filter(Boolean);
  let last = '';
  for (const token of tokens) {
    const form = new FormData();
    form.set('chat_id', MY_TEST_CHAT);
    form.set('parse_mode', 'HTML');
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    if (photo) form.set('photo', new Blob([photo], { type: 'image/png' }), 'summary.png');
    const j = await (await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', body: form })).json().catch((e) => ({ description: String(e) }));
    if (j.ok) return { ok: true };
    last = j.description || '';
  }
  return { ok: false, error: last };
}
const testText = (text) => testSend('sendMessage', { text: text.slice(0, 4000), link_preview_options: JSON.stringify({ is_disabled: true }) });
const testPhoto = async (png, caption, fallback) => {
  if (png) { const r = await testSend('sendPhoto', { caption: caption.slice(0, 1024) }, png); if (r.ok) return r; }
  return testText(fallback || caption);
};

async function tsTestRoom(body) {
  if (!authorized(body)) return { error: 'unauthorized' };
  const day = body.date || kstDate();
  const yesterday = kstDate(new Date(new Date(day + 'T12:00:00+09:00').getTime() - 24 * 3600 * 1000));
  const only = Array.isArray(body.only) && body.only.length ? body.only : ['status', 'noon', 'dept', 'evening', 'morning'];
  const tag = () => '🧪 <b>[시험 발송]</b>\n';
  const out = [];
  let newsEcho;
  const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  if (body.intro !== false && !only.every((x) => x === 'att')) {
    out.push(['intro', await testText([
      '🧪 <b>나만의 교사광장 — 하루 서머리 세트 시험</b>',
      `${md(day)} 기록으로 만든 하루 세트예요. 실제 방에는 보내지 않았어요.`, '',
      '① ☀️ <b>아침 7시</b> — 교사 활동 현황 서머리: 명함·기록·입장 + 등급(휴·활·정·우) 채움 막대 (소통 방)',
      '② 🕛 <b>정오</b> — 교자장부청 × 활동 항목 <b>보라</b> 표 + 항목별 5개 조직 총합 (소통 방)',
      '③ 📊 <b>밤 10시</b> — 부서별 지역 일일 보고 총합 <b>민트</b> 표 (각 부서 총합 방·활동현황 방)',
      '④ 🌙 <b>밤 10시</b> — 교자장부청 하루 <b>보라</b> 표 + 항목별 5개 조직 총합 (소통 방)',
      '⑤ 🌃 <b>밤 11시</b> — 오늘 활동, 부서별 이름·활동 글 (소통 방)', '',
      '🚫 이제 안 올리는 것: 저녁 참여율 막대그래프, 교사 등급 현황 글',
      '📌 표 셈: 섭외자-인도자 한 쌍 = 1건, 섭외자 없는 기록(협력 등)은 한 건씩',
      ...(only.includes('news') ? ['', '📰 <b>새로 — 교사광장 전도 뉴스</b>: 다음 날 아침 7시, 위 ①~⑤의 전날 숫자로 부서별 특징을 뉴스처럼 (맨 끝에 올려요)'] : []),
    ].join('\n'))]);
  }
  if (only.includes('status')) {
    const r = await composeStatus(body.statusDate || day);
    out.push(['status', await testPhoto(r.png, tag('①', '아침 7시 — 교사 활동 현황 서머리') + r.caption, tag('①', '교사 활동 현황 서머리') + r.text)]);
  }
  if (only.includes('noon')) {
    const r = await composeBoard(day, 'noon');
    out.push(['noon', await testPhoto(r.png, tag('②', '정오 서머리 — 교자장부청 오전 보고 총합(보라)') + r.caption)]);
  }
  if (only.includes('dept')) {
    const { buildSummaryReports } = await import('../lib/report-room.js');
    const sums = (await buildSummaryReports(day)).filter((s) => /#총합$/.test(s.room.dept));   // 같은 표를 여러 방에 보내는 사본(:활동현황·:회장단)은 한 번만
    if (!sums.length) out.push(['dept', await testText(tag('③', '부서별 지역 일일 보고 총합(민트)') + '총합 방이 연결된 부서가 없어요.')]);
    for (const s of sums) out.push(['dept:' + s.room.dept, await testPhoto(s.png, tag('③', '밤 10시 — 부서 지역별 총합(민트)') + s.caption, tag('③', '부서 지역별 총합') + s.text)]);
  }
  if (only.includes('evening')) {
    const r = await composeBoard(day, 'evening');
    out.push(['evening', await testPhoto(r.png, tag('④', '밤 10시 서머리 — 교자장부청 일일 보고 총합(보라)') + r.caption)]);
  }
  if (only.includes('morning')) {   // 11/5부터 밤 11시: 그날 활동
    const { parts } = await composeDaily(day);
    for (const [i, p] of parts.entries()) out.push(['morning', await testText((i ? '' : tag('⑤', `밤 11시 서머리 — 오늘(${md(day)}) 활동`)) + p)]);
  }
  if (only.includes('news')) {   // 11/5: 📰 전도 뉴스(아침 7시에 전날 것) — 시험 방에서 먼저
    const r = await composeNews(body.newsDate || day);
    out.push(['news' + (r.ai ? '' : ':plain') + (r.png ? ':card' : ''), await testPhoto(r.png, tag() + r.text, tag() + r.text)]);
    if (body.echo) newsEcho = r.text;
  }
  // 11/4: 출석 서머리 시험 — { only:['att'], meetingId, phase:'최종'|'오전'… } 지역 글 몇 개 + 부서 민트 표 + 교자장부청 보라 표
  if (only.includes('att')) {
    const { findMeeting } = await import('./attendance.js');
    const { attendancePreview } = await import('../lib/room-attendance.js');
    const m = await findMeeting(String(body.meetingId || ''));
    if (!m) return { error: '모임 없음' };
    const phase = String(body.phase || '최종');
    const p = await attendancePreview(m, phase, Number(body.regions || 2));
    if (body.intro !== false) {
      out.push(['att:intro', await testText([
        '🧪 <b>출석 서머리 새 모양 — 시험</b>', `📌 ${esc(m.title)} (${m.date}) · ${phase === '최종' ? '교육 마감 · 총 참석' : phase + ' 교육 마감'}`, '',
        '① 📍 <b>지역 방·교역자 방</b> — 숫자 요약(한 줄에 하나) + 타임별 정상/지각으로 나눈 이름(한 줄에 4명)',
        '② 📊 <b>부서 총합·전체 방</b> — 지역 × 재적·오전·저녁·총 참석·출석률·정상·지각·비교사 <b>노랑</b> 표',
        '③ 🔵 <b>교자장부청</b> — 같은 칸의 <b>파랑</b> 표 (어느 방에 올릴지 정해 주시면 연결)', '',
        '※ 지역 글은 견본으로 몇 곳만 보냈어요. 실제로는 사람이 온 지역 방마다 하나씩.',
      ].join('\n'))]);
    }
    for (const t of p.texts) out.push(['att:region', await testText(tag('①', '지역 방') + t)]);
    for (const d of p.depts) out.push(['att:' + d.dept, await testPhoto(d.png, tag('②', `${d.dept} 총합 방`) + d.caption, tag('②', d.dept) + d.text)]);
    if (p.org) out.push(['att:org', await testPhoto(p.org.png, tag('③', '교자장부청') + p.org.caption, tag('③', '교자장부청') + p.org.text)]);
  }
  return { ok: out.every(([, r]) => r.ok), chat: MY_TEST_CHAT, date: day, sent: out.map(([k, r]) => [k, r.ok ? '성공' : '실패 ' + (r.error || '')]), ...(newsEcho ? { newsText: newsEcho } : {}) };
}

export { composeDaily, composeEvening };
// 11/5(사용자): "오늘 부서별 총합 카드 뉴스를 소통 방에 — 교자장부청 한 줄 데이터 뉴스"
//   { action:'tsNewsSend', key, date?, today?:true, to?:'test' } — 카드 사진 + 아래 한 줄 뉴스 글. 같은 날 한 번만(force로 다시).
const tsNewsSend = async (body) => (authorized(body) ? sendNewsOneline(body) : { error: 'unauthorized' });
async function sendNewsOneline(body) {
  const day = body.date || kstDate();
  // 11/5(사용자): "이미지는 하지 말고 한 줄 데이터 뉴스 텍스트만" → photo:false. text 를 주면 확인한 글 그대로(AI 다시 안 씀)
  const r = body.text ? { text: String(body.text), png: null, ai: false } : await composeNews(day, { oneline: true, today: body.today !== false });
  if (body.photo === false) r.png = null;
  if (body.to === 'test') return { ...(await testPhoto(r.png, r.text, r.text)), ai: r.ai, text: r.text };
  const key = body.force ? '' : 'news1_' + day;
  if (key && await alreadySent(key)) return { ok: false, skipped: true, date: day };
  if (body.photo !== true) r.png = null;   // 11/5: 글만이 기본(사진은 photo:true)
  let ok = r.png ? await sendChart(r.png, r.text, key, '데이터뉴스') : false;
  if (!ok) ok = await sendAlert(r.text, '데이터뉴스', key);
  return { ok, date: day, ai: r.ai, photo: !!r.png, text: r.text };
}
// 11/5: 전체 텔레그램 방 연결 점검(보내지 않음)
const tsRoomHealth = async (body) => (authorized(body) ? (await import('../lib/room-health.js')).roomHealth() : { error: 'unauthorized' });

export default { tsNewsSend, tsRoomHealth, tsDailySummary, tsActivitySummary, tsEveningSummary, tsNoonSummary, tsStatusSummary, tsStatus, tsTest, tsTestRoom };
