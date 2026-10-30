// 교사광장 봇의 정기 서머리: 아침 7시(어제 활동), 정오(오늘 오전 교자장부청), 저녁 10시(오늘 교자장부청 + 이번 달 참여율·등급 현황), 밤 11시(명함·활동 기록·입장 현황)
// 10/30(사용자): 활동 방엔 개별 실시간 알림은 올리지 않고(events.js INSTANT_ALERTS) 서머리 세 번만.
import { db, run, selectAll } from '../lib/db.js';
import { normId, kstDate, kstDateTime, fmtTs } from '../lib/util.js';
import { sendAlert, alreadySent, logAlert, esc } from '../lib/alerts.js';
import { afterAction, onStageReached } from '../lib/events.js';
import { teachersByNid, rosterCounts, loadRoster } from './roster.js';
import { progressPng } from '../lib/progress-image.js';

// [명단의 부서 이름, 알림에 쓰는 이름]
const DEPTS = [['교역자', '교역자회'], ['자문회', '자문회'], ['장년회', '장년회'], ['부녀회', '부녀회'], ['청년회', '청년회']];
const TIER_ICONS = [['휴교사', '🔴'], ['활동교사', '🟡'], ['정교사', '🟢'], ['우수교사', '🏆']];
const DEPT_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444'];
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

  const lines = ['☀️ <b>아침 7시 서머리</b> ☀️', `📅 ${day} (${weekdayOf(day)}) 활동`, ''];
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

