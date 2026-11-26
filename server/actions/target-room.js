// 2026-11-06(사용자): 섭외자 대화방 — "섭외자 방 안에 대화방을 만들어 초대한 사람이 들어와 중요 정보를 거기서 나누게.
//   텔레그램 정보와 섞이지 않고 중요 정보는 한 곳에". 결정: 명단의 누구나 초대 / 초대받은 사람도 대화·정보 기록·활동 이력을 봄(읽기만) /
//   알림은 앱 N 뱃지만(getNewMarks 의 room).
// 들어올 수 있는 사람 = 그 섭외자의 담당(처음 기록한 교사·인도자·섬김이) + 담당이 초대한 사람. 초대·내보내기는 담당만.
// 초대 화면의 명단 찾기는 고유번호를 돌려주지 않는다(로그인 = 번호·이름·부서라서) — 서버 서명(inviteKey)을 열쇠로 쓴다.
import { currentActor, AccessError } from '../lib/request-context.js';
import { createHmac, randomBytes } from 'node:crypto';
import { db, run, isDuplicate, selectAll } from '../lib/db.js';
import { normId, str, kstDateTime, fmtTs } from '../lib/util.js';
import { maskName } from '../lib/report-room.js';
import { isAdmin } from './roster.js';
import {isSystemOwner} from '../lib/system-owner.js';
import {COUNSEL_STAGES,roomScopes,roomTeachers,isRoomManager,mayReadRoom,explicitlyInvited} from '../lib/room-scope.js';
import {sensitiveActor} from '../lib/sensitive-actor.js';
import {uploadRoomFile,uploadRoomPhoto,readyAttachment,attachmentResponse} from '../lib/room-attachments.js';
export {COUNSEL_STAGES} from '../lib/room-scope.js';
import { targetNamesOf, scrubDeep, scrubNames } from '../lib/name-scrub.js';
import { findTarget, owns, activitiesAbout, coachingAbout } from './targets.js';

// targets.js 와 같은 값
const INFO_KIND = '파악정보', INFO_FB_KIND = 'AI 파악정보 피드백', MASTER_KIND = 'AI 종합 피드백', PLAN_KIND = '개강 인도 계획', MOVING_KIND = 'AI 감동주기 방법';
const MAX_TEXT = 3000;

// 11/10(사용자) 개강피드백: 상담 이상 섭외자 방은 관리자(교관 이상)가 목록에서 눌러 바로 들어가고, 인교섬협 초대를 맡는다.
// 현재 명단의 부서/지역 담당 또는 명시적 초대만 허용한다.
/** 현재 담당/명시 초대 관계만 읽는다. 참여자·읽음 변경은 별도 DB 확정에서 처리한다. */
async function access(memberId, targetId, name) {
  const mid = str(memberId), tid = str(targetId);
  if (!mid || !tid) return null;
  const target = await findTarget(tid);
  if (!target) return null;
  const nid = normId(mid);
  const guest = currentActor()?.guest;
  if (guest && currentActor().roomId !== tid) return null;
  const isOwner = !guest && (isSystemOwner(nid)||owns(target, nid));
  let [member] = await run(db().from('target_room_members').select('*').eq('target_id', tid).eq('nid', nid).limit(1));
  const [scopes,teachers] = !guest && !isOwner ? await Promise.all([roomScopes(mid),roomTeachers([target])]) : [[],new Map()];
  const admin = !guest && !isOwner && isRoomManager(target,scopes,teachers.get(target.creator_nid));
  if (!mayReadRoom(target,member,nid,admin,guest)) return null;
  // 초대 관계는 보직과 독립적으로 남긴다. 자동 승격으로 초대 근거를 없애지 않는다.
  const canManage = isOwner || admin;
  return { target, isOwner, canManage, member, nid, memberId:mid, guest };
}
const DENIED = { error: '이 피드백방의 담당 범위가 아니거나 초대받지 않았어요.' };

const toMsg = (m, nid, keyOf) => ({
  id: Number(m.id), from: m.from_name, mine: m.from_nid === nid, fk: (keyOf && m.from_id && keyOf.get(m.from_nid)) || 0, text: m.deleted ? '' : m.body, photo: !m.deleted && m.photo ? 'room-media:'+m.id : '',
  file: !m.deleted && m.file_url ? { url: 'room-media:'+m.id, name: m.file_name, size: Number(m.file_size) || 0 } : null,
  pinned: !m.deleted && m.pinned, deleted: m.deleted, at: fmtTs(m.created_at),
});
const targetView = (t, isOwner) => ({
  id: t.target_id, name: maskName(t.target_name), stage: t.stage || '섭외',
  gender: t.gender || '', ageGroup: t.age_group || '', teacher: t.teacher_name || '',
  goalMonth: t.goal_cohort ? Number(t.goal_cohort.slice(5)) : 0,
});

