// 2026-11-06(사용자): 섭외자 대화방 — "섭외자 방 안에 대화방을 만들어 초대한 사람이 들어와 중요 정보를 거기서 나누게.
//   텔레그램 정보와 섞이지 않고 중요 정보는 한 곳에". 결정: 명단의 누구나 초대 / 초대받은 사람도 대화·정보 기록·활동 이력을 봄(읽기만) /
//   알림은 앱 N 뱃지만(getNewMarks 의 room).
// 들어올 수 있는 사람 = 그 섭외자의 담당(처음 기록한 교사·인도자·섬김이) + 담당이 초대한 사람. 초대·내보내기는 담당만.
// 초대 화면의 명단 찾기는 고유번호를 돌려주지 않는다(로그인 = 번호·이름·부서라서) — 서버 서명(inviteKey)을 열쇠로 쓴다.
import { createHmac, randomBytes } from 'node:crypto';
import { db, run, isDuplicate } from '../lib/db.js';
import { normId, str, kstDateTime, fmtTs } from '../lib/util.js';
import { maskName } from '../lib/report-room.js';
import { storeImage, r2Configured, isStoredUrl, cleanFileName, putDoc, presignDoc, storedSize, deleteStored } from '../lib/images.js';
import { findTeacherLoose } from './roster.js';
import { targetNamesOf, scrubDeep, scrubNames } from '../lib/name-scrub.js';
import { findTarget, owns, activitiesAbout, coachingAbout } from './targets.js';

// targets.js 와 같은 값
const INFO_KIND = '파악정보', INFO_FB_KIND = 'AI 파악정보 피드백', MASTER_KIND = 'AI 종합 피드백', PLAN_KIND = '개강 인도 계획';
const MAX_TEXT = 3000;

/** 이 사람이 이 방에 들어올 수 있는지 — { target, isOwner, member } 또는 null. 담당이면 멤버 줄을 만들어 둔다(읽음 표시용). */
async function access(memberId, targetId, name) {
  const mid = str(memberId), tid = str(targetId);
  if (!mid || !tid) return null;
  const target = await findTarget(tid);
  if (!target) return null;
  const nid = normId(mid);
  const isOwner = owns(target, nid);
  let [member] = await run(db().from('target_room_members').select('*').eq('target_id', tid).eq('nid', nid).limit(1));
  if (!member && !isOwner) return null;
  if (!member) {
    const t = await findTeacherLoose(mid, name);
    try {
      [member] = await run(db().from('target_room_members').insert({ target_id: tid, member_id: mid, name: (t && t.name) || str(name), role: '담당', joined_at: kstDateTime() }).select('*'));
    } catch (e) {
      if (!isDuplicate(e)) throw e;
      [member] = await run(db().from('target_room_members').select('*').eq('target_id', tid).eq('nid', nid).limit(1));
    }
  }
  return { target, isOwner, member, nid };
}
const DENIED = { error: '이 섭외자 대화방에 초대받지 않았어요.' };

const toMsg = (m, nid, keyOf) => ({
  id: Number(m.id), from: m.from_name, mine: m.from_nid === nid, fk: (keyOf && m.from_id && keyOf.get(m.from_nid)) || 0, text: m.deleted ? '' : m.body, photo: m.deleted ? '' : m.photo,
  file: !m.deleted && m.file_url ? { url: m.file_url, name: m.file_name, size: Number(m.file_size) || 0 } : null,
  pinned: !m.deleted && m.pinned, deleted: m.deleted, at: fmtTs(m.created_at),
});
const targetView = (t, isOwner) => ({
  id: t.target_id, name: maskName(t.target_name), stage: t.stage || '섭외',
  gender: t.gender || '', ageGroup: t.age_group || '', teacher: t.teacher_name || '',
  goalMonth: t.goal_cohort ? Number(t.goal_cohort.slice(5)) : 0,
});

async function markRead(a, lastId) {
  if (lastId > Number(a.member.last_read_id || 0)) await run(db().from('target_room_members').update({ last_read_id: lastId }).eq('id', a.member.id));
}

// 11/6(사용자): 담당이 아닌 분이 보는 것은 글 속 섭외자 이름까지 가림(담당 교사들의 섭외자 전부)
const ownersOf = (t) => [t.creator_id, t.leader_id, t.helper_id].filter(Boolean);
// 11/6(사용자): 대화방은 여럿이 보는 곳 — 담당 교사 본인에게도 이름·연락처를 가림(실명은 섭외자 화면에서)
async function forViewer(a, out) {
  return scrubDeep(out, await targetNamesOf(ownersOf(a.target), [a.target.target_name]));
}