/** 어제(또는 지정한 날) 활동 서머리를 보낸다. 같은 날 것은 한 번만(force 면 다시, 중복 표시도 남기지 않는다). */
async function sendDailySummary({ date, force }) {
  try {
    const day = date || kstDate(new Date(Date.now() - 24 * 3600 * 1000));
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

// ── 정오·저녁 교자장부청 서머리 (10/30) ──
// 단계 묶음 — 보고방 일일 보고(report-room.js DAILY_SECTIONS)와 같은 이름
const STAGE_GROUPS = [['💜', '새찾기', ['섭외']], ['🟠', '만남', ['친분', '만남1', '만남2']], ['🟢', '상담', ['상담1', '상담2']], ['🔵', '복음방', ['복음방']], ['🏛', '센터', ['센터소개', '센터수강']]];

/** 그날(지금까지) 활동을 교자장부청 + 전주교회 전체로 — 부서마다 참여 인원·기록 건수·단계별 건수. */
async function composeDepts(day, title) {
  const activities = await activitiesBetween(day, day);
  const byNid = await teachersByNid(activities.map((a) => a.nid));
  const blank = () => ({ people: new Set(), n: 0, stages: STAGE_GROUPS.map(() => 0) });
  const stat = Object.fromEntries(DEPTS.map(([d]) => [d, blank()]));
  const all = blank();
  for (const a of activities) {
    const items = a.activities.flatMap((x) => x.split(',')).map((x) => x.trim());
    for (const s of [stat[byNid.get(a.nid)?.dept], all].filter(Boolean)) {
      s.people.add(a.nid); s.n++;
      STAGE_GROUPS.forEach(([, , list], i) => { if (items.some((x) => list.includes(x))) s.stages[i]++; });
    }
  }
  const stageLine = (s) => { const t = STAGE_GROUPS.map(([e, l], i) => (s.stages[i] ? `${e}${l} ${s.stages[i]}` : '')).filter(Boolean).join(' · '); return t ? '   ' + t : ''; };
  const lines = [title, `📅 ${day} (${weekdayOf(day)})`, ''];
  for (const [dept, label] of DEPTS) {
    const s = stat[dept];
    lines.push(`🏢 <b>${label}</b>  ${s.n ? `참여 ${comma(s.people.size)}명 · 기록 ${comma(s.n)}건` : '기록 없음'}`);
    const st = stageLine(s); if (st) lines.push(st);
  }
  lines.push('', `⛪ <b>전주교회 전체</b>  참여 ${comma(all.people.size)}명 · 기록 ${comma(all.n)}건`);
  const st = stageLine(all); if (st) lines.push(st);
  return { text: lines.join('\n'), total: all.n };
}

/** 정오 서머리: 오늘 0시~지금(12시) 교자장부청. 같은 날 한 번만. */
async function sendNoonSummary({ date, force } = {}) {
  const day = date || kstDate();
  const key = force ? '' : 'noon_' + day;
  if (key && await alreadySent(key)) return { ok: false, date: day, skipped: true };
  const { text, total } = await composeDepts(day, '🕛 <b>정오 서머리</b> 🕛  오늘 오전 활동');
  return { ok: await sendAlert(text, '정오서머리', key), date: day, total };
}

// ── 밤 11시 현황 (10/30) ── 사용자: "교자장부청별 명함 등록·활동 기록 참여자·입장 1회 이상 — 몇 명 중 몇 명"
async function composeStatus(day) {
  const [roster, cards, acts, visits] = await Promise.all([
    loadRoster(),
    selectAll(() => db().from('connect_cards').select('id, nid').neq('member_id', '').order('id')),
    selectAll(() => db().from('activities').select('id, nid').order('id')),
    selectAll(() => db().from('app_visits').select('nid, visits').gt('visits', 0).order('nid')),
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
  const lines = ['🌃 <b>밤 11시 교사광장 참여 현황</b>', `📅 ${day} (${weekdayOf(day)}) 기준 · 누적`, ''];
  for (const [dept, label] of DEPTS) lines.push(...block(label, stat[dept]), '');
  lines.push(...block('⛪ 전주교회 전체', all).map((l, i) => (i ? l : l.replace('🏢 ', ''))));
  // 10/30(사용자): 옆으로 뻗는 채움 막대 사진(조직마다 막대 = 전체 인원, 채운 만큼 = 해당 인원) + 짧은 설명
  const orgs = [...DEPTS.map(([d, label]) => [label, stat[d]]), ['전주교회 전체', all]];
  let png = null;
  try {
    png = progressPng({
      title: '교사광장 참여 현황', sub: `${day} (${weekdayOf(day)}) 기준 · 누적 · 막대 끝 = 그 조직 전체 교사`,
      labels: orgs.map(([l]) => l), totals: orgs.map(([, s]) => s.total), sumLabel: '전주교회 전체',
      panels: [
        { title: '명함 등록', color: '#00AE82', values: orgs.map(([, s]) => s.card) },
        { title: '활동 기록 참여', color: '#2F6BFF', values: orgs.map(([, s]) => s.act) },
        { title: '앱 입장 1회 이상', color: '#F08A00', values: orgs.map(([, s]) => s.seen) },
      ],
    });
  } catch (e) { console.log('[교사광장 봇] 참여 현황 그림 오류 ' + e); }
  const caption = ['🌃 <b>교사광장 참여 현황</b>', `📅 ${day} (${weekdayOf(day)}) 기준 · 누적`, '',
    ...orgs.map(([l, s]) => `${l === '전주교회 전체' ? '⛪' : '🏢'} <b>${l}</b> ${comma(s.total)}명 — 명함 ${comma(s.card)} · 기록 ${comma(s.act)} · 입장 ${comma(s.seen)}`)].join('\n');
  return { text: lines.join('\n'), caption, png };
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

/** 5분마다(attAutoSummary): 12시가 지나면 정오 서머리(오후 3시까지만 — 늦게 켜져도 밤에 '정오'가 나가지 않게), 22시 저녁 서머리, 23시 참여 현황. */
export async function summaryTick() {
  const hm = kstDateTime().slice(11, 16);
  const out = {};
  if (hm >= '12:00' && hm < '15:00') out.noon = await sendNoonSummary().catch((e) => ({ error: String(e) }));
  if (hm >= '22:00') out.evening = await sendEveningSummary({ tick: true }).catch((e) => ({ error: String(e) }));
  if (hm >= '23:00') out.status = await sendStatusSummary().catch((e) => ({ error: String(e) }));
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

/** 부서별 참여율 막대그래프(PNG). 못 만들면 null. */
async function participationChart({ labels, totals, joined, month }) {
  try {
    const pcts = labels.map((_, i) => (totals[i] ? Math.round((joined[i] / totals[i]) * 1000) / 10 : 0));
    const max = Math.max(...pcts, 1);
    const xLabels = labels.map((l, i) => [l, `${comma(joined[i])} / ${comma(totals[i])}명`]);
    // QuickChart 는 함수가 든 차트 설정을 글자로 받는다.
    const chart = `{type:'bar',data:{labels:${JSON.stringify(xLabels)},datasets:[{data:${JSON.stringify(pcts)},backgroundColor:${JSON.stringify(DEPT_COLORS)}}]},` +
      `options:{legend:{display:false},title:{display:true,text:${JSON.stringify(month + '월 부서별 참여율 (%)')},fontSize:22,fontColor:'#111'},` +
      `layout:{padding:{top:10}},scales:{yAxes:[{ticks:{beginAtZero:true,suggestedMax:${Math.ceil(max * 1.25 * 10) / 10},fontSize:14,callback:function(v){return v+'%';}}}],` +
      `xAxes:[{ticks:{fontSize:16,fontColor:'#111'}}]},` +
      `plugins:{datalabels:{anchor:'end',align:'end',color:'#111',font:{size:18,weight:'bold'},formatter:function(v){return v+'%';}}}}}`;
    const r = await fetch('https://quickchart.io/chart', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ width: 720, height: 460, backgroundColor: 'white', format: 'png', devicePixelRatio: 2, chart }),
    });
    return r.status === 200 ? Buffer.from(await r.arrayBuffer()) : null;
  } catch (e) {
    console.log('[교사광장 봇] 차트 오류 ' + e);
    return null;
  }
}

/** 그래프를 못 보낼 때 대신 쓰는 글 막대. */
function textBars({ labels, totals, joined }) {
  const pcts = labels.map((_, i) => (totals[i] ? (joined[i] / totals[i]) * 100 : 0));
  const max = Math.max(...pcts, 0.0001);
  return labels.map((l, i) => {
    const n = Math.round((pcts[i] / max) * 10);
    return `<b>${l.slice(0, 2)}</b> ${n ? '🟩'.repeat(n) : '▫️'} ${percent(joined[i], totals[i])}`;
  }).join('\n');
}

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

/** 저녁 서머리 세 통: ⓪ 오늘 교자장부청·교회 전체 ① 참여율 그래프(안 되면 글 막대) ② 등급 현황. */
async function sendEveningSummary({ date, force, tick }) {
  try {
    // 10/30: 22시로 옮김 — 21시에 도는 옛 예약(ts-evening-summary)은 건너뛰고 5분 틱(summaryTick)이 22시에 보낸다
    if (!tick && !date && !force && kstDateTime().slice(11, 16) < '22:00') return { ok: false, skipped: true, reason: '22시 전' };
    const day = date || kstDate();
    const dedupKey = 'evening_' + day;
    if (!force && await alreadySent(dedupKey + '|0')) return { ok: false, date: day, skipped: true };
    const summary = await composeEvening(day);
    const key0 = force ? '' : dedupKey + '|0';
    const key1 = force ? '' : dedupKey;
    const key2 = force ? '' : dedupKey + '|2';
    const today = await composeDepts(day, '🌙 <b>저녁 10시 서머리</b> 🌙  오늘 하루 교자장부청 활동');
    await sendAlert(today.text, '저녁서머리', key0);
    const chart = await participationChart(summary);
    let ok1 = chart ? await sendChart(chart, summary.caption, key1) : false;
    if (!ok1) ok1 = await sendAlert(summary.caption + '\n\n' + textBars(summary), '저녁서머리', key1);
    const ok2 = await sendAlert(summary.tiers, '저녁서머리', key2);
    return { ok: ok1 && ok2, date: day, chart: !!chart, skipped: false };
  } catch (err) {
    console.log('[교사광장 봇] 저녁 서머리 오류 ' + err);
    return { ok: false, error: String(err) };
  }
}

// ── 주기 실행·운영용 action ── (key = TEACHERSQUARE_CRON_KEY)

const tsDailySummary = async (body) => (authorized(body) ? sendDailySummary({ date: body.date, force: !!body.force }) : { error: 'unauthorized' });
const tsEveningSummary = async (body) => (authorized(body) ? sendEveningSummary({ date: body.date, force: !!body.force }) : { error: 'unauthorized' });
const tsStatusSummary = async (body) => (authorized(body) ? sendStatusSummary({ date: body.date, force: !!body.force }) : { error: 'unauthorized' });
const tsNoonSummary = async (body) => (authorized(body) ? sendNoonSummary({ date: body.date, force: !!body.force }) : { error: 'unauthorized' });

/** 봇 설정 여부와 최근 알림 10건. preview 에 'daily'|'evening' 을 주면 보내지 않고 글만 만들어 돌려준다. */
async function tsStatus(body) {
  if (!authorized(body)) return { error: 'unauthorized' };
  if (body.preview === 'daily') return { ok: true, ...(await composeDaily(body.date || kstDate(new Date(Date.now() - 24 * 3600 * 1000)))) };
  if (body.preview === 'status') { const r = await composeStatus(body.date || kstDate()); return { ok: true, text: r.text, caption: r.caption, photo: !!r.png }; }
  if (body.preview === 'noon' || body.preview === 'today') return { ok: true, ...(await composeDepts(body.date || kstDate(), body.preview === 'noon' ? '🕛 정오 서머리' : '🌙 오늘 하루')) };
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

export { composeDaily, composeEvening };
export default { tsDailySummary, tsEveningSummary, tsNoonSummary, tsStatusSummary, tsStatus, tsTest };
