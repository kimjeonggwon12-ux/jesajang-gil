// 교재와 영상: 영상 등록·올리기 신청·승인, 교재 신청, 신청 댓글
import { db, run, selectAll } from '../lib/db.js';
import { normId, kstDate, kstDateTime, fmtTs } from '../lib/util.js';
import { clip, newId, isDate } from '../lib/input.js';
import { sendAlert, esc } from '../lib/alerts.js';
import { findTeacher, findAdmin, isAdmin, isOwner } from './roster.js';

export const VIDEO_PARTS = ['소양', '상담', '밭갈기', '무신앙', '복음방'];

const phoneOf = (v) => String(v == null ? '' : v).replace(/[^0-9+\-]/g, '').slice(0, 20);
const hasPhone = (phone) => phone.replace(/\D/g, '').length >= 9;
const isTest = (title) => /^\[TEST\]/.test(title);

/** 고른 코너 중 정해진 것만, 정해진 순서로. */
function partsOf(v) {
  const picked = (Array.isArray(v) ? v.map(String) : String(v == null ? '' : v).split(/[,，]/)).map((x) => x.trim());
  return VIDEO_PARTS.filter((p) => picked.includes(p));
}

/** 유튜브 주소(또는 11자리 번호)에서 영상 번호를 꺼낸다. */
function youtubeId(s) {
  const text = String(s == null ? '' : s).trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(text)) return text;
  const m = text.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/|\/v\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : '';
}

// ── 권한 ──

/** 바로 올리기·승인·삭제: 관리자 중 교육·전도 담당(또는 앱 관리자). */
export async function isApprover(memberId) {
  if (isOwner(memberId)) return true;
  if (!(await isAdmin(memberId))) return false;
  const [admin, teacher] = await Promise.all([findAdmin(memberId), findTeacher(memberId)]);
  return /교육|전도/.test([admin?.position, admin?.dept, teacher?.position].join(' '));
}

/** 신청: 교사명단에 있는 사람(또는 관리자). */
const canRequest = async (memberId) => (await isAdmin(memberId)) || !!(await findTeacher(memberId));

const displayName = async (memberId, order, fallback) => {
  const [teacher, admin] = await Promise.all([findTeacher(memberId), findAdmin(memberId)]);
  const found = order === 'admin-first' ? (admin || teacher) : (teacher || admin);
  return found?.name || clip(fallback, 40);
};

// ── 영상 목록 ──

/** 지워지지 않은 영상(최근 올린 순). all 이 아니면 신청·반려 상태는 뺀다. */
export async function videoRows(all = false) {
  const rows = await selectAll(() => db().from('videos').select('*').neq('status', '삭제').order('id'));
  return rows
    .filter((v) => all || (v.status !== '신청' && v.status !== '반려'))
    .sort((a, b) => (a.upload_date < b.upload_date ? 1 : a.upload_date > b.upload_date ? -1 : (a.id < b.id ? 1 : -1)));
}

const toVideo = (v) => ({
  id: v.video_key, videoId: v.youtube_id, title: v.title, part: v.parts.join(','), parts: v.parts,
  description: v.description, uploadDate: v.upload_date, createdBy: v.created_by,
});

async function getVideos(body) {
  const part = clip(body.part, 20);
  const [videos, done] = await Promise.all([
    videoRows(),
    selectAll(() => db().from('video_transcripts').select('video_key, youtube_id, summary').eq('status', '완료').order('id')),
  ]);
  const briefOf = new Map(done.map((t) => [t.video_key, t]));
  return {
    parts: VIDEO_PARTS,
    videos: videos.filter((v) => !part || v.parts.includes(part)).map((v) => {
      const video = toVideo(v);
      const brief = briefOf.get(v.video_key);
      // 녹취·자료가 다 만들어진 영상은 목록에서 요약을 바로 볼 수 있게 한다.
      if (brief && brief.youtube_id === v.youtube_id) { video.docs = true; video.sum = brief.summary.slice(0, 2500); }
      return video;
    }),
  };
}

/** 유튜브에서 제목을 가져온다. */
async function getVideoInfo(body) {
  const mid = clip(body.memberId, 40);
  if (!mid || !(await canRequest(mid))) return { error: '교사명단에 있는 교사만 쓸 수 있어요.' };
  const videoId = youtubeId(body.url);
  if (!videoId) return { error: '유튜브 주소를 확인해 주세요.' };
  return fetchVideoInfo(videoId);
}

