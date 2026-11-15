// 월별 교사관리 엑셀 반영: 화면이 엑셀에서 뽑은 명단을 보내면, 무엇이 바뀌는지 먼저 보여 주고(미리보기) 확인을 받아 반영한다.
// 엑셀에 있는 사람 = 이번 달 명단. 직책은 앱의 값을 유지한다. 이름·등급·빠지는 사람은 화면에서 고른 대로 따른다.
import { createHash } from 'node:crypto';
import { db, run } from '../lib/db.js';
import { normId, kstDate } from '../lib/util.js';
import { clip } from '../lib/input.js';
import { TEACHER_TIERS, memberInfo, isApprover, isEvangelism, forgetRoster } from './roster.js';

const DENIED = { error: '명단 관리는 교육부·전도부 담당만 할 수 있어요.' };
const LIST_CAP = 300;   // 미리보기 목록은 종류마다 이만큼까지만(건수는 전부 센다)
// 개명 등으로 엑셀(행정 명단)과 상관없이 늘 이 이름으로 둘 사람: nid → 이름
const FIXED_NAMES = {
  '22082400021': '정다감',   // 00220824-00021 옛 이름 정민경, 개명(2026-10-18 요청)
};
// 11/3(사용자): 엑셀과 상관없이 늘 이 부서·지역(회장단 방으로 보고). 엑셀에 없어도 명단에서 빼지 않는다.
const FIXED_PLACE = {
  '21011800020': { dept: '부녀회', region: '기타', affiliation: '기타회장단', note: '기타회장단' },   // 이경원 부녀회장
  '23032000007': { dept: '부녀회', region: '기타', affiliation: '기타회장단', note: '기타회장단' },   // 김경아 부녀회 총무(엑셀엔 교역자·교회)
};

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
    // 11/4: 신43 교사활동현황 서식(format 'activity') — 센터등록·미등록 칸이 없어 앱 값을 그대로 두고, 그 달 기록(monthStats)을 담는다.
    //   구분이 '기타' 등이면 tier '' → 앱의 지금 등급 유지(새 사람은 활동교사).
    const activity = r.format === 'activity';
    const ms = activity && r.monthStats && typeof r.monthStats === 'object'
      ? Object.fromEntries(Object.entries(r.monthStats).slice(0, 20).map(([k, v]) => [clip(k, 20), typeof v === 'number' ? count(v) : clip(v, 20)])) : null;
    out.push({
      memberId, nid, name, dept: clip(r.dept, 20), region: clip(r.region, 20), note: clip(r.note, 60),
      regLeads: count(r.regLeads), unregLeads: count(r.unregLeads), counsel: count(r.counsel),
      gospelRoom: count(r.gospelRoom), companion: count(r.companion), activeState: clip(r.activeState, 20),
      tier: TEACHER_TIERS.includes(r.tier) ? r.tier : activity ? '' : '활동교사',
      activity, monthStats: ms,
    });
  }
  return out;
}

/**
 * 지금 명단과 엑셀을 견주어 바뀔 내용을 만든다.
 * options: applyTiers(등급도 엑셀 기준으로), renameIds(엑셀 이름으로 바꿀 사람), keepIds(엑셀에 없어도 남길 사람)
 */
async function plan(excel, options) {
  const {teachers, admins, revision} = await run(db().rpc('roster_import_state'));
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
      reg_leads: r.activity && t ? t.reg_leads : r.regLeads, unreg_leads: r.activity && t ? t.unreg_leads : r.unregLeads,
      counsel: r.counsel, gospel_room: r.gospelRoom,
      companion: r.companion, active_state: r.activeState, month_stats: r.activity ? r.monthStats : (t ? t.month_stats : null), sort_order: i + 1,
      ...(FIXED_PLACE[r.nid] || {}),
    };
    if (!t) {
      const tier = options.canChangeTier ? (r.tier || '활동교사') : '활동교사';
      added.push({ ...who(r), tier });
      upserts.push({ ...base, name: FIXED_NAMES[r.nid] || r.name, position: '', tier, tier_changed_at: options.tierDate || null });
      return;
    }
    if (!FIXED_PLACE[r.nid] && (t.dept !== r.dept || t.region !== r.region)) moved.push({ ...who(r), name: t.name, from: `${t.dept} ${t.region}`.trim(), to: `${r.dept} ${r.region}`.trim() });
    // 이름이 다르면: 고른 사람만 엑셀 이름으로, 나머지는 앱에서 쓰던 이름을 지킨다(앱에서 먼저 고친 개명일 수 있다).
    // FIXED_NAMES에 있는 사람은 고를 것 없이 늘 그 이름.
    const fixedName = FIXED_NAMES[r.nid];
    const takeName = !fixedName && t.name !== r.name && rename.has(r.nid);
    if (!fixedName && t.name !== r.name) renamed.push({ ...who(t), excelName: r.name, apply: takeName });
    const currentTier = t.tier || '활동교사';
    const excelTier = r.tier || currentTier;   // 엑셀 구분이 '기타'면 지금 등급 그대로
    const takeTier = options.applyTiers && currentTier !== excelTier;
    if (currentTier !== excelTier) tierChanges.push({ ...who(t), from: currentTier, to: excelTier });
    upserts.push({
      ...base, name: fixedName || (takeName ? r.name : t.name), position: t.position,
      tier: takeTier ? excelTier : t.tier, tier_changed_at: takeTier ? (options.tierDate || today) : t.tier_changed_at,
      _history: takeTier ? { name: t.name, from: currentTier, to: excelTier } : null,
    });
  });

  // 엑셀에 없는 사람: 고른 사람은 남기고(맨 뒤에 붙인다), 나머지는 명단에서 뺀다.
  const missing = teachers.filter((t) => !inExcel.has(t.nid));
  const removed = [], kept = [], removeIds = [];
  for (const t of missing) {
    const info = { ...who(t), position: t.position, tier: t.tier, adminPosition: adminOf.get(t.nid)?.position || '' };
    if (keep.has(t.nid) || FIXED_PLACE[t.nid]) {
      kept.push(info);
      upserts.push({
        member_id: t.member_id, name: t.name, dept: t.dept, region: t.region, affiliation: t.affiliation, note: t.note,
        position: t.position, tier: t.tier, tier_changed_at: t.tier_changed_at, reg_leads: t.reg_leads, unreg_leads: t.unreg_leads,
        counsel: t.counsel, gospel_room: t.gospel_room, companion: t.companion, active_state: t.active_state,
        month_stats: t.month_stats, sort_order: excel.length + kept.length,
      });
    } else {
      removed.push(info);
      removeIds.push(t.member_id);
    }
  }
  return { teachers, revision, upserts, removeIds, added, moved, renamed, tierChanges, removed, kept };
}

