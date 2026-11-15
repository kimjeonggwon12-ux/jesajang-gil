import {createHash} from 'node:crypto';
import {canManagePilot} from '../lib/pilot.js';
import {isSystemOwner} from '../lib/system-owner.js';
import {sensitiveActor} from '../lib/sensitive-actor.js';
import { educationCandidates } from '../../shared/education-search.js';
// 교사명단 · 관리자 명단
import { invalidateDirectory } from '../lib/directory-cache.js';
import { db, run, selectAll } from '../lib/db.js';
import { normId, str } from '../lib/util.js';
import { currentActor, requireActor, AccessError } from '../lib/request-context.js';

// 교사구분(낮음→높음). 프런트에는 getRoster 응답의 tiers 로 내려간다.
// 11/5(사용자·서무님): 엑셀 구분 '기타'(교육 미참석, 활동 또는 인교 1명 이상)를 교사광장에서도 '기타'로 — 휴교사와 활동교사 사이
export const TEACHER_TIERS = ['휴교사', '기타', '활동교사', '정교사', '우수교사'];

// 관리자 화면에 들어갈 수 있는 직책. ⚠️ app.html 의 ADMIN_POSITIONS 와 같은 값이어야 한다.
const LEADER_POSITIONS = ['회장', '총무', '지역장', '섭외 교관', '복음방 교관', '교육부장', '전도부장', '전도과장',
  '전도팀장', '서기', '전도 과장', '교육 과장', '교관', '총교관', '교육부', ''];

/** DB 행 → 프런트가 받는 명단 행. */
export function toRosterRow(t) {
  return {
    memberId: t.member_id,
    name: t.name,
    dept: t.dept,
    region: t.region,
    affiliation: t.affiliation,
    position: t.position,
    tier: t.tier,
    note: t.note,
    tierChangedAt: t.tier_changed_at || '',
    regLeads: t.reg_leads,
    unregLeads: t.unreg_leads,
    counsel: t.counsel,
    gospelRoom: t.gospel_room,
    companion: t.companion,
    activeState: t.active_state,
    monthStats: t.month_stats || null,   // 11/4: 신43 교사활동현황 엑셀의 그 달 기록(교육~섬김·구분)
  };
}

/** 고유번호로 교사 한 명(없으면 null). */
export async function findTeacher(memberId) {
  const rows = await run(db().from('teachers').select('*').eq('nid', normId(memberId)).order('sort_order').limit(1));
  return rows[0] || null;
}

/**
 * 11/3(사용자: "뭔가 기록하면 다 올라가게"): 고유번호로 못 찾으면(한 자리 틀림·빠짐) 이름으로 — 교사명단에 그 이름이 한 명일 때만.
 */
export async function findTeacherLoose(memberId, name) {
  const t = await findTeacher(memberId);
  if (t) return t;
  if (String(name || '').trim()) {
    const rows = await run(db().from('teachers').select('*').eq('name', String(name).trim()).limit(2));
    if (rows.length === 1) return rows[0];
  }
  // 11/3(사용자: 이경원 부녀회장 보고가 회장단 방에 안 올라옴): 교사명단엔 없고 관리자 명단에만 있는 분 → 관리자 명단의 부서·지역으로
  const [a] = await run(db().from('admins').select('member_id, nid, name, dept, region, position, affiliation').eq('nid', normId(memberId)).limit(1));
  return a ? { ...a, affiliation: a.affiliation || '', note: '', fromAdmins: true } : null;
}

/** nid 들 중 교사명단에 없는 것을 관리자 명단(부서·지역)으로 채운다 — 보고방 일일 보고·총합에서 관리자만인 분도 세게. */
export async function adminsAsTeachers(nids) {
  if (!nids.length) return [];
  const rows = await run(db().from('admins').select('nid, name, dept, region, affiliation').in('nid', nids));
  return rows.map((a) => ({ ...a, affiliation: a.affiliation || '', note: '' }));
}

/**
 * 11/3(사용자: "올리지는 말고 카운트만 되게"): 고유번호를 잘못 넣고 남긴 활동 기록 — 명단에 그 번호가 없고 이름이 명단에 한 명이면
 * 그 교사의 번호(nid)로 바꿔 센다(메모리에서만, 기록 자체는 그대로). acts = [{ nid, name, ... }] 를 고쳐서 돌려준다.
 */
export async function fixActivityNids(acts) {
  if (!acts.length) return acts;
  const roster = await allTeachers();
  const known = new Set(roster.map((t) => t.nid));
  const byName = new Map();
  for (const t of roster) byName.set(t.name, byName.has(t.name) ? null : t.nid);   // 같은 이름이 둘 이상이면 null
  for (const a of acts) {
    if (!a.nid || known.has(a.nid)) continue;
    const nid = byName.get(String(a.name || '').trim());
    if (nid) a.nid = nid;
  }
  return acts;
}

