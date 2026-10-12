// 명단 관리(관리자 탭): 교사 한 명씩 찾기·고치기·추가·삭제, 관리자 지정·해제, 변경 기록
// 권한: 앱 관리자와 교육부·전도부 담당. 등급은 여기서 바꾸지 않는다(교사 명단 화면의 일괄 승인으로).
import { db, run, isDuplicate } from '../lib/db.js';
import { normId, kstDateTime, fmtTs } from '../lib/util.js';
import { clip } from '../lib/input.js';
import { toRosterRow, findTeacher, memberInfo, isApprover, forgetRoster } from './roster.js';

const DENIED = { error: '명단 관리는 교육부·전도부 담당만 할 수 있어요.' };

/** 권한이 있으면 바꾸는 사람 정보를, 없으면 null. */
async function actorOf(body) {
  const id = clip(body.memberId, 40);
  if (!id || !(await isApprover(id))) return null;
  const { teacher, admin } = await memberInfo(id);
  return { id, name: admin?.name || teacher?.name || clip(body.name, 40) };
}

const logChange = (actor, kind, target, before, after) => run(db().from('roster_changes').insert({
  changed_at: kstDateTime(), actor_id: actor.id, actor_name: actor.name, kind,
  target_id: target.memberId, target_name: target.name, before, after,
}));

/** 기록에 남길 교사 값(화면에서 고칠 수 있는 칸 + 등급). */
const teacherFields = (t) => ({ name: t.name, dept: t.dept, region: t.region, affiliation: t.affiliation, position: t.position, note: t.note, tier: t.tier });
const adminFields = (a) => ({ name: a.name, dept: a.dept, region: a.region, position: a.position, phone: a.phone });
const toAdmin = (a) => (a ? { name: a.name, dept: a.dept, region: a.region, position: a.position, phone: a.phone } : null);

/** 이름이나 고유번호로 찾기(30명까지). 교사명단에 없고 관리자 명단에만 있는 사람도 나온다. */
async function searchRoster(body) {
  if (!(await actorOf(body))) return DENIED;
  const query = clip(body.query, 40);
  if (query.length < 2) return { rows: [], hint: '이름이나 고유번호를 두 글자 이상 넣어 주세요.' };
  const digits = query.replace(/\D/g, '');
  const byNumber = digits.length >= 4 && !/[가-힣a-zA-Z]/.test(query);
  const pattern = `%${(byNumber ? digits.replace(/^0+/, '') : query).replace(/[%_\\]/g, '\\$&')}%`;
  const column = byNumber ? 'nid' : 'name';
  const [teachers, admins] = await Promise.all([
    run(db().from('teachers').select('*').ilike(column, pattern).order('sort_order').limit(30)),
    run(db().from('admins').select('*').ilike(column, pattern).order('id').limit(30)),
  ]);
  // 찾은 교사의 관리자 여부도 함께
  const extra = teachers.length ? await run(db().from('admins').select('*').in('nid', teachers.map((t) => t.nid)).order('id')) : [];
  const adminOf = new Map([...extra, ...admins].map((a) => [a.nid, a]));
  const rows = teachers.map((t) => ({ ...toRosterRow(t), inRoster: true, admin: toAdmin(adminOf.get(t.nid)) }));
  const listed = new Set(teachers.map((t) => t.nid));
  for (const a of admins) {
    if (listed.has(a.nid)) continue;
    listed.add(a.nid);
    rows.push({ memberId: a.member_id, name: a.name, dept: a.dept, region: a.region, affiliation: a.affiliation, position: '', tier: '', note: '', inRoster: false, admin: toAdmin(a) });
  }
  return { rows };
}

/** 화면에서 받은 교사 정보를 다듬는다. */
function readTeacher(input) {
  return {
    name: clip(input.name, 30), dept: clip(input.dept, 20), region: clip(input.region, 20),
    affiliation: clip(input.affiliation, 40), position: clip(input.position, 30), note: clip(input.note, 60),
  };
}