const listed = (list, all) => ({ count: list.length, rows: all ? list : list.slice(0, LIST_CAP) });

/** 화면에 보여 줄 요약. */
function summarize(p, excel, options, all = false) {
  const capped = list => listed(list, all);
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

// tierDate: 등급 적용일(예: 11/5 시작) — 비우면 오늘
const optionsOf = (body) => ({ applyTiers: !!body.applyTiers, renameIds: body.renameIds, keepIds: body.keepIds,
  tierDate: /^\d{4}-\d{2}-\d{2}$/.test(String(body.tierDate || '')) ? String(body.tierDate) : '' });

// 미리본 원본 상태·파일 내용·선택 옵션이 같아야 확인 후 반영할 수 있다.
const reviewOf = (p, excel, options) => createHash('sha256').update(JSON.stringify([p.revision, excel, options])).digest('hex');
async function importOptions(body) {
  const canChangeTier = await isEvangelism(body.memberId);
  if (body.applyTiers && !canChangeTier) return { error: '엑셀 등급 반영은 전도 담당자만 할 수 있어요.' };
  return { ...optionsOf(body), canChangeTier };
}

/** 기본 목록 상한은 보존하고 새 화면은 전체 선택에 필요한 명단을 명시적으로 요청한다. */
async function previewRosterImport(body) {
  const mid = clip(body.memberId, 40);
  if (!mid || !(await isApprover(mid))) return DENIED;
  const options = await importOptions(body); if (options.error) return options;
  const excel = cleanRows(body.rows), p = await plan(excel, options);
  const problem = sanityError(excel, p.teachers.length);
  return problem ? { error: problem } : { ok: true, ...summarize(p, excel, options, body.detailsAll === true), review: reviewOf(p, excel, options) };
}

/** 미리보기 상태 확인과 실제 명단·이력·스냅샷 저장은 같은 DB 트랜잭션으로 처리한다. */
async function applyRosterImport(body) {
  const mid = clip(body.memberId, 40);
  if (!mid || !(await isApprover(mid))) return DENIED;
  const options = await importOptions(body); if (options.error) return options;
  const excel = cleanRows(body.rows), p = await plan(excel, options);
  const problem = sanityError(excel, p.teachers.length); if (problem) return { error: problem };
  if ((body.requireReview && !body.expectReview) || (body.expectReview && body.expectReview !== reviewOf(p, excel, options)) ||
      (body.expectAfter != null && Number(body.expectAfter) !== p.upserts.length)) {
    return { error: '미리보기 뒤에 명단이나 선택 내용이 바뀌었어요. 다시 미리보기를 확인해 주세요.', stale: true };
  }
  const { teacher, admin } = await memberInfo(mid);
  const actor = { id: mid, name: admin?.name || teacher?.name || clip(body.name, 40) };
  const source = clip(body.source, 120) || '교사관리 엑셀';
  const history = p.upserts.filter(u => u._history).map(u => ({changed_on:kstDate(),member_id:u.member_id,name:u._history.name,
    prev_tier:u._history.from,new_tier:u._history.to,reason:source+' 반영',approver1:actor.name}));
  const summary = summarize(p, excel, options);
  const result = await run(db().rpc('roster_apply_reviewed', { p: {
    revision:p.revision, rows:p.upserts.map(({_history,...row})=>row), remove:p.removeIds,
    actorId:actor.id,actorName:actor.name,source,history,before:{인원:summary.before},
    after:{인원:summary.after,추가:summary.added.count,삭제:summary.removed.count,유지:summary.kept.count,
      '부서·지역 변경':summary.moved.count,'이름 변경':p.renamed.filter(r=>r.apply).length,'등급 변경':options.applyTiers?summary.tierChanges.count:0},
  } }));
  if (result.error) return result;
  forgetRoster();
  return { ok:true,...summary,saved:result.saved,removedCount:result.removed,snapshotId:result.snapshotId };
}

export default { previewRosterImport, applyRosterImport };