// 11/6(사용자): 담당이 아닌 분이 보는 것은 글 속 섭외자 이름까지 가림(담당 교사들의 섭외자 전부)
const ownersOf = (t) => [t.creator_id, t.leader_id, t.helper_id].filter(Boolean);
// 11/6(사용자): 대화방은 여럿이 보는 곳 — 담당 교사 본인에게도 이름·연락처를 가림(실명은 섭외자 화면에서)
async function forViewer(a, out) {
  const value=scrubDeep(out, await targetNamesOf(ownersOf(a.target), [a.target.target_name]));
  // 원문을 준비하는 동안 담당/초대 관계가 사라졌다면 응답하지 않는다. 저장의 원자성 보장은 별도다.
  const fresh=await access(a.memberId,a.target.target_id,'',false);
  if(!fresh||a.target.room_generation!==fresh.target.room_generation||a.canManage&&!fresh.canManage||a.isOwner&&!fresh.isOwner)return DENIED;
  return value;
}

/** 방 열기·새 글 받기. afterId 가 있으면 그 뒤 글만(15초마다 확인용 — 가볍게). */
async function getTargetRoom(body) {
  const a=await access(body.memberId,body.targetId,body.name);
  if(!a)return DENIED;
  const after = Number(body.afterId) || 0;
  let q = db().from('target_room_messages').select('*').eq('target_id', a.target.target_id);
  q = after ? q.gt('id', after).order('id').limit(200) : q.order('id', { ascending: false }).limit(300);
  let rows = await run(q);
  if (!after) rows = rows.reverse();
  const lastId = rows.length ? Number(rows[rows.length - 1].id) : 0;
  // 새 글이 없는 반복 조회에는 읽음 쓰기·확정 RPC를 만들지 않는다.
  if(!a.member||lastId>Number(a.member.last_read_id||0)){
    const guard=await roomGuard(body);
    if(!guard||a.target.room_generation!==guard.a.target.room_generation)return DENIED;
    const read=await roomApply(guard,'read',{lastId});
    if(read.error)return read;
    a.member=read.member;
  }
  // 11/10(사용자): 카톡처럼 안 읽은 사람 수 — 방 사람마다 어디까지 읽었는지(reads = [멤버 키, 읽은 글 번호]), 글마다 보낸 사람 키(fk)
  const members = await run(db().from('target_room_members').select('*').eq('target_id', a.target.target_id).order('id'));
  const keyOf = new Map(members.map((m) => [m.nid, Number(m.id)]));
  const reads = members.map((m) => [Number(m.id), m.nid === a.nid ? Math.max(lastId, Number(m.last_read_id) || 0) : Number(m.last_read_id) || 0]);
  const out = { ok: true, messages: rows.map((m) => toMsg(m, a.nid, keyOf)), isOwner: a.isOwner, canManage: a.canManage, reads };
  if (after) return forViewer(a, out);
  // 처음 열 때만: 섭외자·멤버·고정 글(300개보다 오래된 고정 글도)
  const [pins, invites] = await Promise.all([
    run(db().from('target_room_messages').select('*').eq('target_id', a.target.target_id).eq('pinned', true).eq('deleted', false).order('id')),
    a.canManage ? activeInvites(a.target.target_id).catch(() => []) : [],
  ]);
  const crew = a.canManage ? await crewOf(a.target, members).catch(() => []) : [];
  return forViewer(a, {
    ...out, target: targetView(a.target, a.isOwner),
    members: members.map((m) => ({ key: Number(m.id), name: m.name, role: m.role, by: m.invited_by, me: m.nid === a.nid, at: fmtTs(m.joined_at).slice(0, 10) })),
    pins: pins.map((m) => toMsg(m, a.nid, keyOf)),
    invites, crew,
  });
}

