// 교육 관리 탭 — 화요전도단(화전단)·목요사명자교육(목사교) 주간 현황 + 부서 범위 공무 사전보고 (2026-11-16)
// 계약: docs/handoff/EDU_MGMT.md. 기본 꺼짐(EDU_MGMT_ENABLED=1 일 때만 동작) — 화면·조회·저장 모두 같은 스위치.
// 권한은 서버가 확인한 계정 기준:
//   manager = 앱 책임자, 또는 그 교육(정기교육/모임/과정)의 출석·자료 위임(기존 education_delegations)
//   head    = 앱 책임자가 지정한 24부서 소속 부서장(edu_dept_heads) — 자기 소속 사람만
// 공무 원본은 기존 cohort_summary_log('#excused') 그대로. 부서 저장은 edu_mgmt_scope_apply(소속 한 곳만 추가·해제).
// Telegram 발송·예약은 이 모듈에 없다(저장만으로 보고를 다시 보내지 않음).
import { db, run, selectAll } from '../lib/db.js';
import { requireActor, AccessError, withActor } from '../lib/request-context.js';
import { educationGrants, permits } from '../lib/education-access.js';
import { isOwner } from './roster.js';
import { normId } from '../lib/util.js';
import { eduFor, eduPeople, excusedOf, roster24 } from '../lib/edu-attendance.js';
import { weeklySummary, weeklyDetail, groupDefs, subDefs, affiliations, weeklyCsv } from '../lib/edu-weekly.js';

const fail = (message, status = 400) => { throw new AccessError(message, status); };
export const eduMgmtEnabled = () => process.env.EDU_MGMT_ENABLED === '1';
const KINDS = { 화전단: '화요전도단', 목사교: '목요사명자교육' };
const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
const requireOn = () => { if (!eduMgmtEnabled()) fail('교육 관리 기능이 아직 꺼져 있어요.', 503); };
const scopeOf = (m) => (m.cohortId ? ['cohort', m.cohortId] : m.seriesId ? ['series', m.seriesId] : ['meeting', m.meetingId]);

/** 이 계정의 역할. grants: null = 앱 책임자(전부). heads: 지정된 소속 목록. */
async function who() {
  const actor = requireActor();
  const [grants, heads] = await Promise.all([
    educationGrants(actor),
    run(db().from('edu_dept_heads').select('affiliation').eq('nid', actor.nid).eq('revoked', false)),
  ]);
  return { actor, grants, owner: grants === null, heads: [...new Set(heads.map((h) => h.affiliation))].sort() };
}
const managerOf = (w, m) => { const [t, id] = scopeOf(m); return permits(w.grants, t, id, 'attendance') || permits(w.grants, t, id, 'reports'); };
const editorOf = (w, m) => { const [t, id] = scopeOf(m); return permits(w.grants, t, id, 'attendance'); };

/** 그 주(월~일)의 두 교육 모임. 분류는 기존 edu_excused_state 와 같다. */
async function weekMeetings(date) {
  if (!validDate(date)) fail('날짜를 확인해 주세요.');
  const d = new Date(date + 'T00:00:00Z'), dow = (d.getUTCDay() + 6) % 7;
  const from = new Date(d - dow * 864e5).toISOString().slice(0, 10), to = new Date(+d + (6 - dow) * 864e5).toISOString().slice(0, 10);
  const [rows, series] = await Promise.all([
    run(db().from('attend_meetings').select('*').gte('date', from).lte('date', to).neq('status', '삭제').order('date').order('id')),
    run(db().from('attend_series').select('series_id, title, roster_key, status').neq('status', '삭제')),
  ]);
  const sOf = new Map(series.map((s) => [s.series_id, s]));
  const { findMeeting } = await import('./attendance.js');
  const out = [];
  for (const r of rows) {
    if (String(r.title || '').startsWith('[TEST]')) continue;
    if (r.series_id && !sOf.has(r.series_id)) continue;
    const kind = /화요전도단|화전단/.test(r.title || '') ? '화전단' : sOf.get(r.series_id)?.roster_key === '목요사명자' ? '목사교' : null;
    if (!kind) continue;
    const m = await findMeeting(r.meeting_id);
    if (m) out.push({ kind, m });
  }
  out.sort((a, b) => (a.m.date < b.m.date ? -1 : a.m.date > b.m.date ? 1 : a.kind < b.kind ? -1 : 1));
  return { week: { from, to }, list: out };
}