async function fetchVideoInfo(videoId) {
  try {
    const watch = encodeURIComponent('https://www.youtube.com/watch?v=' + videoId);
    const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + watch);
    if (r.status === 200) {
      const j = await r.json();
      return { videoId, title: String(j.title || ''), author: String(j.author_name || '') };
    }
    return { videoId, title: '', warning: '제목을 가져오지 못했어요(비공개이거나 퍼가기가 막힌 영상일 수 있어요). 제목을 직접 써 주세요.' };
  } catch {
    return { videoId, title: '' };
  }
}

// ── 중복 확인 ──

const normTitle = (t) => String(t == null ? '' : t).toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
const numbersIn = (t) => (String(t || '').match(/\d+/g) || []).join(',');

/** 제목이 사실상 같은가: 숫자가 같고, 한쪽이 다른 쪽에 들어가거나 두 글자 묶음이 72% 이상 겹치면 같다고 본다. */
function similarTitle(rawA, rawB) {
  if (numbersIn(rawA) !== numbersIn(rawB)) return false;
  const a = normTitle(rawA);
  const b = normTitle(rawB);
  if (a.length < 4 || b.length < 4) return false;
  if (a === b) return true;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  if (short.length >= 8 && long.includes(short)) return true;
  const bigrams = (x) => {
    const m = {};
    for (let i = 0; i < x.length - 1; i++) { const k = x.substr(i, 2); m[k] = (m[k] || 0) + 1; }
    return m;
  };
  const A = bigrams(a);
  const B = bigrams(b);
  let hit = 0;
  for (const k in A) hit += Math.min(A[k], B[k] || 0);
  return (2 * hit) / (a.length - 1 + b.length - 1) >= 0.72;
}

/** 같은 영상(same)과 제목이 비슷한 영상(similar, 3개까지). 반려된 신청은 보지 않는다. */
async function findDuplicates(videoId, title, exceptKey) {
  const rows = (await videoRows(true)).filter((v) => v.video_key !== exceptKey && v.status !== '반려');
  return {
    same: rows.find((v) => v.youtube_id === videoId) || null,
    similar: rows.filter((v) => v.youtube_id !== videoId && similarTitle(v.title, title)).slice(0, 3)
      .map((v) => ({ title: v.title, videoId: v.youtube_id, pending: v.status === '신청' })),
  };
}

/** 화면에서 받은 영상 정보를 다듬는다. 문제가 있으면 { error }. */
async function readVideoInput(v, partsError) {
  const videoId = youtubeId(v.url || v.videoId);
  if (!videoId) return { error: '유튜브 주소를 확인해 주세요.' };
  const parts = partsOf(v.parts || v.part);
  if (!parts.length) return { error: partsError };
  let title = clip(v.title, 120);
  if (/^https?:|youtu.?be/i.test(title)) title = '';   // 제목 칸에 주소를 붙여 넣은 경우 → 진짜 제목으로
  if (!title) title = clip((await fetchVideoInfo(videoId)).title, 120);
  if (!title) return { error: '제목을 입력해 주세요.' };
  return { videoId, parts, title, description: clip(v.description, 50) };
}

// ── 등록·신청·승인 ──

/** 교육부·전도부가 영상을 바로 올리거나 고친다. */
async function saveVideo(body) {
  const mid = clip(body.memberId, 40);
  if (!mid || !(await isApprover(mid))) return { error: '영상을 바로 올리는 것은 교육부·전도부만 할 수 있어요. [영상 신청]으로 신청해 주세요.' };
  const v = body.video || {};
  const input = await readVideoInput(v, '파트를 하나 이상 골라 주세요.');
  if (input.error) return input;
  const date = isDate(String(v.uploadDate || '')) ? String(v.uploadDate) : kstDate();
  const key = clip(v.id, 40);

  const dup = await findDuplicates(input.videoId, input.title, key);
  if (dup.same) return { error: `이미 ${dup.same.status === '신청' ? '신청이 들어와 있는' : '올라와 있는'} 영상이에요: 「${dup.same.title}」` };
  if (dup.similar.length && !v.force) return { needConfirm: true, similar: dup.similar };

  const fields = { youtube_id: input.videoId, title: input.title, parts: input.parts, description: input.description, upload_date: date, updated_at: kstDateTime() };
  if (key) {
    const current = (await videoRows()).find((x) => x.video_key === key);
    if (!current) return { error: '영상을 찾을 수 없어요.' };
    await run(db().from('videos').update(fields).eq('id', current.id));
    return { ok: true, id: key };
  }
  const fresh = newId('VD');
  await run(db().from('videos').insert({
    video_key: fresh, ...fields, created_by_id: mid, created_by: (await findAdmin(mid))?.name || clip(body.name, 40), status: '',
  }));
  return { ok: true, id: fresh };
}