// ── 초대 링크 (11/6) ── 교사명단에 없는 인도자·섬김이도. 24시간 · 최대 5명 · 담당이 끊기 가능.
const INVITE_HOURS = 24, INVITE_MAX = 5;
const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 헷갈리는 0·O·1·I 뺌
const newCode = () => Array.from(randomBytes(8), (b) => CODE_ABC[b % 32]).join('');
const cleanCode = (v) => str(v).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
const showCode = (c) => `${c.slice(0, 4)}-${c.slice(4)}`;
async function activeInvites(targetId) {
  const now = kstDateTime();
  const rows = await run(db().from('target_room_invites').select('*').eq('target_id', targetId).eq('revoked', false).gt('expires_at', now).order('id'));
  return rows.filter((r) => r.uses < r.max_uses).map((r) => ({ code: showCode(r.code), raw: r.code, by: r.created_name, expires: fmtTs(r.expires_at).slice(5, 16), uses: r.uses, max: r.max_uses }));
}

async function createRoomInvite(body) {
  const guard=await roomGuard(body);
  if(!guard||!guard.a.canManage)return {error:'초대 링크는 담당 교사·관리자만 만들 수 있어요.'};
  for(let i=0;i<5;i++){
    const code=newCode();
    try {
      const result=await roomApply(guard,'createInvite',{code});
      if(result.error)return result;
      return {ok:true,code:showCode(code),raw:code,expires:fmtTs(result.expires).slice(5,16),hours:INVITE_HOURS,max:INVITE_MAX};
    } catch(e){if(!isDuplicate(e))throw e;}
  }
  return {error:'링크를 만들지 못했어요. 다시 눌러 주세요.'};
}
async function revokeRoomInvite(body) {
  const guard=await roomGuard(body);
  if(!guard||!guard.a.canManage)return {error:'담당 교사·관리자만 끊을 수 있어요.'};
  return roomApply(guard,'revokeInvite',{code:cleanCode(body.code)});
}
/** 참여·사용 횟수·안내 글을 같은 DB 트랜잭션에서 확인하고 저장한다. */
async function joinRoomByCode(body) {
  const code=cleanCode(body.code);
  if(code.length!==8)return {error:'초대 코드 8자리를 확인해 주세요.'};
  const [inv]=await run(db().from('target_room_invites').select('target_id').eq('code',code).limit(1));
  if(!inv)return {error:'없거나 끊긴 초대 링크예요. 담당 교사에게 새 링크를 받아 주세요.'};
  if(currentActor()?.guest&&currentActor().roomId!==inv.target_id)return DENIED;
  return run(db().rpc('room_membership_apply',{p:{...await roomActorProof(),targetId:inv.target_id,operation:'join',code}}));
}
async function roomActorProof(){
 const actor=currentActor();
 return actor.guest?{actorGuest:true,actorRoom:actor.roomId,actorExpires:actor.expiresAt,actorId:actor.memberId,actorNid:actor.nid,actorName:actor.name}:sensitiveActor();
}
const roomApply=(guard,operation,values={})=>run(db().rpc('room_membership_apply',{p:{...guard.p,operation,...values}}));

// 접근 판단 전의 버전을 저장 직전 DB에서 대조한다. 첨부 업로드 중 보직/초대/PIN이 바뀌면 저장하지 않는다.
async function roomGuard(body) {
 const actor=currentActor();
 const expected=await run(db().rpc('room_access_revision',{p_tid:body.targetId,p_nid:actor.nid}));
 const a=await access(body.memberId,body.targetId,body.name,false);if(!a)return null;
 const proof=await roomActorProof();
 return {a,p:{...proof,systemOwnerNid:!actor.guest&&isSystemOwner(actor.nid)?actor.nid:'',expected,targetId:body.targetId,isOwner:a.isOwner,canManage:a.canManage,memberRole:a.isOwner?'담당':'관리자'}};
}
async function sendRoomMessage(body) {
 const guard=await roomGuard(body);if(!guard)return DENIED;
 const text=str(body.text).slice(0,MAX_TEXT),actor=currentActor(),attachments=[];
 if(body.photo){const value=await uploadRoomPhoto(body.photo,body,actor);attachments.push(await readyAttachment(value,body,actor,'photo'));}
 if(body.file)attachments.push(await readyAttachment(body.file.url,body,actor,'file'));
 if(!text&&!attachments.length)return {error:'내용을 적어 주세요.'};
 const result=await run(db().rpc('room_message_apply',{p:{...guard.p,operation:'send',text,pin:!!body.pin,attachments:attachments.map(({id,kind,object_key})=>({id,kind,object_key}))}}));
 if(result.error)return result;
 return {ok:true,message:{...toMsg(result.row,actor.nid),fk:Number(result.memberKey)}};
}
async function roomFileUpload(body) {
 const a=await access(body.memberId,body.targetId,body.name,false);if(!a)return DENIED;
 return uploadRoomFile(body,currentActor());
}
// URL/객체 키를 입력받지 않는다. 현재 방의 실제 메시지에서 첨부를 찾는다.
export async function readRoomAttachment(body) {
 const a=await access(body.memberId,body.targetId,body.name,false);if(!a)throw new AccessError(DENIED.error);
 const kind=body.kind==='photo'?'photo':body.kind==='file'?'file':'';
 if(!kind||!Number.isSafeInteger(Number(body.id))||Number(body.id)<=0)throw new AccessError('첨부를 확인해 주세요.',400);
 const [row]=await run(db().from('target_room_messages').select('id,target_id,deleted,photo,file_url,file_name').eq('target_id',body.targetId).eq('id',body.id).limit(1));
 if(!row||row.deleted||!(kind==='photo'?row.photo:row.file_url))throw new AccessError('없는 첨부예요.',404);
 const response=await attachmentResponse(row,kind,body.variant);
 const fresh=await access(body.memberId,body.targetId,body.name,false);
 const [current]=await run(db().from('target_room_messages').select('deleted,photo,file_url').eq('id',row.id).eq('target_id',body.targetId).limit(1));
 if(!fresh||!current||current.deleted||current.photo!==row.photo||current.file_url!==row.file_url){void response.body?.cancel().catch(()=>{});throw new AccessError(DENIED.error);}
 return response;
}