/** 교사 한 명을 고치거나(명단에 있으면) 새로 넣는다. */
async function saveRosterMember(body) {
  const actor = await actorOf(body);
  if (!actor) return DENIED;
  const input = body.member || {};
  const targetId = clip(input.memberId, 40);
  if (targetId.replace(/\D/g, '').length < 5) return { error: '고유번호를 정확히 넣어 주세요.' };
  const fields = readTeacher(input);
  if (!fields.name) return { error: '이름을 넣어 주세요.' };
  if (!fields.dept) return { error: '부서를 넣어 주세요.' };

  const current = await findTeacher(targetId);
  if (current) {
    if (input.isNew) return { error: `이미 명단에 있는 번호예요: ${current.name} (${current.dept} ${current.region})` };
    const before = teacherFields(current);
    const changed = Object.keys(fields).some((k) => fields[k] !== before[k]);
    if (!changed) return { ok: true, unchanged: true, member: toRosterRow(current) };
    const [saved] = await run(db().from('teachers').update({ ...fields, updated_at: new Date().toISOString() }).eq('member_id', current.member_id).select());
    forgetRoster();
    await logChange(actor, '교사 수정', { memberId: current.member_id, name: fields.name }, before, teacherFields(saved));
    return { ok: true, member: toRosterRow(saved) };
  }

  if (!input.isNew) return { error: '명단에서 찾을 수 없어요.' };
  const [last] = await run(db().from('teachers').select('sort_order').order('sort_order', { ascending: false }).limit(1));
  try {
    const [saved] = await run(db().from('teachers').insert({
      member_id: targetId, ...fields, tier: '활동교사', sort_order: (last?.sort_order || 0) + 1,
    }).select());
    forgetRoster();
    await logChange(actor, '교사 추가', { memberId: targetId, name: fields.name }, null, teacherFields(saved));
    return { ok: true, created: true, member: toRosterRow(saved) };
  } catch (e) {
    if (isDuplicate(e)) return { error: '방금 다른 곳에서 같은 번호가 추가됐어요. 다시 찾아 주세요.' };
    throw e;
  }
}

/** 교사를 명단에서 뺀다(활동·출석 기록은 그대로 남는다). */
async function removeRosterMember(body) {
  const actor = await actorOf(body);
  if (!actor) return DENIED;
  const current = await findTeacher(clip(body.targetId, 40));
  if (!current) return { error: '명단에서 찾을 수 없어요.' };
  await run(db().from('teachers').delete().eq('member_id', current.member_id));
  forgetRoster();
  await logChange(actor, '교사 삭제', { memberId: current.member_id, name: current.name }, teacherFields(current), null);
  return { ok: true };
}

/** 관리자로 지정하거나(on) 해제한다. 지정할 때 직책은 꼭 넣는다 — 화면 권한과 담당 교관 찾기에 쓰인다. */
async function setAdminMember(body) {
  const actor = await actorOf(body);
  if (!actor) return DENIED;
  const targetId = clip(body.targetId, 40);
  if (targetId.replace(/\D/g, '').length < 5) return { error: '고유번호를 정확히 넣어 주세요.' };
  const [current] = await run(db().from('admins').select('*').eq('nid', normId(targetId)).order('id').limit(1));

  if (!body.on) {
    if (!current) return { ok: true, unchanged: true };
    if (normId(targetId) === normId(actor.id)) return { error: '내 관리자 권한은 스스로 해제할 수 없어요.' };
    await run(db().from('admins').delete().eq('nid', normId(targetId)));
    await logChange(actor, '관리자 해제', { memberId: current.member_id, name: current.name }, adminFields(current), null);
    return { ok: true };
  }

  const teacher = await findTeacher(targetId);
  const input = body.admin || {};
  const fields = {
    name: clip(input.name, 30) || teacher?.name || current?.name || '',
    dept: clip(input.dept, 20) || teacher?.dept || '',
    region: clip(input.region, 20),
    position: clip(input.position, 30),
    phone: clip(input.phone, 20),
  };
  if (!fields.name) return { error: '이름을 넣어 주세요.' };
  if (!fields.position) return { error: '직책을 넣어 주세요.' };
  if (current) {
    const [saved] = await run(db().from('admins').update(fields).eq('id', current.id).select());
    await logChange(actor, '관리자 수정', { memberId: current.member_id, name: fields.name }, adminFields(current), adminFields(saved));
    return { ok: true, admin: toAdmin(saved) };
  }
  const [saved] = await run(db().from('admins').insert({ member_id: teacher?.member_id || targetId, ...fields }).select());
  await logChange(actor, '관리자 지정', { memberId: saved.member_id, name: fields.name }, null, adminFields(saved));
  return { ok: true, created: true, admin: toAdmin(saved) };
}

/** 최근 변경 기록 100건(최신이 위). */
async function getRosterLog(body) {
  if (!(await actorOf(body))) return DENIED;
  const rows = await run(db().from('roster_changes').select('*').order('id', { ascending: false }).limit(100));
  return {
    rows: rows.map((c) => ({
      at: fmtTs(c.changed_at).slice(0, 16), actor: c.actor_name, kind: c.kind,
      targetId: c.target_id, targetName: c.target_name, before: c.before, after: c.after,
    })),
  };
}

export default { searchRoster, saveRosterMember, removeRosterMember, setAdminMember, getRosterLog };