/** 고유번호로 관리자 명단 한 줄(없으면 null). */
export async function findAdmin(memberId) {
  const rows = await run(db().from('admins').select('name, position, dept').eq('nid', normId(memberId)).order('id').limit(1));
  return rows[0] || null;
}

/** 한 사람의 명단 행과 관리자 명단 행을 DB 한 번에. */
export async function memberInfo(memberId) {
  const actor = currentActor();
  if (actor && actor.nid === normId(memberId) && actor.admins) {
    return { teacher: actor.teacher, admin: actor.admins[0] || null };
  }
  const info = await run(db().rpc('member_info', { p_nid: normId(memberId) }));
  return { teacher: info?.teacher || null, admin: info?.admin || null };
}

/** 겸직을 빠짐없이 읽는다. 요청 안에서 확인한 자료만 재사용한다. */
export async function memberRoles(memberId) {
  const actor = currentActor(), nid = normId(memberId);
  if (actor?.nid === nid && actor.admins) return { teacher: actor.teacher, admins: actor.admins };
  const [teacher, admins] = await Promise.all([
    findTeacher(memberId), run(db().from('admins').select('*').eq('nid', nid).order('id')),
  ]);
  return { teacher, admins };
}

const compact = (v) => String(v || '').replace(/\s/g, '');
export const hasDuty = (row, area) => !!row && (compact(row.dept) === area + '부'
  || new Set([area + '부', area + '부장', area + '과장', area + '팀장', area + '담당', area + '사명자']).has(compact(row.position)));

export async function isEvangelism(memberId) {
  if (isSystemOwner(memberId)) return true;
  const { teacher, admins } = await memberRoles(memberId);
  return [teacher, ...admins].some((row) => hasDuty(row, '전도'));
}

export async function requireApprover() {
  const actor = requireActor();
  if (!(await isApprover(actor.memberId))) throw new AccessError('교육·전도 담당자만 할 수 있어요.');
  return actor;
}

// ── 명단 전체 ── 여러 화면이 연달아 읽으므로 10초 동안 기억해 둔다(그 사이 DB 는 한 번만 읽는다).
const ROSTER_TTL_MS = 10_000;
let rosterCache = null;   // { at, rows: Promise<DB 행[]> }

/** 명단을 고친 뒤에 부른다 — 다음 조회는 DB 에서 새로 읽는다. */
export function forgetRoster() { rosterCache = null; invalidateDirectory(); }

function allTeachers() {
  if (!rosterCache || Date.now() - rosterCache.at > ROSTER_TTL_MS) {
    const rows = selectAll(() => db().from('teachers').select('*').order('sort_order').order('member_id'), 3);
    rosterCache = { at: Date.now(), rows };
    rows.catch(() => { if (rosterCache?.rows === rows) rosterCache = null; });
  }
  return rosterCache.rows;
}

/**
 * 명단(시트에 있던 순서). 부서·지역을 주면 그 범위만.
 * 기억해 둔 명단이 있으면 거기서 고르고, 없으면 필요한 범위만 DB 에서 읽는다.
 */
export async function loadRoster({ dept, region } = {}) {
  const inScope = (t) => (!dept || t.dept === dept) && (!region || t.region === region);
  if ((!dept && !region) || (rosterCache && Date.now() - rosterCache.at <= ROSTER_TTL_MS)) {
    return (await allTeachers()).filter(inScope).map(toRosterRow);
  }
  const rows = await selectAll(() => {
    let q = db().from('teachers').select('*');
    if (dept) q = q.eq('dept', dept);
    if (region) q = q.eq('region', region);
    return q.order('sort_order').order('member_id');
  });
  return rows.map(toRosterRow);
}

/** 부서·등급별 교사 수(DB 가 센다): [{ dept, tier, n }] */
export const rosterCounts = async () => (await run(db().rpc('roster_counts'))).map((c) => ({ ...c, n: Number(c.n) }));

/** 여러 사람의 명단 정보를 한 번에: 정규화 번호 → 명단 행(없는 사람은 빠진다). */
export async function teachersByNid(memberIds) {
  const nids = [...new Set(memberIds.map(normId))].filter((n) => n !== '0');
  const map = new Map();
  for (let i = 0; i < nids.length; i += 200) {
    const rows = await run(db().from('teachers').select('*').in('nid', nids.slice(i, i + 200)).order('sort_order'));
    for (const t of rows) map.set(t.nid, toRosterRow(t));
  }
  return map;
}

const OWNER_NID = '20113000010';   // 앱 관리자(김정권) 계정
const ADMIN_POSITIONS = LEADER_POSITIONS.filter(Boolean);

/** 광장·일정·영상의 관리자 권한: 관리자 명단에 있거나, 명단 직책·부서(교역자)·소속비고(센터)로 판정. */
export async function isAdmin(memberId) {
  if (isOwner(memberId)) return true;
  const { admins, teacher } = await memberRoles(memberId);
  if (admins.length) return true;
  if (!teacher) return false;
  return ADMIN_POSITIONS.includes(teacher.position.trim()) || teacher.dept.trim() === '교역자' || teacher.note.includes('센터');
}