/** 모임 하나의 재적·출석(기존 eduPeople 그대로). 권한 확인은 호출 전에 끝낸다. */
async function computeMeeting(kind, m) {
  // closingData 는 사람 요청이면 자료 위임을 다시 묻는다 — 이미 위에서 범위를 확인했으므로 내부 계산으로 실행하고 범위만 잘라 돌려준다.
  return withActor({ cron: true, purpose: 'edu-mgmt' }, async () => {
    let edu = await eduFor(m), basis = 'full';
    if (!edu) {
      const [roster, policies] = await Promise.all([roster24(), run(db().from('edu_roster_policy').select('excluded_positions, always_present_nids, dept_overrides').eq('roster_key', '목요사명자'))]);
      if (!roster.length || !policies.length) fail('24부서 재적과 확인된 교육 집계 기준이 필요해요.', 409);
      edu = { series: { series_id: m.seriesId || '', title: m.title, roster_key: '목요사명자' }, roster, policy: policies[0] };
      basis = '24';
    }
    const [P, ex] = await Promise.all([eduPeople(m, '최종', edu), excusedOf(kind, m.date)]);
    return { P, ex, basis };
  });
}
const basisLabel = (b) => (b === 'full' ? '교육 대상 재적' : '24부서 사명자 재적(대상 재적 확인 필요)');

/** 화면 진입 판단: 기능이 켜져 있고 볼 수 있는 역할이 있는지. 꺼져 있으면 아무것도 조회하지 않는다. */
export async function eduMgmtAccess() {
  if (!eduMgmtEnabled()) return { enabled: false };
  const w = await who();
  const manager = w.owner || w.grants.some((g) => g.permissions.includes('attendance') || g.permissions.includes('reports'));
  return { enabled: true, owner: w.owner, manager, heads: w.heads, visible: manager || w.heads.length > 0 };
}

export async function getEduWeekly(body = {}) {
  requireOn();
  const w = await who(), { week, list } = await weekMeetings(String(body.date || ''));
  const items = [];
  for (const { kind, m } of list) {
    const full = managerOf(w, m);
    if (!full && !w.heads.length) continue;
    const { P, ex, basis } = await computeMeeting(kind, m);
    const people = full ? P.people : P.people.filter((p) => p.dept === '24부서' && w.heads.includes(p.affiliation || '기타'));
    if (!people.length) continue;
    const s = full ? weeklySummary(people, P.sessions, ex, basis) : weeklySummary(people, P.sessions, ex, '24');
    items.push({ kind, kindLabel: KINDS[kind], meetingId: m.meetingId, title: m.title, date: m.date, sessions: P.sessions, basis, basisLabel: basisLabel(basis), scope: full ? 'all' : 'dept', ...s });
  }
  return { week, items };
}

export async function getEduWeeklyDetail(body = {}) {
  requireOn();
  const w = await who(), meetingId = String(body.meetingId || ''), key = String(body.group || '');
  const { list } = await weekMeetings(String(body.date || ''));
  const hit = list.find((x) => x.m.meetingId === meetingId);
  if (!hit) fail('이 주의 교육이 아니에요. 다시 조회해 주세요.', 404);
  const full = managerOf(w, hit.m);
  const { P, ex, basis } = await computeMeeting(hit.kind, hit.m);
  const people = full ? P.people : P.people.filter((p) => p.dept === '24부서' && w.heads.includes(p.affiliation || '기타'));
  const defs = full ? groupDefs(people, basis) : groupDefs(people, '24');
  const group = defs.find((g) => g.key === key);
  if (!group || !people.some(group.test)) fail('볼 수 있는 조직이 아니에요.', 403);
  return { kind: hit.kind, meetingId, date: hit.m.date, title: hit.m.title, group: { key: group.key, label: group.label }, sessions: P.sessions, hasSub: subDefs(people, group).length > 0, ...weeklyDetail(people, P.sessions, ex, group) };
}

