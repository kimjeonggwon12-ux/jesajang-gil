// 월별 교사관리 엑셀 반영: 화면이 엑셀에서 뽑은 명단을 보내면, 무엇이 바뀌는지 먼저 보여 주고(미리보기) 확인을 받아 반영한다.
// 엑셀에 있는 사람 = 이번 달 명단. 직책은 앱의 값을 유지한다. 이름·등급·빠지는 사람은 화면에서 고른 대로 따른다.
import { db, run, selectAll } from '../lib/db.js';
import { normId, kstDate, kstDateTime } from '../lib/util.js';
import { clip } from '../lib/input.js';
import { TEACHER_TIERS, memberInfo, isApprover, forgetRoster } from './roster.js';

const DENIED = { error: '명단 관리는 교육부·전도부 담당만 할 수 있어요.' };
const LIST_CAP = 300;   // 미리보기 목록은 종류마다 이만큼까지만(건수는 전부 센다)

/** 화면에서 받은 엑셀 줄을 다듬는다. */
function cleanRows(rows) {
  const seen = new Set();
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const memberId = clip(r?.memberId, 40);
    const nid = normId(memberId);
    const name = clip(r?.name, 30);
    if (memberId.replace(/\D/g, '').length < 11 || !name || seen.has(nid)) continue;
    seen.add(nid);
    const count = (v) => Math.max(0, Math.round(Number(v) || 0));
    out.push({
      memberId, nid, name, dept: clip(r.dept, 20), region: clip(r.region, 20), note: clip(r.note, 60),
      regLeads: count(r.regLeads), unregLeads: count(r.unregLeads), counsel: count(r.counsel),
      gospelRoom: count(r.gospelRoom), companion: count(r.companion), activeState: clip(r.activeState, 20),
      tier: TEACHER_TIERS.includes(r.tier) ? r.tier : '활동교사',
    });
  }
  return out;
}

/**
 * 지금 명단과 엑셀을 견주어 바뀔 내용을 만든다.
 * options: applyTiers(등급도 엑셀 기준으로), renameIds(엑셀 이름으로 바꿀 사람), keepIds(엑셀에 없어도 남길 사람)
 */
async function plan(excel, options) {
  const [teachers, admins] = await Promise.all([
    selectAll(() => db().from('teachers').select('*').order('sort_order').order('member_id'), 3),
    selectAll(() => db().from('admins').select('nid, position').order('id')),
  ]);
  const current = new Map(teachers.map((t) => [t.nid, t]));
  const adminOf = new Map(admins.map((a) => [a.nid, a]));
  const rename = new Set((options.renameIds || []).map(normId));
  const keep = new Set((options.keepIds || []).map(normId));
  const today = kstDate();
  const who = (t) => ({ memberId: t.member_id ?? t.memberId, name: t.name, dept: t.dept, region: t.region });

  const upserts = [], added = [], moved = [], renamed = [], tierChanges = [];
  const inExcel = new Set();
  excel.forEach((r, i) => {
    inExcel.add(r.nid);
    const t = current.get(r.nid);
    const base = {
      member_id: t ? t.member_id : r.memberId, dept: r.dept, region: r.region, affiliation: r.note, note: r.note,
      reg_leads: r.regLeads, unreg_leads: r.unregLeads, counsel: r.counsel, gospel_room: r.gospelRoom,
      companion: r.companion, active_state: r.activeState, sort_order: i + 1,
    };
    if (!t) {
      added.push({ ...who(r), tier: r.tier });
      upserts.push({ ...base, name: r.name, position: '', tier: r.tier, tier_changed_at: null });
      return;
    }
    if (t.dept !== r.dept || t.region !== r.region) moved.push({ ...who(r), name: t.name, from: `${t.dept} ${t.region}`.trim(), to: `${r.dept} ${r.region}`.trim() });
    // 이름이 다르면: 고른 사람만 엑셀 이름으로, 나머지는 앱에서 쓰던 이름을 지킨다(앱에서 먼저 고친 개명일 수 있다).
    const takeName = t.name !== r.name && rename.has(r.nid);
    if (t.name !== r.name) renamed.push({ ...who(t), excelName: r.name, apply: takeName });
    const currentTier = t.tier || '활동교사';
    const takeTier = options.applyTiers && currentTier !== r.tier;
    if (currentTier !== r.tier) tierChanges.push({ ...who(t), from: currentTier, to: r.tier });
    upserts.push({
      ...base, name: takeName ? r.name : t.name, position: t.position,
      tier: takeTier ? r.tier : t.tier, tier_changed_at: takeTier ? today : t.tier_changed_at,
      _history: takeTier ? { name: t.name, from: currentTier, to: r.tier } : null,
    });
  });

  // 엑셀에 없는 사람: 고른 사람은 남기고(맨 뒤에 붙인다), 나머지는 명단에서 뺀다.
  const missing = teachers.filter((t) => !inExcel.has(t.nid));
  const removed = [], kept = [], removeIds = [];
  for (const t of missing) {
    const info = { ...who(t), position: t.position, tier: t.tier, adminPosition: adminOf.get(t.nid)?.position || '' };
    if (keep.has(t.nid)) {
      kept.push(info);
      upserts.push({
        member_id: t.member_id, name: t.name, dept: t.dept, region: t.region, affiliation: t.affiliation, note: t.note,
        position: t.position, tier: t.tier, tier_changed_at: t.tier_changed_at, reg_leads: t.reg_leads, unreg_leads: t.unreg_leads,
        counsel: t.counsel, gospel_room: t.gospel_room, companion: t.companion, active_state: t.active_state,
        sort_order: excel.length + kept.length,
      });
    } else {
      removed.push(info);
      removeIds.push(t.member_id);
    }
  }
  return { teachers, upserts, removeIds, added, moved, renamed, tierChanges, removed, kept };
}