/** 📌 고정·풀기 — 방에 있는 누구나. */
async function pinRoomMessage(body) {
  const guard=await roomGuard(body);if(!guard)return DENIED;
  return roomApply(guard,'pin',{id:Number(body.id),pinned:!!body.pinned});
}

/** 지우기 — 쓴 사람 또는 담당. 줄은 남기고 '지운 글'로. */
async function deleteRoomMessage(body) {
 const guard=await roomGuard(body);if(!guard)return DENIED;
 return run(db().rpc('room_message_apply',{p:{...guard.p,operation:'delete',id:Number(body.id)}}));
}

/** 초대 열쇠 — 고유번호 대신 서버 비밀값으로 만든 서명(앱에 고유번호가 안 나가게). teachers 표엔 번호 칸(id)이 없다. */
const inviteKey = (nid) => createHmac('sha256', process.env.SUPABASE_SERVICE_ROLE_KEY || 'room').update('room-invite:' + nid).digest('base64url').slice(0, 22);
// 11/6: 교사명단 + 관리자 명단에만 있는 분(교역자 등)도 — 같은 사람은 한 번만
async function findPeople(q) {
  const pat = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
  const [ts, ads] = await Promise.all([
    run(db().from('teachers').select('nid, member_id, name, dept, region, affiliation, position').ilike('name', pat).order('sort_order').limit(30)),
    run(db().from('admins').select('nid, member_id, name, dept, region, affiliation, position').ilike('name', pat).order('id').limit(30)),
  ]);
  const seen = new Set(ts.map((x) => x.nid));
  return ts.concat(ads.filter((x) => !seen.has(x.nid) && seen.add(x.nid)));
}

/** 초대할 사람 찾기(이름 두 글자 이상) — 담당만. */
async function searchRoomInvitees(body) {
  const a = await access(body.memberId, body.targetId, body.name);
  if (!a || !a.canManage) return { error: '초대는 담당 교사·관리자만 할 수 있어요.' };
  const q = str(body.query).slice(0, 20);
  if (q.length < 2) return { rows: [] };
  const [rows, inRoom] = await Promise.all([
    findPeople(q),
    run(db().from('target_room_members').select('nid,role,invited_by').eq('target_id', a.target.target_id)),
  ]);
  const joined = new Set(inRoom.filter(m=>explicitlyInvited(m)||owns(a.target,m.nid)).map((m) => m.nid));
  return { rows: rows.map((t) => ({ key: inviteKey(t.nid), name: t.name, dept: t.dept, region: t.region, affiliation: t.affiliation, position: t.position, joined: joined.has(t.nid) })) };
}

