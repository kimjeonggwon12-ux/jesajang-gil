// 명단 관리(관리자 탭): 교사 한 명씩 찾기·고치기·추가·삭제, 관리자 지정·해제, 변경 기록
// 권한: 앱 관리자와 교육부·전도부 담당. 등급은 여기서 바꾸지 않는다(교사 명단 화면의 일괄 승인으로).
import {createHash} from 'node:crypto';
import {sensitiveActor} from '../lib/sensitive-actor.js';
import {maskOut} from '../lib/idref.js';
import { db, run, selectAll } from '../lib/db.js';
import { normId, fmtTs } from '../lib/util.js';
import { clip } from '../lib/input.js';
import { toRosterRow, findTeacher, memberInfo, memberRoles, isApprover, forgetRoster } from './roster.js';

const DENIED = { error: '명단 관리는 교육부·전도부 담당만 할 수 있어요.' };

/** 권한이 있으면 바꾸는 사람 정보를, 없으면 null. */
async function actorOf(body) {
  const id = clip(body.memberId, 40);
  if (!id || !(await isApprover(id))) return null;
  const { teacher, admin } = await memberInfo(id);
  return { id, name: admin?.name || teacher?.name || clip(body.name, 40) };
}

/** 기록에 남길 교사 값(화면에서 고칠 수 있는 칸 + 등급). */
const teacherFields = (t) => ({ name: t.name, dept: t.dept, region: t.region, affiliation: t.affiliation, position: t.position, note: t.note, tier: t.tier });
const toAdmin = (a) => (a ? { name: a.name, dept: a.dept, region: a.region, position: a.position, phone: a.phone } : null);
const toAssignment = a => ({assignmentId:a.id,...toAdmin(a)});
const adminActorState = ({teacher,admins}) => ({
  teacher:teacher?[teacher.member_id,teacher.name,teacher.dept,teacher.position]:null,
  admins:admins.map(a=>[a.id,a.member_id,a.name,a.dept,a.position]),
});

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
    run(db().from('teachers').select('member_id,nid,name,dept,region,affiliation,position,tier,note,tier_changed_at,reg_leads,unreg_leads,counsel,gospel_room,companion,active_state,month_stats').ilike(column, pattern).order('sort_order').limit(30)),
    run(db().from('admins').select('nid,member_id,name,dept,region,affiliation,position,phone').ilike(column, pattern).order('id').limit(30)),
  ]);
  // 검색 한도는 후보 찾기에만 적용한다. 선택된 사람의 겸직은 모두 읽고 같은 id 순서로 표시한다.
  const nids=[...new Set([...teachers,...admins].map(r=>r.nid))];
  const [extra,states]=nids.length?await Promise.all([selectAll(()=>db().from('admins').select('id,nid,member_id,name,dept,region,affiliation,position,phone').in('nid',nids).order('id')),run(db().rpc('roster_member_state',{p_nids:nids}))]):[[],[]];
  const adminOf=new Map();for(const a of extra){if(!adminOf.has(a.nid))adminOf.set(a.nid,[]);adminOf.get(a.nid).push(a);}
  const assignments=nid=>({admin:toAdmin(adminOf.get(nid)?.[0]),admins:(adminOf.get(nid)||[]).map(toAssignment)});
  // 표시값과 검토 버전은 같은 DB 읽기에서 나온다. 검색 후보와 버전을 따로 붙여 오래된 값을 덮어쓰지 않는다.
  const selectedIds=new Set(teachers.map(t=>t.member_id));
  const rows = states.filter(s=>selectedIds.has(s.row.member_id)).map(({row:t,revision}) => ({ ...toRosterRow(t), rosterRevision:revision, inRoster: true, ...assignments(t.nid) }));
  const listed = new Set(teachers.map((t) => t.nid));
  for (const a of admins) {
    if (listed.has(a.nid)) continue;
    listed.add(a.nid);
    rows.push({ memberId: a.member_id, name: a.name, dept: a.dept, region: a.region, affiliation: a.affiliation, position: '', tier: '', note: '', inRoster: false, ...assignments(a.nid) });
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

/** 조회한 명단과 현재 상태를 대조한 뒤, 화면에서 확인할 변경 전후만 반환한다. */
async function rosterChangePlan(body,mode=body.mode) {
  const actor=await actorOf(body);if(!actor)return DENIED;
  if(!['create','update','remove'].includes(mode))return {error:'명단 변경 종류를 확인해 주세요.'};
  const input=body.member||{},targetId=clip(mode==='remove'?body.targetId:input.memberId,40),nid=normId(targetId);
  if(targetId.replace(/\D/g,'').length<5||nid==='0')return {error:'고유번호를 정확히 넣어 주세요.'};
  const fields=mode==='remove'?null:readTeacher(input);
  if(fields&&!fields.name)return {error:'이름을 넣어 주세요.'};
  if(fields&&!fields.dept)return {error:'부서를 넣어 주세요.'};
  const [expected,identity]=await Promise.all([run(db().rpc('roster_member_state',{p_nids:[nid]})),sensitiveActor()]);
  if(expected.length>1)return {error:'고유번호가 중복된 명단입니다. 담당자 확인이 필요해요.'};
  const current=expected[0]?.row;
  if(mode==='create'&&current)return {error:'이미 명단에 있는 번호예요. 다시 찾아 주세요.',stale:true};
  if(mode!=='create'){
    if(!current)return {error:'명단에서 찾을 수 없어요. 다시 찾아 주세요.',stale:true};
    if(!body.expectedRevision||body.expectedRevision!==expected[0].revision)return {error:'명단이 바뀌었거나 확인 정보가 없어요. 다시 찾아서 확인해 주세요.',stale:true};
  }
  const before=current?teacherFields(current):null,after=fields?{...fields,tier:current?.tier||'활동교사'}:null;
  const request={mode,nid,memberId:current?.member_id||targetId,fields,expected,...identity};
  const review=createHash('sha256').update(JSON.stringify(request)).digest('hex');
  return {ok:true,review,request,before,after,name:after?.name||before?.name};
}
async function previewRosterChange(body){
  const plan=await rosterChangePlan(body);
  return plan.error?plan:{ok:true,review:plan.review,name:plan.name,before:plan.before,after:plan.after,mode:plan.request.mode};
}
async function applyRosterChange(body,mode){
  const plan=await rosterChangePlan(body,mode);if(plan.error)return plan;
  if(body.confirmed!==true||!body.review)return {error:'변경 내용을 먼저 확인해 주세요.'};
  if(body.review!==plan.review)return {error:'확인 뒤 명단이나 담당자 권한이 바뀌었어요. 다시 찾아서 확인해 주세요.',stale:true};
  const result=await run(db().rpc('roster_member_apply',{p:plan.request}));
  if(result.error)return result;
  if(!result.unchanged)forgetRoster();
  if(result.member)result.member=toRosterRow(result.member);
  return result;
}
/** 등급·실적·별도 관리자·활동/출석은 이 경로로 바꾸지 않는다. */
async function saveRosterMember(body){return applyRosterChange(body,body.member?.isNew===true?'create':'update');}
async function removeRosterMember(body){return applyRosterChange(body,'remove');}

/** 선택한 보직만 변경한다. 구형 단일 보직 요청은 유지하되 겸직을 임의 선택/전체 삭제하지 않는다. */
async function setAdminMember(body) {
  const actor = await actorOf(body);
  if (!actor) return DENIED;
  const targetId = clip(body.targetId, 40);
  if (targetId.replace(/\D/g, '').length < 5) return { error: '고유번호를 정확히 넣어 주세요.' };
  if(typeof body.on!=='boolean')return {error:'보직 변경 종류를 확인해 주세요.'};
  const all=await selectAll(()=>db().from('admins').select('*').eq('nid',normId(targetId)).order('id'));
  const reviewed=Object.hasOwn(body,'assignmentId');
  if(!reviewed&&all.length>1)return {error:'겸직이 여러 개예요. 새 명단 관리 화면에서 변경할 보직을 선택해 주세요.'};
  if(reviewed&&(body.confirmed!==true||!Array.isArray(body.expectedAdmins)))return {error:'변경할 보직과 현재 겸직 목록을 확인해 주세요.'};
  const assignmentId=reviewed?body.assignmentId:all[0]?.id||'new';
  if(assignmentId!=='new'&&(!Number.isSafeInteger(assignmentId)||assignmentId<1))return {error:'변경할 보직을 선택해 주세요.'};
  const current=all.find(a=>a.id===assignmentId);
  if(assignmentId!=='new'&&!current)return {error:'보직이 바뀌었어요. 명단을 다시 찾아 주세요.',stale:true};
  if(!body.on&&!current)return {ok:true,unchanged:true};
  if(!body.on&&normId(targetId)===normId(actor.id))return {error:'내 관리자 권한은 스스로 해제할 수 없어요.'};
  const teacher = await findTeacher(targetId);
  const input = body.admin || {};
  const fields = {
    name: clip(input.name, 30) || teacher?.name || current?.name || '',
    dept: clip(input.dept, 20) || current?.dept || teacher?.dept || '',
    region: clip(input.region, 20),
    position: clip(input.position, 30),
    phone: clip(input.phone, 20),
  };
  if(body.on&&(!fields.name||!fields.dept||!fields.position))return {error:'이름·담당 부서·직책을 넣어 주세요.'};
  const result=await run(db().rpc('admin_assignment_apply',{p:{
    nid:normId(targetId),memberId:teacher?.member_id||current?.member_id||targetId,
    on:body.on,assignmentId,fields,expected:reviewed?body.expectedAdmins:all.map(toAssignment),
    actorId:actor.id,actorName:actor.name,actorNid:normId(actor.id),actorState:adminActorState(await memberRoles(actor.id)),
  }}));
  if(result.admin)result.admin=toAdmin(result.admin);
  return result;
}

/** 최근 변경 기록 100건(최신이 위). */
async function getRosterLog(body) {
  if (!(await actorOf(body))) return DENIED;
  const rows = await run(db().from('roster_changes').select('*').order('id', { ascending: false }).limit(100));
  return {
    rows: rows.map((c) => ({
      at: fmtTs(c.changed_at).slice(0, 16), actor: c.actor_name, kind: c.kind,
      // targetId는 다른 업무에서는 활동 대상 식별자다. 명단 이력의 회원 번호만 공통 가림 규칙에 연결한다.
      targetId: maskOut({memberId:c.target_id},normId(body.memberId)).memberId, targetName: c.target_name, before: c.before, after: c.after,
    })),
  };
}

export default { previewRosterChange, searchRoster, saveRosterMember, removeRosterMember, setAdminMember, getRosterLog };