export const isOwner = (memberId) => isSystemOwner(memberId) || normId(memberId) === OWNER_NID;

/** 교육·전도 담당 관리자(또는 앱 관리자): 영상 승인, 명단 관리처럼 한 단계 높은 권한. */
export async function isApprover(memberId) {
  if (isOwner(memberId)) return true;
  const { teacher, admins } = await memberRoles(memberId);
  return [teacher, ...admins].some((row) => hasDuty(row, '교육') || hasDuty(row, '전도'));
}

/** 그 부서·지역을 맡은 교관(관리자 명단에서 직책에 '교관'이 들어간 사람). */
export async function findCoaches(dept, region) {
  if (!dept || !region) return [];
  return run(db().from('admins').select('member_id, name, position, dept, region')
    .eq('dept', dept).eq('region', region).like('position', '%교관%').order('id'));
}

const getRoster = async (body = {}) => {
  let rows = await loadRoster();
  // 기존 전체 조회 계약은 유지하고, 명시한 이수 검색만 번호 가림 전에 대조한다.
  if (body.indexOnly === true && Object.hasOwn(body, 'query')) rows = educationCandidates(rows, String(body.query || ''), String(body.dept || ''));
  return { rows: body.indexOnly === true ? rows.map(({ memberId, name, dept, region, tier }) => ({ memberId, name, dept, region, tier })) : rows, tiers: TEACHER_TIERS };
};

async function checkAdmin(body) {
  const mid = str(body.memberId);
  if (!mid) return { isAdmin: false };
  const { admin, teacher } = await memberInfo(mid);
  const roster = teacher ? toRosterRow(teacher) : null;
  const permissions = { canManagePilot: canManagePilot(mid), canViewBackupStatus: isSystemOwner(mid), canManageBackup: isOwner(mid), canManageRoster: await isApprover(mid), canExportTeachers: await isApprover(mid), canChangeTier: await isEvangelism(mid) };
  return { isAdmin: await isAdmin(mid), name: admin?.name || teacher?.name || '', position: admin?.position || teacher?.position || '', dept: admin?.dept || teacher?.dept || '', roster, permissions };
}

/** 상세에서 본 부서·지역·직책을 검토한다. 삭제된 교사를 오래된 화면에서 재생성하지 않는다. */
const leaderFields=t=>Object.fromEntries(['name','dept','region','position'].map(k=>[k,str(t[k])]));
async function leaderPlan(body) {
  await requireApprover();
  const mid=str(body.memberId),nid=normId(mid),fields=leaderFields(body),create=body.create===true;
  if(mid.replace(/\D/g,'').length<5||nid==='0'||!fields.name)return {error:'고유번호와 이름을 확인해 주세요.'};
  if(!LEADER_POSITIONS.includes(fields.position))return {error:'지정할 수 없는 직책입니다.'};
  const [expected,identity]=await Promise.all([run(db().rpc('roster_member_state',{p_nids:[nid]})),sensitiveActor()]);
  if(expected.length>1)return {error:'고유번호가 중복된 명단입니다. 담당자 확인이 필요해요.'};
  const current=expected[0]?.row;
  if(create&&current)return {error:'이미 명단에 있어요. 다시 조회해 주세요.',stale:true};
  if(!create){
    if(!current)return {error:'명단에서 찾을 수 없어요. 다시 조회해 주세요.',stale:true};
    if(!body.expected||Object.entries(leaderFields(current)).some(([k,v])=>str(body.expected[k])!==v))
      return {error:'화면의 명단과 현재 정보가 달라요. 다시 조회해 주세요.',stale:true};
  }
  const before=current?leaderFields(current):null;
  // 빈 부서/지역 입력은 기존처럼 현재 값을 유지한다. 등급·활동·별도 보직은 변경 대상이 아니다.
  const after={...fields,dept:fields.dept||before?.dept||'',region:fields.region||before?.region||''};
  const request={create,nid,memberId:current?.member_id||mid,fields:after,expected,...identity};
  const review=createHash('sha256').update(JSON.stringify(request)).digest('hex');
  return {ok:true,request,review,before,after};
}
async function previewRosterLeader(body){
  const plan=await leaderPlan(body);
  return plan.error?plan:{ok:true,review:plan.review,before:plan.before,after:plan.after};
}
async function upsertRosterLeader(body){
  const plan=await leaderPlan(body);if(plan.error)return plan;
  if(body.confirmed!==true||!body.review)return {error:'직책 변경 내용을 먼저 확인해 주세요.'};
  if(body.review!==plan.review)return {error:'확인 뒤 명단이나 담당자 권한이 바뀌었어요. 다시 조회해 주세요.',stale:true};
  const result=await run(db().rpc('roster_leader_apply',{p:plan.request}));
  if(!result.error&&!result.unchanged)forgetRoster();
  return result;
}

export default { getRoster, checkAdmin, previewRosterLeader, upsertRosterLeader };
