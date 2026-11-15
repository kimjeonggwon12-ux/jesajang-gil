import {db,run,selectAll} from '../../server/lib/db.js';
import {normId,str,kstDate,fmtTs} from '../../server/lib/util.js';
import {TARGET_STAGES} from '../../server/actions/targets.js';
const ownedBy = (nid) => `creator_nid.eq.${nid},leader_nid.eq.${nid},helper_nid.eq.${nid}`;
const INFO_KIND = '파악정보';
const MASTER_KIND = 'AI 종합 피드백';
export async function activitiesAbout(target) {
  const owners = new Set([target.creator_id, target.leader_id, target.helper_id].filter((id) => str(id)).map(normId));
  if (!target.target_name.trim() || !owners.size) return [];
  const rows = await selectAll(() => db().from('activities').select('*').in('nid', [...owners]).order('id'));
  return rows.filter((a) => a.target_name.trim() === target.target_name.trim());
}

const cut = (s, n) => { const t = String(s == null ? '' : s).trim(); return t.length > n ? t.slice(0, n) + '…' : t; };
const maskName = (s) => { const t = String(s || '').trim(); return t.length <= 1 ? t : t.length === 2 ? t[0] + '*' : t[0] + '*'.repeat(t.length - 2) + t.at(-1); };
const day = (v) => fmtTs(v).slice(0, 10);

/** 새것부터 budget 글자까지만 남기고(넘치면 오래된 것을 줄인다) 다시 오래된 순으로. */
function keepNewest(lines, budget) {
  const out = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    used += lines[i].length;
    if (used > budget) { out.unshift(`- (그 전 기록 ${i + 1}건은 길어서 생략)`); break; }
    out.unshift(lines[i]);
  }
  return out.length ? out : ['- 없음'];
}

export async function coachingAbout(target, mid) {
  const name = target.target_name.trim();
  const owners = [...new Set([target.creator_id, target.leader_id, target.helper_id, mid].filter((id) => str(id)).map(normId))];
  const [mine, feedbacks] = await Promise.all([
    run(db().from('targets').select('target_name').or(ownedBy(normId(mid)))),
    selectAll(() => db().from('feedbacks').select('*').in('nid', owners).order('id')),
  ]);
  // AI상담·교관 요청의 '상황'에는 보통 "대상자: 홍*동"처럼 가린 이름이 들어간다 — 내 대상자 중 가린 이름이 겹치면 실명으로만 찾는다.
  const m = maskName(name);
  const maskUnique = mine.filter((t) => maskName(t.target_name) === m).length <= 1;
  const about = (s) => !!name && (s.includes(name) || (maskUnique && m.length > 1 && s.includes(m)));
  return feedbacks.filter((f) => about(String(f.situation || ''))).sort((a, b) => (String(a.submitted_at) < String(b.submitted_at) ? -1 : 1));
}