export async function exportEduWeekly(body = {}) {
  const data = await getEduWeekly(body);
  return { filename: `주간교육출석_${data.week.from}.csv`, mime: 'text/csv;charset=utf-8', text: weeklyCsv(data.week, data.items) };
}

// ── 공무 사전보고(부서 범위) ─────────────────────────────────────────
/** kind·date 전체를 맡은 manager 인지 — 기존 전체 공무 화면과 같은 기준(같은 날 반영되는 모든 교육의 출석 권한). */
async function excusedManager(w, kind, date) {
  if (!KINDS[kind] || !validDate(date)) fail('교육 종류와 날짜를 확인해 주세요.');
  if (w.owner) return true;
  if (!w.grants.length) return false;
  const state = await run(db().rpc('edu_excused_state', { p_kind: kind, p_date: date }));
  return state.scopes.length > 0 && state.scopes.every((s) => permits(w.grants, s.type, s.id, 'attendance'));
}
/** 이 소속에 대한 역할: 지정된 부서장이면 head(자기 소속), 아니면 manager, 둘 다 아니면 거절. */
async function excusedRole(w, kind, date, aff) {
  const manager = await excusedManager(w, kind, date);
  if (!aff || typeof aff !== 'string') fail('소속 부서를 골라 주세요.');
  if (w.heads.includes(aff)) return 'head';
  if (manager) return 'manager';
  fail('이 부서의 공무 보고 권한이 없어요.', 403);
}

export async function getEduExcusedScope(body = {}) {
  requireOn();
  const w = await who(), kind = String(body.kind || ''), date = String(body.date || ''), aff = String(body.affiliation || '');
  const manager = await excusedManager(w, kind, date);
  const affs = affiliations(await roster24());
  const options = manager ? affs.map((a) => a.name) : affs.map((a) => a.name).filter((a) => w.heads.includes(a));
  if (!options.length) fail('공무 보고를 맡은 부서가 없어요.', 403);
  const target = aff || options[0];
  if (!options.includes(target)) fail('이 부서의 공무 보고 권한이 없어요.', 403);
  const role = w.heads.includes(target) ? 'head' : 'manager';
  const [state, log] = await Promise.all([
    run(db().rpc('edu_mgmt_scope_state', { p_kind: kind, p_date: date, p_aff: target })),
    run(db().from('edu_excused_detail_log').select('id, nid, action, actor_name, actor_role, before, after, created_at').eq('kind', kind).eq('date', date).eq('affiliation', target).order('id', { ascending: false }).limit(100)),
  ]);
  const selected = new Set(state.selected), detailOf = new Map(state.details.map((d) => [d.nid, d]));
  const nameOf = new Map(state.people.map((p) => [p.nid, p.name]));
  return {
    kind, date, affiliation: target, role, revision: state.revision, options,
    people: state.people.map((p) => {
      const d = detailOf.get(p.nid), on = selected.has(p.nid);
      return { memberId: p.nid, name: p.name, position: p.position || '', excused: on,
        source: on ? (d?.active ? 'dept' : 'list') : d?.active ? 'released' : '',
        reason: d?.reason || '', followMethod: d?.followMethod || '', followResult: d?.followResult || '', followDone: !!d?.followDone,
        version: d?.version ?? null, updatedAt: d?.updatedAt || null };
    }),
    history: log.map((h) => ({ id: h.id, memberId: h.nid, name: nameOf.get(h.nid) || '', action: h.action, actorName: h.actor_name, actorRole: h.actor_role, at: h.created_at,
      reason: (h.after || {}).reason ?? '', cancelReason: (h.after || {}).cancelReason ?? '', followMethod: (h.after || {}).follow_method ?? '', followResult: (h.after || {}).follow_result ?? '', followDone: !!(h.after || {}).follow_done })),
  };
}