/** 초대 — 앱은 key 와 찾을 때 쓴 말(query)을 보낸다. 같은 검색을 다시 해서 서명이 맞는 사람만. */
async function inviteToRoom(body) {
  const guard=await roomGuard(body);
  if(!guard||!guard.a.canManage)return {error:'초대는 담당 교사·관리자만 할 수 있어요.'};
  const q=str(body.query).slice(0,20);
  const t=q.length>=2?(await findPeople(q)).find(p=>inviteKey(p.nid)===str(body.key)):null;
  if(!t)return {error:'명단에서 찾지 못했어요.'};
  return roomApply(guard,'invite',{invitee:t});
}
/** 내보내기(현재 담당) 또는 나가기(본인). 현재 담당 관계는 예전 역할 글자와 무관하게 보호한다. */
async function leaveRoom(body) {
  const guard=await roomGuard(body);if(!guard)return DENIED;
  return roomApply(guard,'leave',{key:Number(body.key)||null});
}
/** 대화·초대·참여자를 함께 삭제한다. 대상자/활동과 외부 원본은 보존하며 새로 열면 빈 방이다. */
async function deleteRoom(body) {
  const guard=await roomGuard(body);if(!guard)return DENIED;
  if(!guard.a.isOwner)return {error:'피드백방은 담당 교사만 없앨 수 있어요.'};
  return roomApply(guard,'deleteRoom');
}

/**
 * 인교섬협(인도자·교사·섬김이·협력교사) 초대 후보 — 섭외자 담당(교사·인도자·섬김이) + 활동 기록 '함께하는 팀' 이름 + 협력교사로 기록한 분.
 * 이름으로 명단에서 찾아 key(서명)·query 를 주면 앱이 inviteToRoom 으로 바로 초대한다(동명이인은 부서·지역을 보고 고름).
 */
