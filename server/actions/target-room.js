// 2026-11-06(사용자): 섭외자 대화방 — "섭외자 방 안에 대화방을 만들어 초대한 사람이 들어와 중요 정보를 거기서 나누게.
//   텔레그램 정보와 섞이지 않고 중요 정보는 한 곳에". 결정: 명단의 누구나 초대 / 초대받은 사람도 대화·정보 기록·활동 이력을 봄(읽기만) /
//   알림은 앱 N 뱃지만(getNewMarks 의 room).
// 들어올 수 있는 사람 = 그 섭외자의 담당(처음 기록한 교사·인도자·섬김이) + 담당이 초대한 사람. 초대·내보내기는 담당만.
// 초대 화면의 명단 찾기는 고유번호를 돌려주지 않는다(로그인 = 번호·이름·부서라서) — 서버 서명(inviteKey)을 열쇠로 쓴다.
import { createHmac } from 'node:crypto';
import { db, run, isDuplicate } from '../lib/db.js';
import { normId, str, kstDateTime, fmtTs } from '../lib/util.js';
import { maskName } from '../lib/report-room.js';
import { storeImage } from '../lib/images.js';
import { findTeacherLoose } from './roster.js';
import { findTarget, owns, activitiesAbout } from './targets.js';

const INFO_KIND = '파악정보';   // targets.js 의 정보 기록과 같은 값
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

const toMsg = (m, nid) => ({
  id: Number(m.id), from: m.from_name, mine: m.from_nid === nid, text: m.deleted ? '' : m.body, photo: m.deleted ? '' : m.photo,
  pinned: !m.deleted && m.pinned, deleted: m.deleted, at: fmtTs(m.created_at),
});
const targetView = (t, isOwner) => ({
  id: t.target_id, name: isOwner ? t.target_name : maskName(t.target_name), stage: t.stage || '섭외',
  gender: t.gender || '', ageGroup: t.age_group || '', teacher: t.teacher_name || '',
});

async function markRead(a, lastId) {
  if (lastId > Number(a.member.last_read_id || 0)) await run(db().from('target_room_members').update({ last_read_id: lastId }).eq('id', a.member.id));
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
  const out = { ok: true, messages: rows.map((m) => toMsg(m, a.nid)), isOwner: a.isOwner };
  if (after) return out;
  // 처음 열 때만: 섭외자·멤버·고정 글(300개보다 오래된 고정 글도)
  const [members, pins] = await Promise.all([
    run(db().from('target_room_members').select('*').eq('target_id', a.target.target_id).order('id')),
    run(db().from('target_room_messages').select('*').eq('target_id', a.target.target_id).eq('pinned', true).eq('deleted', false).order('id')),
  ]);
  return {
    ...out, target: targetView(a.target, a.isOwner),
    members: members.map((m) => ({ key: Number(m.id), name: m.name, role: m.role, me: m.nid === a.nid, at: fmtTs(m.joined_at).slice(0, 10) })),
    pins: pins.map((m) => toMsg(m, a.nid)),
  };
}

async function sendRoomMessage(body) {
  const a = await access(body.memberId, body.targetId, body.name);
  if (!a) return DENIED;
  const text = str(body.text).slice(0, MAX_TEXT);
  const photo = body.photo ? await storeImage(body.photo, 'room') : '';
  if (!text && !photo) return { error: '내용을 적어 주세요.' };
  const [row] = await run(db().from('target_room_messages').insert({
    target_id: a.target.target_id, from_id: str(body.memberId), from_name: a.member.name || str(body.name), body: text, photo,
    pinned: !!body.pin, pinned_by: body.pin ? a.member.name : '', created_at: kstDateTime(),
  }).select('*'));
  await markRead(a, Number(row.id));
  return { ok: true, message: toMsg(row, a.nid) };
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
  const [m] = await run(db().from('target_room_messages').select('id, from_nid, photo').eq('id', Number(body.id)).eq('target_id', a.target.target_id).limit(1));
  if (!m) return { error: '없는 글이에요.' };
  if (m.from_nid !== a.nid && !a.isOwner) return { error: '내가 쓴 글만 지울 수 있어요.' };
  await run(db().from('target_room_messages').update({ deleted: true, pinned: false, body: '', photo: '' }).eq('id', m.id));
  return { ok: true };
}