/** 방 열기·새 글 받기. afterId 가 있으면 그 뒤 글만(15초마다 확인용 — 가볍게). */
async function getTargetRoom(body) {
  const a = await access(body.memberId, body.targetId, body.name);
  if (!a) return DENIED;
  const after = Number(body.afterId) || 0;
  let q = db().from('target_room_messages').select('*').eq('target_id', a.target.target_id);
  q = after ? q.gt('id', after).order('id').limit(200) : q.order('id', { ascending: false }).limit(300);
  let rows = await run(q);
  if (!after) rows = rows.reverse();
  const lastId = rows.length ? Number(rows[rows.length - 1].id) : 0;
  await markRead(a, lastId);
  // 11/10(사용자): 카톡처럼 안 읽은 사람 수 — 방 사람마다 어디까지 읽었는지(reads = [멤버 키, 읽은 글 번호]), 글마다 보낸 사람 키(fk)
  const members = await run(db().from('target_room_members').select('*').eq('target_id', a.target.target_id).order('id'));
  const keyOf = new Map(members.map((m) => [m.nid, Number(m.id)]));
  const reads = members.map((m) => [Number(m.id), m.nid === a.nid ? Math.max(lastId, Number(m.last_read_id) || 0) : Number(m.last_read_id) || 0]);
  const out = { ok: true, messages: rows.map((m) => toMsg(m, a.nid, keyOf)), isOwner: a.isOwner, reads };
  if (after) return forViewer(a, out);
  // 처음 열 때만: 섭외자·멤버·고정 글(300개보다 오래된 고정 글도)
  const [pins, invites] = await Promise.all([
    run(db().from('target_room_messages').select('*').eq('target_id', a.target.target_id).eq('pinned', true).eq('deleted', false).order('id')),
    a.isOwner ? activeInvites(a.target.target_id).catch(() => []) : [],
  ]);
  return forViewer(a, {
    ...out, target: targetView(a.target, a.isOwner),
    members: members.map((m) => ({ key: Number(m.id), name: m.name, role: m.role, by: m.invited_by, me: m.nid === a.nid, at: fmtTs(m.joined_at).slice(0, 10) })),
    pins: pins.map((m) => toMsg(m, a.nid, keyOf)),
    invites,
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
  const a = await access(body.memberId, body.targetId, body.name);
  if (!a || !a.isOwner) return { error: '초대 링크는 담당 교사만 만들 수 있어요.' };
  const expires = kstDateTime(new Date(Date.now() + INVITE_HOURS * 3600e3));
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    try {
      await run(db().from('target_room_invites').insert({ code, target_id: a.target.target_id, created_by: str(body.memberId), created_name: a.member.name, created_at: kstDateTime(), expires_at: expires, max_uses: INVITE_MAX }));
      return { ok: true, code: showCode(code), raw: code, expires: expires.slice(5, 16), hours: INVITE_HOURS, max: INVITE_MAX };
    } catch (e) { if (!isDuplicate(e)) throw e; }
  }
  return { error: '링크를 만들지 못했어요. 다시 눌러 주세요.' };
}

async function revokeRoomInvite(body) {
  const a = await access(body.memberId, body.targetId, body.name);
  if (!a || !a.isOwner) return { error: '담당 교사만 끊을 수 있어요.' };
  await run(db().from('target_room_invites').update({ revoked: true }).eq('code', cleanCode(body.code)).eq('target_id', a.target.target_id));
  return { ok: true };
}

/** 링크(코드)로 들어오기 — 앱에 들어온 사람 누구나(교사명단에 없어도). 들어오면 targetId 를 돌려줘 앱이 방을 연다. */
async function joinRoomByCode(body) {
  const mid = str(body.memberId), code = cleanCode(body.code);
  if (!mid) return { error: '먼저 앱에 들어와 주세요.' };
  if (code.length !== 8) return { error: '초대 코드 8자리를 확인해 주세요.' };
  const [inv] = await run(db().from('target_room_invites').select('*').eq('code', code).limit(1));
  const now = kstDateTime();
  if (!inv || inv.revoked) return { error: '없거나 끊긴 초대 링크예요. 담당 교사에게 새 링크를 받아 주세요.' };
  const nid = normId(mid);
  const [already] = await run(db().from('target_room_members').select('id').eq('target_id', inv.target_id).eq('nid', nid).limit(1));
  const target = await findTarget(inv.target_id);
  if (!target) return { error: '섭외자가 지워져서 들어갈 수 없어요.' };
  if (already || owns(target, nid)) return { ok: true, targetId: inv.target_id, already: true };
  if (fmtTs(inv.expires_at) <= now) return { error: `초대 링크가 끝났어요(${INVITE_HOURS}시간). 담당 교사에게 새 링크를 받아 주세요.` };
  if (inv.uses >= inv.max_uses) return { error: `이 링크로는 ${inv.max_uses}명이 이미 들어왔어요. 담당 교사에게 새 링크를 받아 주세요.` };
  // 쓴 횟수를 먼저 올림(동시에 여러 명이 눌러도 넘치지 않게 — 지금 값일 때만 올라감)
  const bumped = await run(db().from('target_room_invites').update({ uses: inv.uses + 1 }).eq('id', inv.id).eq('uses', inv.uses).select('id'));
  if (!bumped.length) return { error: '잠깐 사이 다른 분이 먼저 들어왔어요. 한 번 더 눌러 주세요.' };
  const t = await findTeacherLoose(mid, body.name);
  const name = (t && t.name) || str(body.name).slice(0, 20) || '손님';
  try {
    await run(db().from('target_room_members').insert({ target_id: inv.target_id, member_id: mid, name, role: '초대', invited_by: `${inv.created_name} 링크`, joined_at: kstDateTime() }));
  } catch (e) { if (!isDuplicate(e)) throw e; }
  await run(db().from('target_room_messages').insert({ target_id: inv.target_id, from_id: '', from_name: '', body: `${name} 님이 초대 링크로 들어왔어요${t ? '' : ' (교사명단에 없는 분)'}.`, created_at: kstDateTime() }));
  return { ok: true, targetId: inv.target_id };
}

async function sendRoomMessage(body) {
  const a = await access(body.memberId, body.targetId, body.name);
  if (!a) return DENIED;
  const text = str(body.text).slice(0, MAX_TEXT);
  const photo = body.photo ? await storeImage(body.photo, 'room') : '';
  // 11/10 문서 첨부 — roomFileUpload 로 먼저 올린 우리 R2 주소만 받는다(크기는 R2 에서 다시 확인)
  let file = null;
  if (body.file && body.file.url) {
    const url = str(body.file.url), name = cleanFileName(body.file.name);
    if (!isStoredUrl(url) || !url.includes(`/${FILE_FOLDER}/`) || !name) return { error: '첨부 파일을 확인하지 못했어요. 다시 올려 주세요.' };
    const size = await storedSize(url);
    if (!size) return { error: '첨부 파일이 다 올라가지 않았어요. 다시 올려 주세요.' };
    file = { url, name, size };
  }
  if (!text && !photo && !file) return { error: '내용을 적어 주세요.' };
  const [row] = await run(db().from('target_room_messages').insert({
    target_id: a.target.target_id, from_id: str(body.memberId), from_name: a.member.name || str(body.name), body: text, photo,
    file_url: file ? file.url : '', file_name: file ? file.name : '', file_size: file ? file.size : 0,
    pinned: !!body.pin, pinned_by: body.pin ? a.member.name : '', created_at: kstDateTime(),
  }).select('*'));
  await markRead(a, Number(row.id));
  return { ok: true, message: { ...toMsg(row, a.nid), fk: Number(a.member.id) } };
}

/**
 * 11/10(사용자) 문서 첨부 올리기 — PPT·한글·PDF, 50MB 까지. 방에 있는 누구나.
 *   작은 파일(3MB 이하): body.data(base64)를 서버가 R2 에 올림 → { url, name, size }
 *   큰 파일: body.size 만 보내면 R2 로 바로 PUT 할 서명 주소 → { put, headers, url, name } (버킷 CORS 에 PUT 필요)
 *   그다음 sendRoomMessage({ file: { url, name } }) 로 글을 남긴다.
 */
const FILE_FOLDER = 'room-files', FILE_MAX = 50 * 1024 * 1024, FILE_INLINE_MAX = 3 * 1024 * 1024;
async function roomFileUpload(body) {
  const a = await access(body.memberId, body.targetId, body.name);
  if (!a) return DENIED;
  if (!r2Configured()) return { error: '파일 저장소가 설정되지 않았어요.' };
  const name = cleanFileName(body.fileName);
  if (!name) return { error: 'PPT·한글(hwp·hwpx)·PDF 파일만 올릴 수 있어요.' };
  if (body.data) {
    const bytes = Buffer.from(String(body.data).replace(/^data:[^,]*,/, ''), 'base64');
    if (!bytes.length) return { error: '빈 파일이에요.' };
    if (bytes.length > FILE_INLINE_MAX) return { error: '파일이 커서 이 방법으로는 못 올려요.' };
    return { ok: true, url: await putDoc(bytes, name, FILE_FOLDER), name, size: bytes.length };
  }
  const size = Number(body.size) || 0;
  if (size > FILE_MAX) return { error: `파일은 ${FILE_MAX / 1024 / 1024}MB까지 올릴 수 있어요.` };
  return { ok: true, name, ...(await presignDoc(name, FILE_FOLDER)) };
}

/** 📌 고정·풀기 — 방에 있는 누구나. */
async function pinRoomMessage(body) {
  const a = await access(body.memberId, body.targetId, body.name);
  if (!a) return DENIED;
  const pinned = !!body.pinned;
  await run(db().from('target_room_messages').update({ pinned, pinned_by: pinned ? a.member.name : '' })
    .eq('id', Number(body.id)).eq('target_id', a.target.target_id).eq('deleted', false));
  return { ok: true };
}

/** 지우기 — 쓴 사람 또는 담당. 줄은 남기고 '지운 글'로. */
async function deleteRoomMessage(body) {
  const a = await access(body.memberId, body.targetId, body.name);
  if (!a) return DENIED;
  const [m] = await run(db().from('target_room_messages').select('id, from_nid, photo, file_url').eq('id', Number(body.id)).eq('target_id', a.target.target_id).limit(1));
  if (!m) return { error: '없는 글이에요.' };
  if (m.from_nid !== a.nid && !a.isOwner) return { error: '내가 쓴 글만 지울 수 있어요.' };
  await run(db().from('target_room_messages').update({ deleted: true, pinned: false, body: '', photo: '', file_url: '', file_name: '', file_size: 0 }).eq('id', m.id));
  if (m.file_url) await deleteStored(m.file_url);
  return { ok: true };
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
  if (!a || !a.isOwner) return { error: '초대는 담당 교사만 할 수 있어요.' };
  const q = str(body.query).slice(0, 20);
  if (q.length < 2) return { rows: [] };
  const [rows, inRoom] = await Promise.all([
    findPeople(q),
    run(db().from('target_room_members').select('nid').eq('target_id', a.target.target_id)),
  ]);
  const joined = new Set(inRoom.map((m) => m.nid));
  return { rows: rows.map((t) => ({ key: inviteKey(t.nid), name: t.name, dept: t.dept, region: t.region, affiliation: t.affiliation, position: t.position, joined: joined.has(t.nid) })) };
}

/** 초대 — 앱은 key 와 찾을 때 쓴 말(query)을 보낸다. 같은 검색을 다시 해서 서명이 맞는 사람만. */
async function inviteToRoom(body) {
  const a = await access(body.memberId, body.targetId, body.name);
  if (!a || !a.isOwner) return { error: '초대는 담당 교사만 할 수 있어요.' };
  const q = str(body.query).slice(0, 20);
  const t = q.length >= 2 ? (await findPeople(q)).find((p) => inviteKey(p.nid) === str(body.key)) : null;
  if (!t) return { error: '명단에서 찾지 못했어요.' };
  try {
    await run(db().from('target_room_members').insert({ target_id: a.target.target_id, member_id: t.member_id, name: t.name, role: '초대', invited_by: a.member.name, joined_at: kstDateTime() }));
  } catch (e) {
    if (isDuplicate(e)) return { error: `${t.name} 님은 이미 이 방에 있어요.` };
    throw e;
  }
  await run(db().from('target_room_messages').insert({ target_id: a.target.target_id, from_id: '', from_name: '', body: `${a.member.name} 님이 ${t.name} 님을 초대했어요.`, created_at: kstDateTime() }));
  return { ok: true, name: t.name };
}

/** 내보내기(담당) 또는 나가기(본인). 담당 줄은 못 뺀다. */
async function leaveRoom(body) {
  const a = await access(body.memberId, body.targetId, body.name);
  if (!a) return DENIED;
  const key = Number(body.key) || Number(a.member.id);
  const [m] = await run(db().from('target_room_members').select('*').eq('id', key).eq('target_id', a.target.target_id).limit(1));
  if (!m) return { error: '이 방에 없는 분이에요.' };
  const self = m.nid === a.nid;
  if (!self && !a.isOwner) return { error: '내보내기는 담당 교사만 할 수 있어요.' };
  if (m.role === '담당' && owns(a.target, m.nid)) return { error: '담당 교사는 방에서 뺄 수 없어요.' };
  await run(db().from('target_room_members').delete().eq('id', m.id));
  await run(db().from('target_room_messages').insert({ target_id: a.target.target_id, from_id: '', from_name: '', body: self ? `${m.name} 님이 나갔어요.` : `${a.member.name} 님이 ${m.name} 님을 내보냈어요.`, created_at: kstDateTime() }));
  return { ok: true };
}

/**
 * 11/10(사용자): "피드백 방을 제거할 수 있도록" — 담당 교사만. 대화·첨부 파일·사진·초대 링크·방 사람 모두 지운다.
 * 섭외자와 활동 기록은 그대로(방만 없어짐). 다시 열면 빈 방이 새로 생긴다.
 */
async function deleteRoom(body) {
  const a = await access(body.memberId, body.targetId, body.name);
  if (!a) return DENIED;
  if (!a.isOwner) return { error: '피드백방은 담당 교사만 없앨 수 있어요.' };
  const tid = a.target.target_id;
  const msgs = await run(db().from('target_room_messages').select('photo, file_url').eq('target_id', tid));
  const urls = msgs.flatMap((m) => [m.file_url, m.photo]).filter((u) => u && isStoredUrl(u));
  await Promise.all(urls.map((u) => deleteStored(u).catch(() => {})));
  await run(db().from('target_room_messages').delete().eq('target_id', tid));
  await run(db().from('target_room_invites').delete().eq('target_id', tid));
  await run(db().from('target_room_members').delete().eq('target_id', tid));
  return { ok: true, files: urls.length };
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
      .in('kind', [INFO_KIND, INFO_FB_KIND, MASTER_KIND, PLAN_KIND]).order('id', { ascending: false })),
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
    infoFeedback: of(INFO_FB_KIND), master: of(MASTER_KIND), plans,
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

/** 내가 들어가 있는 섭외자 대화방 목록(새 글 수·마지막 글). */
async function listMyRooms(body) {
  const mid = str(body.memberId);
  if (!mid) return { rows: [] };
  const nid = normId(mid);
  const mine = await run(db().from('target_room_members').select('target_id, role, last_read_id').eq('nid', nid).order('id'));
  if (!mine.length) return { rows: [] };
  const ids = mine.map((m) => m.target_id);
  const [targets, msgs, counts] = await Promise.all([
    run(db().from('targets').select('*').in('target_id', ids)),
    run(db().from('target_room_messages').select('id, target_id, from_nid, from_name, body, photo, file_name, created_at, deleted').in('target_id', ids)
      .gt('id', Math.min(...mine.map((m) => Number(m.last_read_id) || 0))).order('id')),
    run(db().from('target_room_members').select('target_id').in('target_id', ids)),
  ]);
  const byId = new Map(targets.map((t) => [t.target_id, t]));
  const rows = (await Promise.all(mine.map(async (m) => {
    const t = byId.get(m.target_id);
    if (!t) return null;
    const own = owns(t, nid);
    const list = msgs.filter((x) => x.target_id === m.target_id);
    const unread = list.filter((x) => Number(x.id) > Number(m.last_read_id) && x.from_nid !== nid && !x.deleted).length;
    const last = list[list.length - 1];
    return {
      ...targetView(t, own), isOwner: own, unread, members: counts.filter((c) => c.target_id === m.target_id).length,
      last: last ? { text: last.deleted ? '(지운 글)' : (scrubNames(last.body, await targetNamesOf(ownersOf(t), [t.target_name]))) || (last.file_name ? '📎 ' + last.file_name : last.photo ? '📷 사진' : ''), from: last.from_name, at: fmtTs(last.created_at).slice(5, 16) } : null,
    };
  }))).filter(Boolean);
  return { rows: rows.sort((x, y) => (y.unread - x.unread) || String((y.last || {}).at || '').localeCompare(String((x.last || {}).at || ''))) };
}

/** getNewMarks 에서 — 내 방들의 안 읽은 글 수(내가 쓴 것·지운 것 빼고). */
export async function roomUnread(nid) {
  const mine = await run(db().from('target_room_members').select('target_id, last_read_id').eq('nid', nid));
  if (!mine.length) return 0;
  const min = Math.min(...mine.map((m) => Number(m.last_read_id) || 0));
  const msgs = await run(db().from('target_room_messages').select('id, target_id, from_nid').in('target_id', mine.map((m) => m.target_id)).gt('id', min).eq('deleted', false).limit(1000));
  const last = new Map(mine.map((m) => [m.target_id, Number(m.last_read_id) || 0]));
  return msgs.filter((x) => Number(x.id) > last.get(x.target_id) && x.from_nid !== nid).length;
}

export default { deleteRoom, createRoomInvite, revokeRoomInvite, joinRoomByCode, getTargetRoom, sendRoomMessage, roomFileUpload, pinRoomMessage, deleteRoomMessage, searchRoomInvitees, inviteToRoom, leaveRoom, getRoomRecords, listMyRooms };