async function crewOf(t, members) {
  const inRoom = new Set(members.filter(m=>explicitlyInvited(m)||owns(t,m.nid)).map(m=>m.nid));
  const want = [];   // [역할, 이름]
  const byId = [[t.creator_id, '교사'], [t.leader_id, '인도자'], [t.helper_id, '섬김이']].filter(([id]) => str(id));
  const acts = await activitiesAbout(t).catch(() => []);
  const last = acts.filter((x) => x.report && x.report.team).pop();
  const team = (last && last.report.team) || {};
  const nameOf = (v) => String(v || '').trim().replace(/^#/, '').split(/[\s(（]/)[0];
  for (const [k, role] of [['leader', '인도자'], ['teacher', '교사'], ['helper', '섬김이']]) if (nameOf(team[k])) want.push([role, nameOf(team[k])]);
  for (const x of acts) if ((x.roles || []).includes('협력교사') && x.name) want.push(['협력교사', x.name]);
  const out = [], seen = new Set();
  const ids = byId.map(([id]) => normId(id));
  const idRows = ids.length ? await run(db().from('teachers').select('nid, member_id, name, dept, region, affiliation, position').in('nid', ids)) : [];
  const push = (role, p) => {
    if (!p || seen.has(p.nid)) return;
    seen.add(p.nid);
    out.push({ role, name: p.name, dept: p.dept || '', region: p.region || '', key: inviteKey(p.nid), query: p.name, joined: owns(t,p.nid)||inRoom.has(p.nid) });
  };
  for (const [id, role] of byId) push(role, idRows.find((r) => r.nid === normId(id)));
  for (const [role, nm] of want) {
    if (nm.length < 2 || out.some((o) => o.name === nm)) continue;
    const found = await findPeople(nm).catch(() => []);
    const exact = found.filter((p) => p.name === nm);
    if (!exact.length) out.push({ role, name: nm, dept: '', region: '', key: '', query: nm, joined: false, missing: true });
    exact.slice(0, 3).forEach((p) => push(role, p));
  }
  return out;
}

// .in() 값이 많으면 주소가 너무 길어져 실패 — 150개씩 나눠 읽는다
async function inChunks(make, vals, size = 150) {
  const out = [];
  for (let i = 0; i < vals.length; i += size) out.push(...(await run(make(vals.slice(i, i + size)))));
  return out;
}
/** 관리자 › 개강피드백: 상담 이상 섭외자(담당 교사 부서·지역) + 피드백방 상태. */
async function listOpeningRooms(body) {
  const mid = str(body.memberId);
  if (!mid || !(await isAdmin(mid))) return { error: '개강피드백은 관리자(교관 이상)만 볼 수 있어요.' };
  const nid = normId(mid);
  let targets = [];   // 1,000개씩 끝까지(한도 없이)
  for (let i = 0; ; i += 1000) {
    const part = await run(db().from('targets').select('target_id, target_name, stage, gender, age_group, teacher_name, creator_nid, leader_nid, helper_nid, goal_cohort, updated_at').in('stage', COUNSEL_STAGES).order('updated_at', { ascending: false }).order('id').range(i, i + 999));
    targets.push(...part);
    if (part.length < 1000) break;
  }
  if (!targets.length) return { rows: [] };
  const [scopes,tBy,myMemberships]=await Promise.all([roomScopes(mid),roomTeachers(targets),
    selectAll(()=>db().from('target_room_members').select('target_id,role,invited_by').eq('nid',nid).order('id'))]);
  const myBy=new Map(myMemberships.map(m=>[m.target_id,m]));
  targets=targets.filter(t=>mayReadRoom(t,myBy.get(t.target_id),nid,isRoomManager(t,scopes,tBy.get(t.creator_nid))));
  if(!targets.length)return {rows:[]};
  const ids = targets.map((t) => t.target_id);
  const members = await inChunks((v) => db().from('target_room_members').select('target_id, nid, name, role, last_read_id').in('target_id', v), ids);
  // 11/10(사용자): 최신 보고 건이 위로 — 담당(교사·인도자·섬김이)이 이 섭외자 이름으로 올린 활동 기록 중 가장 최근
  const ownerNids = [...new Set(targets.flatMap((t) => [t.creator_nid, t.leader_nid, t.helper_nid]).filter(Boolean))];
  const lastRep = new Map(), nowTs = kstDateTime();
  for (let i = 0; i < ownerNids.length; i += 150) {
    const part = ownerNids.slice(i, i + 150);
    const acts = await selectAll(() => db().from('activities').select('id, nid, target_name, submitted_at').in('nid', part).neq('target_name', '').order('id')).catch(() => []);
    for (const a of acts) {
      const k = a.nid + '|' + String(a.target_name).trim(), raw = fmtTs(a.submitted_at), at = raw > nowTs ? nowTs : raw;   // 앞날짜로 적은 기록이 맨 위에 박히지 않게
      if (at > (lastRep.get(k) || '')) lastRep.set(k, at);
    }
  }
  const lastOf = (t) => [t.creator_nid, t.leader_nid, t.helper_nid].filter(Boolean).map((n) => lastRep.get(n + '|' + String(t.target_name).trim()) || '').sort().pop() || '';
  const roomIds = [...new Set(members.map((m) => m.target_id))];
  const msgs = (await inChunks((v) => db().from('target_room_messages').select('id, target_id, from_nid, created_at, deleted').in('target_id', v).order('id', { ascending: false }).limit(3000), roomIds).catch(() => []))
    .sort((a, b) => Number(b.id) - Number(a.id));
  const rows = targets.map((t) => {
    const tm = tBy.get(t.creator_nid) || {};
    const mem = members.filter((m) => m.target_id === t.target_id);
    const me = mem.find((m) => m.nid === nid);
    const ms = msgs.filter((x) => x.target_id === t.target_id);
    return {
      id: t.target_id, name: String(t.target_name || '').trim(), stage: t.stage, gender: t.gender || '', ageGroup: t.age_group || '',   // 11/10(사용자): 관리자 목록은 섭외자 이름 전부
      teacher: t.teacher_name || '', dept: tm.dept || '', region: tm.region || '',
      goalMonth: t.goal_cohort ? Number(String(t.goal_cohort).slice(5)) : 0,
      room: mem.length > 0, members: mem.length, admins: mem.filter((m) => m.role === '관리자').map((m) => m.name),
      inRoom: !!me, unread: me ? ms.filter((x) => Number(x.id) > Number(me.last_read_id || 0) && x.from_nid !== nid && !x.deleted).length : 0,
      lastAt: ms.length ? fmtTs(ms[0].created_at).slice(5, 16) : '',
      lastReport: lastOf(t),
    };
  });
  // 11/10(사용자): "중복건은 교사 기준으로 1건" — 같은 교사(이름)·같은 섭외자 이름이 여러 줄이면(번호를 달리 넣어 두 번 등록 등) 하나로.
  //   남길 줄 = 피드백방 있는 것 → 부서가 있는 것 → 최근 보고. 부서·지역·최근 보고·단계(높은 쪽)·안 읽은 수는 합쳐서.
  const groups = new Map();
  for (const r of rows) { const k = `${r.teacher.trim()}|${r.name}`; groups.set(k, (groups.get(k) || []).concat(r)); }
  const out = [...groups.values()].map((g) => {
    if (g.length === 1) return g[0];
    const pick = [...g].sort((a, b) => (b.room - a.room) || (!!b.dept - !!a.dept) || String(b.lastReport).localeCompare(String(a.lastReport)))[0];
    const withDept = g.find((x) => x.dept) || {};
    return {
      ...pick, dept: pick.dept || withDept.dept || '', region: pick.region || withDept.region || '',
      stage: g.map((x) => x.stage).sort((a, b) => COUNSEL_STAGES.indexOf(b) - COUNSEL_STAGES.indexOf(a))[0],
      lastReport: g.map((x) => x.lastReport).sort().pop(), unread: g.reduce((n, x) => n + x.unread, 0), dup: g.length,
    };
  });
  out.sort((a, b) => String(b.lastReport).localeCompare(String(a.lastReport)));
  return { rows: out };
}

/**
 * 정보 기록 + 활동 이력 + 단계 이력 + 받아 둔 피드백(읽기만) — 방에 있는 누구나.
 * 11/6(사용자): "피드백 받아 놓은 것들도 정보 기록 옆에서 — 단계향상 피드백, ○월 센터 인도 피드백, 하츠 피드백 등 칸"
 *   단계향상 = activities.ai_feedback / ○월 개강(센터 인도) 계획 = target_ai_notes '개강 인도 계획'(없으면 targets.goal_plan)
 *   HEARTS = 이 섭외자 이야기로 받은 AI상담·교관 답(coachingAbout) / 정보 기록 AI 피드백 / 종합 피드백
 */
async function getRoomRecords(body) {
  const a = await access(body.memberId, body.targetId, body.name);
  if (!a) return DENIED;
  const t = a.target;
  const [notes, acts, hist, coach] = await Promise.all([
    run(db().from('target_ai_notes').select('id, kind, input, text, created_at').eq('target_id', t.target_id)
      .in('kind', [INFO_KIND, INFO_FB_KIND, MASTER_KIND, PLAN_KIND, MOVING_KIND]).order('id', { ascending: false })),
    activitiesAbout(t),
    run(db().from('target_history').select('*').eq('target_id', t.target_id).order('id', { ascending: false })),
    coachingAbout(t, t.creator_id).catch(() => []),
  ]);
  const of = (k) => notes.filter((n) => n.kind === k).map((n) => ({ at: fmtTs(n.created_at).slice(0, 16), basis: n.input, text: n.text }));
  const plans = of(PLAN_KIND);
  if (!plans.length && t.goal_plan) plans.push({ at: fmtTs(t.goal_plan_at).slice(0, 16), basis: '', text: t.goal_plan });
  return forViewer(a, {
    ok: true,
    goalMonth: t.goal_cohort ? Number(t.goal_cohort.slice(5)) : 0,
    infoFeedback: of(INFO_FB_KIND), master: of(MASTER_KIND), moving: of(MOVING_KIND), plans,
    stageFb: acts.filter((x) => x.ai_feedback).sort((x, y) => (String(x.submitted_at) < String(y.submitted_at) ? 1 : -1))
      .map((x) => ({ at: fmtTs(x.ai_feedback_at || x.submitted_at).slice(0, 16), about: `${fmtTs(x.submitted_at).slice(5, 10).replace('-', '/')} ${(x.activities || []).join(', ')}`, text: x.ai_feedback })),
    hearts: coach.slice().reverse().map((f) => ({ at: fmtTs(f.submitted_at).slice(0, 16), source: f.source, situation: f.situation, ai: f.ai_coach_text, handler: f.handler, answer: f.handler_answer })),
    info: notes.filter((n) => n.kind === INFO_KIND).map((n) => ({ cat: n.input || '기타', text: n.text, at: fmtTs(n.created_at).slice(0, 16) })),
    acts: acts.sort((x, y) => (String(x.submitted_at) < String(y.submitted_at) ? 1 : -1)).map((x) => ({
      at: fmtTs(x.submitted_at).slice(0, 16), by: x.name, roles: x.roles || [], items: x.activities || [], stage: x.target_stage,
      consult: x.consult_title, subject: x.gospel_subject, reaction: x.reaction, reactionNote: x.reaction_note,
      today: x.today_work, next: x.next_work, special: x.special_note,
    })),
    history: hist.map((h) => ({ at: fmtTs(h.changed_at).slice(0, 10), from: h.from_stage, to: h.to_stage, memo: h.memo })),
  });
}

/** 본문/첨부를 조회하기 전에 현재 담당·명시 초대 관계로 목록을 거른다. */
async function visibleMemberships(memberId){
  const nid=normId(memberId),guest=currentActor()?.guest;
  let query=()=>{let q=db().from('target_room_members').select('target_id,role,invited_by,last_read_id').eq('nid',nid).order('id');return guest?q.eq('target_id',currentActor().roomId):q;};
  const mine=await selectAll(query);if(!mine.length)return {mine:[],targets:[]};
  const targets=await inChunks(v=>db().from('targets').select('*').in('target_id',v),mine.map(m=>m.target_id));
  const [scopes,teachers]=guest?[[],new Map()]:await Promise.all([roomScopes(memberId),roomTeachers(targets)]);
  const byId=new Map(targets.map(t=>[t.target_id,t]));
  const visible=mine.filter(m=>{const t=byId.get(m.target_id);return t&&mayReadRoom(t,m,nid,!guest&&isRoomManager(t,scopes,teachers.get(t.creator_nid)),guest);});
  const allowed=new Set(visible.map(m=>m.target_id));return {mine:visible,targets:targets.filter(t=>allowed.has(t.target_id))};
}
/** 내가 들어가 있는 섭외자 대화방 목록(새 글 수·마지막 글). */
async function listMyRooms(body) {
  const mid = str(body.memberId);
  if (!mid) return { rows: [] };
  const nid = normId(mid),{mine,targets}=await visibleMemberships(mid);
  if (!mine.length) return { rows: [] };
  const ids = mine.map((m) => m.target_id);
  const [msgs, counts] = await Promise.all([
    inChunks(v=>db().from('target_room_messages').select('id, target_id, from_nid, from_name, body, photo, file_name, created_at, deleted').in('target_id', v)
      .gt('id', Math.min(...mine.map((m) => Number(m.last_read_id) || 0))).order('id'),ids),
    inChunks(v=>db().from('target_room_members').select('target_id, nid, role').in('target_id', v),ids),
  ]);
  const adminNids = new Set(counts.filter((c) => c.role === '관리자').map((c) => c.target_id + '|' + c.nid));   // 11/10: 관리자 피드백(교사가 꼭 보게)
  const byId = new Map(targets.map((t) => [t.target_id, t]));
  const rows = (await Promise.all(mine.map(async (m) => {
    const t = byId.get(m.target_id);
    if (!t) return null;
    const own = owns(t, nid);
    const list = msgs.filter((x) => x.target_id === m.target_id);
    const unread = list.filter((x) => Number(x.id) > Number(m.last_read_id) && x.from_nid !== nid && !x.deleted).length;
    const fbNew = list.filter((x) => Number(x.id) > Number(m.last_read_id) && x.from_nid !== nid && !x.deleted && adminNids.has(m.target_id + '|' + x.from_nid));
    const last = list[list.length - 1];
    return {
      ...targetView(t, own), isOwner: own, unread, fbUnread: fbNew.length, fbLast: fbNew.length ? Number(fbNew[fbNew.length - 1].id) : 0, members: counts.filter((c) => c.target_id === m.target_id).length,
      last: last ? { text: last.deleted ? '(지운 글)' : (scrubNames(last.body, await targetNamesOf(ownersOf(t), [t.target_name]))) || (last.file_name ? '📎 ' + last.file_name : last.photo ? '📷 사진' : ''), from: last.from_name, at: fmtTs(last.created_at).slice(5, 16) } : null,
    };
  }))).filter(Boolean);
  return { rows: rows.sort((x, y) => (y.unread - x.unread) || String((y.last || {}).at || '').localeCompare(String((x.last || {}).at || ''))) };
}

/** getNewMarks 에서 — 내 방들의 안 읽은 글 수(내가 쓴 것·지운 것 빼고). */
export async function roomUnread(nid) {
  const {mine} = await visibleMemberships(nid);
  if (!mine.length) return 0;
  const min = Math.min(...mine.map((m) => Number(m.last_read_id) || 0));
  const msgs = (await inChunks(v=>db().from('target_room_messages').select('id, target_id, from_nid').in('target_id',v).gt('id', min).eq('deleted', false).order('id').limit(1000),mine.map(m=>m.target_id))).sort((a,b)=>a.id-b.id).slice(0,1000);
  const last = new Map(mine.map((m) => [m.target_id, Number(m.last_read_id) || 0]));
  return msgs.filter((x) => Number(x.id) > last.get(x.target_id) && x.from_nid !== nid).length;
}

export default { listOpeningRooms, deleteRoom, createRoomInvite, revokeRoomInvite, joinRoomByCode, getTargetRoom, sendRoomMessage, roomFileUpload, pinRoomMessage, deleteRoomMessage, searchRoomInvitees, inviteToRoom, leaveRoom, getRoomRecords, listMyRooms };
