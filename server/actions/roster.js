// 교사명단 · 관리자 명단
import { db, run, selectAll } from '../lib/db.js';
import { normId, str } from '../lib/util.js';

// 교사구분(낮음→높음). 프런트에는 getRoster 응답의 tiers 로 내려간다.
export const TEACHER_TIERS = ['휴교사', '활동교사', '정교사', '우수교사'];

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
  };
}

/** 고유번호로 교사 한 명(없으면 null). */
export async function findTeacher(memberId) {
  const rows = await run(db().from('teachers').select('*').eq('nid', normId(memberId)).order('sort_order').limit(1));
  return rows[0] || null;
}

/** 고유번호로 관리자 명단 한 줄(없으면 null). */
export async function findAdmin(memberId) {
  const rows = await run(db().from('admins').select('name, position, dept').eq('nid', normId(memberId)).order('id').limit(1));
  return rows[0] || null;
}

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
  if (normId(memberId) === OWNER_NID) return true;
  const [admin, teacher] = await Promise.all([findAdmin(memberId), findTeacher(memberId)]);
  if (admin) return true;
  if (!teacher) return false;
  return ADMIN_POSITIONS.includes(teacher.position.trim()) || teacher.dept.trim() === '교역자' || teacher.note.includes('센터');
}

export const isOwner = (memberId) => normId(memberId) === OWNER_NID;

/** 그 부서·지역을 맡은 교관(관리자 명단에서 직책에 '교관'이 들어간 사람). */
export async function findCoaches(dept, region) {
  if (!dept || !region) return [];
  return run(db().from('admins').select('member_id, name, position, dept, region')
    .eq('dept', dept).eq('region', region).like('position', '%교관%').order('id'));
}

async function getRoster() {
  const rows = await selectAll(() => db().from('teachers').select('*').order('sort_order').order('member_id'));
  return { rows: rows.map(toRosterRow), tiers: TEACHER_TIERS };
}

async function checkAdmin(body) {
  const mid = str(body.memberId);
  if (!mid) return { isAdmin: false };
  const [admin, teacher] = await Promise.all([findAdmin(mid), findTeacher(mid)]);
  const roster = teacher ? toRosterRow(teacher) : null;
  return admin
    ? { isAdmin: true, name: admin.name, position: admin.position, dept: admin.dept, roster }
    : { isAdmin: false, roster };
}

/** 명단에 있으면 이름·지역·직책을 고치고, 없으면 새로 넣는다(교사구분은 건드리지 않음). */
async function upsertRosterLeader(body) {
  const mid = str(body.memberId);
  const name = str(body.name);
  const region = str(body.region);
  const position = str(body.position);
  const dept = str(body.dept);
  if (!mid || !name) return { error: 'memberId, name 이 필요합니다.' };
  if (!LEADER_POSITIONS.includes(position)) {
    return { error: '직책은 다음 중 하나여야 합니다: ' + LEADER_POSITIONS.filter(Boolean).join(', ') };
  }

  const found = await run(db().from('teachers').select('member_id').eq('member_id', mid).limit(1));
  if (found.length) {
    const patch = { name, position, updated_at: new Date().toISOString() };
    if (dept) patch.dept = dept;
    if (region) patch.region = region;
    await run(db().from('teachers').update(patch).eq('member_id', mid));
    return { ok: true, updated: true, memberId: mid, name, region, position };
  }

  const last = await run(db().from('teachers').select('sort_order').order('sort_order', { ascending: false }).limit(1));
  await run(db().from('teachers').insert({
    member_id: mid, name, dept, region, position, tier: '활동교사',
    sort_order: (last[0]?.sort_order || 0) + 1,
  }));
  return { ok: true, created: true, memberId: mid, name, region, position };
}

export default { getRoster, checkAdmin, upsertRosterLeader };