/** 교사가 영상 올리기를 신청한다(교육부·전도부 승인 뒤 게시). */
async function requestVideo(body) {
  const mid = clip(body.memberId, 40);
  if (!mid || !(await canRequest(mid))) return { error: '영상 올리기 신청은 교사명단에 있는 교사만 할 수 있어요.' };
  const v = body.video || {};
  const input = await readVideoInput(v, '넣을 코너를 하나 이상 골라 주세요.');
  if (input.error) return input;
  const phone = phoneOf(v.phone);
  if (!hasPhone(phone)) return { error: '연락받을 전화번호를 적어 주세요.' };

  const dup = await findDuplicates(input.videoId, input.title, '');
  if (dup.same) return { error: `${dup.same.status === '신청' ? '이미 신청이 들어와 승인을 기다리는 영상이에요' : '이미 올라와 있는 영상이에요'}: 「${dup.same.title}」` };
  if (dup.similar.length && !v.force) return { needConfirm: true, similar: dup.similar };

  const who = await displayName(mid, 'roster-first', body.name);
  const part = input.parts.join(',');
  const fresh = newId('VD');
  await run(db().from('videos').insert({
    video_key: fresh, youtube_id: input.videoId, title: input.title, parts: input.parts, description: input.description,
    upload_date: kstDate(), created_by_id: mid, created_by: who, status: '신청', updated_at: kstDateTime(), phone,
  }));
  if (!isTest(input.title)) {
    await sendAlert(`🎬 <b>영상 올리기 신청</b>\n👤 ${esc(who)}\n📝 ${esc(input.title)}\n🗂️ 코너: ${esc(part)}\n🔗 https://youtu.be/${input.videoId}\n📞 ${esc(phone)}` +
      '\n\n교재·영상 → 영상 신청에서 승인해 주세요.', '영상신청', '영상신청|' + fresh);
  }
  return { ok: true, id: fresh, title: input.title };
}

const allWishes = async () =>
  (await selectAll(() => db().from('textbook_wishes').select('*').neq('status', '삭제').order('id'))).reverse();   // 최신순

/** 신청마다 달린 글. */
async function commentsFor(requestIds) {
  const out = {};
  if (!requestIds.length) return out;
  const rows = await selectAll(() => db().from('request_comments').select('*').in('request_id', requestIds).order('id'));
  const staffOf = new Map();
  for (const c of rows) {
    if (!c.comment_id) continue;
    if (!staffOf.has(c.member_id)) staffOf.set(c.member_id, await isApprover(c.member_id));
    (out[c.request_id] ||= []).push({ id: c.comment_id, name: c.name, text: c.body, at: fmtTs(c.created_at).slice(0, 16), staff: staffOf.get(c.member_id) });
  }
  return out;
}

/** 신청함: 내가 낸 신청(영상·교재) + 승인 담당이면 대기 중인 모든 신청. */
async function getVideoRequests(body) {
  const mid = clip(body.memberId, 40);
  if (!mid) return { error: 'memberId' };
  const nid = normId(mid);
  const [approver, requester, videos, wishRows] = await Promise.all([isApprover(mid), canRequest(mid), videoRows(true), allWishes()]);
  const mine = (id) => normId(id) === nid;

  const requests = videos
    .filter((v) => (v.status === '신청' || v.status === '반려') && (mine(v.created_by_id) || (approver && v.status === '신청')))
    .map((v) => ({
      id: v.video_key, videoId: v.youtube_id, title: v.title, part: v.parts.join(','), description: v.description, requestDate: v.upload_date,
      createdBy: v.created_by, status: v.status, mine: mine(v.created_by_id), phone: approver ? v.phone : '',
    }));
  const wishes = wishRows
    .filter((w) => mine(w.member_id) || (approver && (w.status || '신청') === '신청'))
    .map((w) => ({
      id: w.wish_id, title: w.title, part: w.part, note: w.note, requestDate: fmtTs(w.requested_at).slice(0, 10),
      createdBy: w.name, status: w.status || '신청', mine: mine(w.member_id), phone: approver ? w.phone : '',
    }));
  return {
    isApprover: approver, canRequest: requester, wishes, requests,
    comments: await commentsFor([...requests, ...wishes].map((r) => r.id)),
  };
}

