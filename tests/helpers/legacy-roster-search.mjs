// 명단 관리(관리자 탭): 교사 한 명씩 찾기·고치기·추가·삭제, 관리자 지정·해제, 변경 기록
// 권한: 앱 관리자와 교육부·전도부 담당. 등급은 여기서 바꾸지 않는다(교사 명단 화면의 일괄 승인으로).
import { db, run, isDuplicate } from '../../server/lib/db.js';
import { normId, kstDateTime, fmtTs } from '../../server/lib/util.js';
import { clip } from '../../server/lib/input.js';
import { toRosterRow, findTeacher, memberInfo, isApprover, forgetRoster } from '../../server/actions/roster.js';

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


export default {searchRoster};