export async function targetDossier(target, mid, budget = {}) {
  const B = { acts: 30000, history: 4000, coaching: 15000, notes: 12000, info: 20000, ...budget };
  const [acts, history, allNotes, coach] = await Promise.all([
    activitiesAbout(target),
    run(db().from('target_history').select('*').eq('target_id', target.target_id).order('id')),
    run(db().from('target_ai_notes').select('*').eq('target_id', target.target_id).order('id')).catch(() => []),
    coachingAbout(target, mid),
  ]);
  // 10/30: 교사가 파악한 정보(INFO_KIND)는 AI 기록과 따로 — 모든 AI 프롬프트에 '■ 교사가 파악한 정보'로 들어간다
  const info = allNotes.filter((n) => n.kind === INFO_KIND);
  const notes = allNotes.filter((n) => n.kind !== INFO_KIND && n.kind !== MASTER_KIND);
  const infoLines = info.map((n) => `- ${day(n.created_at)} [${n.input || '기타'}] ${cut(n.text, 1500)}`);

  const actLines = acts.sort((a, b) => (String(a.submitted_at) < String(b.submitted_at) ? -1 : 1)).map((a) => '- ' + [
    day(a.submitted_at), a.roles.length && `[${a.roles.join('·')}]`, a.activities.join(', '), a.target_stage && `(단계: ${a.target_stage})`,
    a.consult_title && `상담 제목: ${a.consult_title}`, a.gospel_subject && `과목: ${a.gospel_subject}`,
    a.reaction && `반응: ${a.reaction}${a.reaction_note ? ` — ${a.reaction_note}` : ''}`,
    a.today_work && `한 일: ${cut(a.today_work, 600)}`, a.next_work && `다음: ${cut(a.next_work, 300)}`, a.special_note && `특이사항: ${cut(a.special_note, 300)}`,
  ].filter(Boolean).join(' / '));
  const histLines = history.map((h) => `- ${day(h.changed_at)} ${h.from_stage || '(처음)'} → ${h.to_stage}${h.memo ? ` (${cut(h.memo, 200)})` : ''}`);
  const coachLines = coach.map((f) => [`- ${day(f.submitted_at)} [${f.source}] 상황: ${cut(f.situation, 400)}`,
    f.ai_coach_text && `  AI 답: ${cut(f.ai_coach_text, 1500)}`, f.handler_answer && `  교관 답(${f.handler || '교관'}): ${cut(f.handler_answer, 1200)}`].filter(Boolean).join('\n'));
  const noteLines = notes.map((n) => `- ${day(n.created_at)} [${n.kind}] ${cut(n.input, 300)}\n  ${cut(n.text, 2500).replace(/\n/g, '\n  ')}`);

  return {
    acts: keepNewest(actLines, B.acts), history: keepNewest(histLines, B.history),
    coaching: keepNewest(coachLines, B.coaching), notes: keepNewest(noteLines, B.notes), info: keepNewest(infoLines, B.info), actN: acts.length, coachN: coach.length,
    basis: `활동 ${acts.length}건 · 파악 정보 ${info.length}건 · 단계 이력 ${history.length}건 · AI상담·교관 ${coach.length}건 · 이전 AI 기록 ${notes.length}건 종합`,
  };
}

const ROLES = ['인도자', '교사', '섬김이', '협력교사'];
// 협력교사는 대상자를 맡지 않으므로 올해 협력 활동을 항목별로 센다. ⚠️ app.html COOP_ACTIVITY_OPTIONS 와 같이 맞출 것.
const COOP_ITEMS = ['피드백', '동아리', '잎사귀', '만남 동행', '밭보기', '은사', '멘토교사', '동행교사', '식구 복음방', '전도 행사 지원', '교육 지원', '특강'];

/** 진행 중인 대상자마다 { stage, roles } — roles 는 담당자들이 그 대상자 활동에 적은 역할 + 담당 배정. */
async function openTargetsWithRoles() {
  const [activities, targets] = await Promise.all([
    selectAll(() => db().from('activities').select('nid, target_name, roles').neq('member_id', '').neq('target_name', '').order('id')),
    selectAll(() => db().from('targets').select('*').eq('completed', false).order('id')),
  ]);
  const rolesBy = new Map();
  for (const a of activities) {
    const name = a.target_name.trim();
    if (!name) continue;
    const key = `${a.nid}::${name}`;
    if (!rolesBy.has(key)) rolesBy.set(key, new Set());
    a.roles.forEach((r) => rolesBy.get(key).add(r));
  }
  return targets.map((t) => {
    const roles = new Set();
    for (const id of [t.creator_id, t.leader_id, t.helper_id]) {
      if (str(id)) rolesBy.get(`${normId(id)}::${t.target_name.trim()}`)?.forEach((r) => roles.add(r));
    }
    if (str(t.leader_id)) roles.add('인도자');
    if (str(t.helper_id)) roles.add('섬김이');
    return { stage: t.stage, roles };
  });
}