/** 영상 신청을 승인(게시)하거나 반려한다. 승인하면서 제목·코너·설명을 고칠 수 있다. */
async function reviewVideoRequest(body) {
  const mid = clip(body.memberId, 40);
  if (!mid || !(await isApprover(mid))) return { error: '승인은 교육부·전도부만 할 수 있어요.' };
  const key = clip(body.id, 40);
  const current = (await videoRows(true)).find((v) => v.video_key === key);
  if (!current || current.status !== '신청') return { error: '이미 처리됐거나 없는 신청이에요.' };
  const now = kstDateTime();
  if (!body.approve) {
    await run(db().from('videos').update({ status: '반려', updated_at: now }).eq('id', current.id));
    return { ok: true, status: '반려' };
  }
  const asked = partsOf(body.parts || body.part);
  const parts = asked.length ? asked : current.parts;
  if (!parts.length) return { error: '넣을 코너를 하나 이상 골라 주세요.' };
  const title = clip(body.title, 120) || current.title;
  const description = body.description == null ? current.description : clip(body.description, 50);
  await run(db().from('videos').update({ title, parts, description, upload_date: kstDate(), status: '', updated_at: now }).eq('id', current.id));
  return { ok: true, status: '승인', id: key, videoId: current.youtube_id, title, part: parts.join(',') };
}

async function deleteVideo(body) {
  const mid = clip(body.memberId, 40);
  if (!mid || !(await isApprover(mid))) return { error: '영상 삭제는 교육부·전도부만 할 수 있어요.' };
  const current = (await videoRows()).find((v) => v.video_key === clip(body.id, 40));
  if (!current) return { error: '영상을 찾을 수 없어요.' };
  await run(db().from('videos').update({ status: '삭제', updated_at: kstDateTime() }).eq('id', current.id));
  return { ok: true };
}

// ── 교재 신청 ──

async function requestTextbook(body) {
  const mid = clip(body.memberId, 40);
  if (!mid || !(await canRequest(mid))) return { error: '교재 신청은 교사명단에 있는 교사만 할 수 있어요.' };
  const w = body.wish || {};
  const title = clip(w.title, 80);
  const note = clip(w.note, 300);
  const part = clip(w.part, 20);
  if (!title) return { error: '희망하는 교재를 적어 주세요.' };
  const phone = phoneOf(w.phone);
  if (!hasPhone(phone)) return { error: '연락받을 전화번호를 적어 주세요.' };
  const who = await displayName(mid, 'roster-first', body.name);
  const fresh = newId('TW');
  await run(db().from('textbook_wishes').insert({
    wish_id: fresh, member_id: mid, name: who, part, title, note, requested_at: kstDateTime(), status: '신청', phone,
  }));
  if (!isTest(title)) {
    await sendAlert(`📚 <b>교재 신청</b>\n👤 ${esc(who)}\n📝 ${esc(title)}` + (part ? `\n🗂️ 분류: ${esc(part)}` : '') +
      (note ? `\n💬 ${esc(note)}` : '') + `\n📞 ${esc(phone)}`, '교재신청', '교재신청|' + fresh);
  }
  return { ok: true, id: fresh };
}

/** 교재 신청을 확인 처리하거나(remove 면) 지운다. */
async function reviewTextbookRequest(body) {
  const mid = clip(body.memberId, 40);
  if (!mid || !(await isApprover(mid))) return { error: '확인은 교육부·전도부만 할 수 있어요.' };
  const [current] = await run(db().from('textbook_wishes').select('id').eq('wish_id', clip(body.id, 40)).neq('status', '삭제').limit(1));
  if (!current) return { error: '신청을 찾을 수 없어요.' };
  await run(db().from('textbook_wishes').update({
    status: body.remove ? '삭제' : '확인', handler: (await findAdmin(mid))?.name || '', handled_at: kstDateTime(),
  }).eq('id', current.id));
  return { ok: true };
}

/** 신청에 글 남기기: 신청한 본인과 승인 담당만. */
async function addRequestComment(body) {
  const mid = clip(body.memberId, 40);
  const requestId = clip(body.reqId, 40);
  const text = clip(body.text, 300);
  if (!mid || !requestId) return { error: '신청을 찾을 수 없어요.' };
  if (!text) return { error: '내용을 적어 주세요.' };
  const video = (await videoRows(true)).find((v) => v.video_key === requestId);
  const wish = video ? null : (await allWishes()).find((w) => w.wish_id === requestId);
  if (!video && !wish) return { error: '신청을 찾을 수 없어요.' };
  const owner = video ? video.created_by_id : wish.member_id;
  const staff = await isApprover(mid);
  if (!staff && normId(owner) !== normId(mid)) return { error: '내가 낸 신청에만 글을 남길 수 있어요.' };
  const who = await displayName(mid, 'admin-first', body.name);
  const fresh = newId('RC');
  const now = kstDateTime();
  await run(db().from('request_comments').insert({ comment_id: fresh, request_id: requestId, member_id: mid, name: who, body: text, created_at: now }));
  return { ok: true, comment: { id: fresh, name: who, text, at: now.slice(0, 16), staff } };
}

export default {
  getVideos, getVideoInfo, saveVideo, requestVideo, getVideoRequests, reviewVideoRequest, deleteVideo,
  requestTextbook, reviewTextbookRequest, addRequestComment,
};