/** 초대 열쇠 — 고유번호 대신 서버 비밀값으로 만든 서명(앱에 고유번호가 안 나가게). teachers 표엔 번호 칸(id)이 없다. */
const inviteKey = (nid) => createHmac('sha256', process.env.SUPABASE_SERVICE_ROLE_KEY || 'room').update('room-invite:' + nid).digest('base64url').slice(0, 22);
const findPeople = (q) => run(db().from('teachers').select('nid, member_id, name, dept, region, affiliation, position')
  .ilike('name', `%${q.replace(/[%_\\]/g, '\\$&')}%`).order('sort_order').limit(30));

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

/** 정보 기록 + 활동 이력 + 단계 이력(읽기만) — 방에 있는 누구나. */
async function getRoomRecords(body) {
  const a = await access(body.memberId, body.targetId, body.name);
  if (!a) return DENIED;
  const t = a.target;
  const [notes, acts, hist] = await Promise.all([
    run(db().from('target_ai_notes').select('id, input, text, created_at').eq('target_id', t.target_id).eq('kind', INFO_KIND).order('id', { ascending: false })),
    activitiesAbout(t),
    run(db().from('target_history').select('*').eq('target_id', t.target_id).order('id', { ascending: false })),
  ]);
  return {
    ok: true,
    info: notes.map((n) => ({ cat: n.input || '기타', text: n.text, at: fmtTs(n.created_at).slice(0, 16) })),
    acts: acts.sort((x, y) => (String(x.submitted_at) < String(y.submitted_at) ? 1 : -1)).map((x) => ({
      at: fmtTs(x.submitted_at).slice(0, 16), by: x.name, roles: x.roles || [], items: x.activities || [], stage: x.target_stage,
      consult: x.consult_title, subject: x.gospel_subject, reaction: x.reaction, reactionNote: x.reaction_note,
      today: x.today_work, next: x.next_work, special: x.special_note,
    })),
    history: hist.map((h) => ({ at: fmtTs(h.changed_at).slice(0, 10), from: h.from_stage, to: h.to_stage, memo: h.memo })),
  };
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
    run(db().from('target_room_messages').select('id, target_id, from_nid, from_name, body, photo, created_at, deleted').in('target_id', ids)
      .gt('id', Math.min(...mine.map((m) => Number(m.last_read_id) || 0))).order('id')),
    run(db().from('target_room_members').select('target_id').in('target_id', ids)),
  ]);
  const byId = new Map(targets.map((t) => [t.target_id, t]));
  const rows = mine.map((m) => {
    const t = byId.get(m.target_id);
    if (!t) return null;
    const own = owns(t, nid);
    const list = msgs.filter((x) => x.target_id === m.target_id);
    const unread = list.filter((x) => Number(x.id) > Number(m.last_read_id) && x.from_nid !== nid && !x.deleted).length;
    const last = list[list.length - 1];
    return {
      ...targetView(t, own), isOwner: own, unread, members: counts.filter((c) => c.target_id === m.target_id).length,
      last: last ? { text: last.deleted ? '(지운 글)' : last.body || (last.photo ? '📷 사진' : ''), from: last.from_name, at: fmtTs(last.created_at).slice(5, 16) } : null,
    };
  }).filter(Boolean);
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

export default { getTargetRoom, sendRoomMessage, pinRoomMessage, deleteRoomMessage, searchRoomInvitees, inviteToRoom, leaveRoom, getRoomRecords, listMyRooms };
