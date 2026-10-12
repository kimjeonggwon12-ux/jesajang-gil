// 교사광장 봇의 정기 서머리: 아침 7시(어제 활동), 저녁 9시(이번 달 참여율·등급 현황)
import { db, run, selectAll } from '../lib/db.js';
import { normId, kstDate, fmtTs } from '../lib/util.js';
import { sendAlert, alreadySent, logAlert, esc } from '../lib/alerts.js';
import { afterAction, onStageReached } from '../lib/events.js';

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

const loadTeachers = async () => {
  const rows = await selectAll(() => db().from('teachers').select('nid, name, dept, tier').order('sort_order').order('member_id'));
  return { rows, byNid: new Map(rows.map((t) => [t.nid, t])) };
};

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
  const [{ byNid }, activities, center, cards] = await Promise.all([
    loadTeachers(), activitiesBetween(day, day), centerLeadCount(day, day),
    db().from('connect_cards').select('*', { count: 'exact', head: true }).neq('member_id', ''),
  ]);
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

// ── 저녁 서머리 ──

/** 그달 1일~그날: 부서별 참여율(설명 글 + 그래프 재료)과 등급 현황 글. */
async function composeEvening(day) {
  const monthStart = day.slice(0, 8) + '01';
  const [{ rows: teachers, byNid }, activities, center] = await Promise.all([
    loadTeachers(), activitiesBetween(monthStart, day), centerLeadCount(monthStart, day),
  ]);
  const stat = Object.fromEntries(DEPTS.map(([dept]) => [dept, { total: 0, tiers: {}, people: new Set(), acts: 0 }]));
  const allTiers = {};
  for (const t of teachers) {
    allTiers[t.tier] = (allTiers[t.tier] || 0) + 1;
    const s = stat[t.dept];
    if (!s) continue;
    s.total++;
    s.tiers[t.tier] = (s.tiers[t.tier] || 0) + 1;
  }
  for (const a of activities) {
    const s = stat[byNid.get(a.nid)?.dept];
    if (s) { s.people.add(a.nid); s.acts++; }
  }

  const month = Number(day.slice(5, 7));
  const caption = ['🌙 <b>저녁 9시 서머리</b> 🌙',
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
  tierBlock('전주교회 교사', teachers.length, allTiers);
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
async function sendChart(png, caption, dedupKey) {
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
    await logAlert('저녁서머리', '[그래프] ' + caption, r.ok, dedupKey);
    return r.ok;
  } catch (e) {
    console.log('[교사광장 봇] 사진 전송 오류 ' + e);
    return false;
  }
}

/** 저녁 서머리 두 통: ① 참여율 그래프(안 되면 글 막대) ② 등급 현황. */
async function sendEveningSummary({ date, force }) {
  try {
    const day = date || kstDate();
    const dedupKey = 'evening_' + day;
    if (!force && await alreadySent(dedupKey)) return { ok: false, date: day, skipped: true };
    const summary = await composeEvening(day);
    const key1 = force ? '' : dedupKey;
    const key2 = force ? '' : dedupKey + '|2';
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

/** 봇 설정 여부와 최근 알림 10건. preview 에 'daily'|'evening' 을 주면 보내지 않고 글만 만들어 돌려준다. */
async function tsStatus(body) {
  if (!authorized(body)) return { error: 'unauthorized' };
  if (body.preview === 'daily') return { ok: true, ...(await composeDaily(body.date || kstDate(new Date(Date.now() - 24 * 3600 * 1000)))) };
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
export default { tsDailySummary, tsEveningSummary, tsStatus, tsTest };