const capped = (list) => ({ count: list.length, rows: list.slice(0, LIST_CAP) });

/** 화면에 보여 줄 요약. */
function summarize(p, excel, options) {
  const tierTotals = {};
  for (const u of p.upserts) { const t = u.tier || '활동교사'; tierTotals[t] = (tierTotals[t] || 0) + 1; }
  return {
    before: p.teachers.length, after: p.upserts.length, excelRows: excel.length, applyTiers: !!options.applyTiers,
    added: capped(p.added), removed: capped(p.removed), kept: capped(p.kept), moved: capped(p.moved),
    renamed: capped(p.renamed), tierChanges: capped(p.tierChanges), tierTotals,
  };
}

/** 엑셀이 엉뚱한 탭·파일이면 반영을 막는다. */
function sanityError(excel, teacherCount) {
  if (excel.length < 100) return `엑셀에서 읽은 사람이 ${excel.length}명뿐이에요. 파일과 탭을 다시 확인해 주세요.`;
  if (teacherCount && excel.length < teacherCount * 0.7) {
    return `엑셀 명단(${excel.length}명)이 지금 명단(${teacherCount}명)보다 너무 적어요. 다른 달 탭이 아닌지 확인해 주세요.`;
  }
  return '';
}

const optionsOf = (body) => ({ applyTiers: !!body.applyTiers, renameIds: body.renameIds, keepIds: body.keepIds });

/** 미리보기: 아무것도 바꾸지 않고, 반영하면 무엇이 달라지는지만 돌려준다. */
async function previewRosterImport(body) {
  const mid = clip(body.memberId, 40);
  if (!mid || !(await isApprover(mid))) return DENIED;
  const excel = cleanRows(body.rows);
  const p = await plan(excel, optionsOf(body));
  const problem = sanityError(excel, p.teachers.length);
  return problem ? { error: problem } : { ok: true, ...summarize(p, excel, optionsOf(body)) };
}

/** 반영: 직전 명단을 통째로 남겨 두고, 한 번에 바꾼 뒤, 등급 변경 이력과 변경 기록을 남긴다. */
async function applyRosterImport(body) {
  const mid = clip(body.memberId, 40);
  if (!mid || !(await isApprover(mid))) return DENIED;
  const options = optionsOf(body);
  const excel = cleanRows(body.rows);
  const p = await plan(excel, options);
  const problem = sanityError(excel, p.teachers.length);
  if (problem) return { error: problem };
  // 미리보기에서 본 숫자와 달라졌으면(그 사이 누가 명단을 고쳤으면) 다시 보게 한다.
  if (body.expectAfter != null && Number(body.expectAfter) !== p.upserts.length) {
    return { error: '미리보기 뒤에 명단이 바뀌었어요. 다시 미리보기를 눌러 확인해 주세요.' };
  }

  const { teacher, admin } = await memberInfo(mid);
  const actor = { id: mid, name: admin?.name || teacher?.name || clip(body.name, 40) };
  const now = kstDateTime();
  const source = clip(body.source, 120) || '교사관리 엑셀';
  const [snapshot] = await run(db().from('roster_snapshots').insert({
    taken_at: now, actor_id: actor.id, actor_name: actor.name, reason: source + ' 반영 직전', teachers: p.teachers,
  }).select('id'));

  const history = p.upserts.filter((u) => u._history).map((u) => ({
    changed_on: kstDate(), member_id: u.member_id, name: u._history.name, prev_tier: u._history.from, new_tier: u._history.to,
    reason: source + ' 반영', approver1: actor.name,
  }));
  const result = await run(db().rpc('roster_apply', { p_rows: p.upserts.map(({ _history, ...u }) => u), p_remove: p.removeIds }));
  forgetRoster();
  for (let i = 0; i < history.length; i += 500) await run(db().from('tier_history').insert(history.slice(i, i + 500)));

  const summary = summarize(p, excel, options);
  await run(db().from('roster_changes').insert({
    changed_at: now, actor_id: actor.id, actor_name: actor.name, kind: '엑셀 반영', target_id: '', target_name: source,
    before: { 인원: summary.before },
    after: {
      인원: summary.after, 추가: summary.added.count, 삭제: summary.removed.count, 유지: summary.kept.count,
      '부서·지역 변경': summary.moved.count, '이름 변경': summary.renamed.rows.filter((r) => r.apply).length,
      '등급 변경': options.applyTiers ? summary.tierChanges.count : 0, 스냅샷: snapshot.id,
    },
  }));
  return { ok: true, ...summary, saved: result.saved, removedCount: result.removed, snapshotId: snapshot.id };
}

export default { previewRosterImport, applyRosterImport };