async function getTargetStageDistribution(body) {
  let role = str(body.role);
  if (role === '협력') role = '협력교사';
  if (role && !ROLES.includes(role)) return { error: '알 수 없는 역할: ' + role };

  if (role === '협력교사') {
    const year = Number(kstDate().slice(0, 4));
    const activities = await selectAll(() => db().from('activities').select('activities')
      .neq('member_id', '').contains('roles', [role])
      .gte('submitted_at', `${year}-01-01`).lt('submitted_at', `${year + 1}-01-01`).order('id'));
    const counts = Object.fromEntries(COOP_ITEMS.map((s) => [s, 0]));
    let total = 0, other = 0;
    for (const item of activities.flatMap((a) => a.activities)) {
      if (!item) continue;
      if (counts[item] === undefined) { other++; continue; }
      counts[item]++; total++;
    }
    return { role, kind: 'items', total, other, stages: COOP_ITEMS.map((stage) => ({ stage, count: counts[stage] })) };
  }

  const counts = Object.fromEntries(TARGET_STAGES.map((s) => [s, 0]));
  let total = 0, other = 0;
  for (const t of await openTargetsWithRoles()) {
    if (role && !t.roles.has(role)) continue;
    if (counts[t.stage] === undefined) { other++; continue; }
    counts[t.stage]++; total++;
  }
  return { role, total, other, stages: TARGET_STAGES.map((stage) => ({ stage, count: counts[stage] })) };
}

// 11/8(사용자): 관리자 전체 요약의 막대 그래프 = 활동 기록 화면의 항목 그대로, 올해 기록 건수.
//   ⚠️ app.html ROLE_ACTIVITY_OPTIONS·TEACHER_EXTRA_ACTIVITY·EXTRA_ACTIVITY_OPTIONS 와 같이 맞출 것.
const ROLE_ITEMS = ['피드백', '섭외', '만남1', '상담1', '상담2', '복음방', '센터수강'];
const EXTRA_ITEMS = ['동아리', '식구 복음방', '전도 행사 지원'];
// 11/3에 칩에서 뺀 옛 항목은 지금 칩으로 묶어 센다(친분·만남2 → 만남, 센터소개 → 복음방, 동행 복음방 → 동행교사)
const ITEM_FOLD = { '친분': '만남1', '만남2': '만남1', '센터소개': '복음방', '동행 복음방': '동행교사' };
async function getActivityItemDistribution(body) {
  let role = str(body.role);
  if (role === '협력') role = '협력교사';
  if (role && !ROLES.includes(role)) return { error: '알 수 없는 역할: ' + role };
  const items = role === '협력교사' ? COOP_ITEMS
    : [...ROLE_ITEMS, ...(role === '' || role === '교사' ? ['동행교사'] : []), ...EXTRA_ITEMS];
  const year = Number(kstDate().slice(0, 4));
  const rows = await selectAll(() => {
    const q = db().from('activities').select('activities, roles').neq('member_id', '')
      .gte('submitted_at', `${year}-01-01`).lt('submitted_at', `${year + 1}-01-01`);
    return (role ? q.contains('roles', [role]) : q).order('id');
  });
  const counts = Object.fromEntries(items.map((s) => [s, 0]));
  let total = 0, other = 0;
  for (const a of rows) {
    if (!role && a.roles.includes('협력교사')) continue;   // 전체 = 인도·교사·섬김 기록(협력은 항목 체계가 달라 따로)
    for (const raw of a.activities) {
      const item = ITEM_FOLD[str(raw)] || str(raw);
      if (!item) continue;
      if (counts[item] === undefined) { other++; continue; }
      counts[item]++; total++;
    }
  }
  return { role, kind: 'items', year, total, other, stages: items.map((stage) => ({ stage, count: counts[stage] })) };
}

/** 표지 숫자: 복음방·센터소개·센터수강 단계 대상자 수. */
async function getKeyStageCount() {
  const { stages } = await getTargetStageDistribution({});
  const by = Object.fromEntries(stages.map((s) => [s.stage, s.count]));
  return { gospel: by['복음방'] || 0, centerIntro: by['센터소개'] || 0, centerAttend: by['센터수강'] || 0 };
}


export default {getTargetStageDistribution,getActivityItemDistribution,getKeyStageCount};