export async function applyEduExcusedScope(body = {}) {
  requireOn();
  const w = await who(), kind = String(body.kind || ''), date = String(body.date || ''), aff = String(body.affiliation || '');
  const role = await excusedRole(w, kind, date, aff);
  if (!Array.isArray(body.changes) || !body.changes.length || body.changes.length > 300) fail('바꿀 사람을 골라 주세요.');
  const changes = body.changes.map((c) => ({ nid: String(c?.memberId || ''), op: c?.op === 'cancel' ? 'cancel' : c?.op === 'register' ? 'register' : '', reason: String(c?.reason || '').trim(), followMethod: String(c?.followMethod || '').trim() }));
  if (changes.some((c) => !c.nid || !c.op || c.reason.length > 300 || c.followMethod.length > 300 || (c.op === 'register' && !c.reason))) fail('사람마다 공무 사유(300자 이내)를 적어 주세요.');
  if (new Set(changes.map((c) => c.nid)).size !== changes.length) fail('같은 사람이 두 번 들어 있어요.');
  let result;
  try {
    result = await run(db().rpc('edu_mgmt_scope_apply', { p: { kind, date, affiliation: aff, revision: String(body.revision || ''), actorId: w.actor.nid, actorName: w.actor.name || '', actorRole: role, changes } }));
  } catch (e) {
    if (/outside affiliation|not excused|invalid scoped|duplicate scoped/.test(e.message || '')) fail('이 부서 명단에 없는 사람이거나 이미 해제된 사람이 있어요. 다시 조회해 주세요.', 409);
    throw e;
  }
  if (result.error) fail(result.error, result.forbidden ? 403 : 409);
  return result;
}

export async function saveEduExcusedFollowup(body = {}) {
  requireOn();
  const w = await who(), kind = String(body.kind || ''), date = String(body.date || ''), aff = String(body.affiliation || '');
  const role = await excusedRole(w, kind, date, aff);
  const method = String(body.followMethod || '').trim(), resultText = String(body.followResult || '').trim();
  if (method.length > 300 || resultText.length > 500 || typeof body.followDone !== 'boolean') fail('교육 방법은 300자, 결과는 500자 이내로 적어 주세요.');
  // 부서장은 자기 소속 사람만: 소속 명단에 있는지 확인(SQL 에서도 상세의 소속으로 다시 확인).
  const state = await run(db().rpc('edu_mgmt_scope_state', { p_kind: kind, p_date: date, p_aff: aff }));
  if (!state.people.some((p) => p.nid === String(body.memberId || ''))) fail('이 부서 명단에 없는 사람이에요.', 403);
  const r = await run(db().rpc('edu_mgmt_followup_apply', { p: { kind, date, nid: String(body.memberId), version: Number(body.version), followMethod: method, followResult: resultText, followDone: body.followDone, actorId: w.actor.nid, actorName: w.actor.name || '', actorRole: role } }));
  if (r.error) fail(r.error, r.forbidden ? 403 : 409);
  return r;
}

// ── 부서장 지정(앱 책임자만) ─────────────────────────────────────────
export async function listEduDeptHeads() {
  requireOn();
  const w = await who();
  if (!w.owner) fail('앱 책임자만 부서장을 지정할 수 있어요.', 403);
  const [rows, roster] = await Promise.all([
    run(db().from('edu_dept_heads').select('id, nid, affiliation, granted_at').eq('revoked', false).order('affiliation').order('id')),
    roster24(),
  ]);
  const nameOf = new Map(roster.map((p) => [p.nid, p.name]));
  return { affiliations: affiliations(roster).map((a) => a.name), heads: rows.map((h) => ({ memberId: h.nid, name: nameOf.get(h.nid) || '(재적 밖)', affiliation: h.affiliation, at: h.granted_at })) };
}
export async function setEduDeptHead(body = {}) {
  requireOn();
  const w = await who();
  if (!w.owner) fail('앱 책임자만 부서장을 지정할 수 있어요.', 403);
  const nid = normId(String(body.memberId || '')), aff = String(body.affiliation || ''), op = body.op === 'revoke' ? 'revoke' : body.op === 'grant' ? 'grant' : '';
  if (!nid || !aff || !op) fail('부서장 고유번호와 소속을 확인해 주세요.');
  const r = await run(db().rpc('edu_dept_head_apply', { p: { op, nid, affiliation: aff, actorId: w.actor.nid } }));
  if (r.error) fail(r.error, 409);
  return r;
}

export default { eduMgmtAccess, getEduWeekly, getEduWeeklyDetail, exportEduWeekly, getEduExcusedScope, applyEduExcusedScope, saveEduExcusedFollowup, listEduDeptHeads, setEduDeptHead };
