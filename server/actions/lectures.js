// 영상 인강 (2026-10-20) — 교재·영상에 등록된 영상을 강좌로 묶어 차례대로 듣고, 교사마다 진도·이수를 남긴다.
// 강좌 만들기·고치기는 교육부·전도부(isApprover), 듣기는 교사명단에 있는 사람(또는 관리자).
// 진도는 화면이 유튜브 플레이어의 재생 위치로 센 10초 칸(buckets)을 보내면 합쳐 둔다. 영상 길이의 90% 이상이면 그 강 이수.
import { db, run, selectAll } from '../lib/db.js';
import { normId, kstDateTime, fmtTs } from '../lib/util.js';
import { clip, newId } from '../lib/input.js';
import { findTeacher, findAdmin, isAdmin, isApprover } from './roster.js';
import { videoRows, VIDEO_PARTS } from './videos.js';

const BUCKET = 10;          // 초
const DONE_RATIO = 0.9;     // 이만큼 보면 이수

const canWatch = async (memberId) => (await isAdmin(memberId)) || !!(await findTeacher(memberId));
const covered = (buckets, duration) => Math.min(duration, buckets.length * BUCKET);
const pctOf = (buckets, duration) => (duration > 0 ? Math.min(100, Math.round((covered(buckets, duration) / duration) * 100)) : 0);

async function lectureRows() {
  return selectAll(() => db().from('lectures').select('*').neq('status', '삭제').order('id'));
}

/** 강좌 목록 — 강마다 영상 정보, 내 진도(memberId 가 있으면). 숨긴 강좌는 교육부·전도부만 본다. */
async function getLectures(body) {
  const mid = clip(body.memberId, 40);
  const [rows, videos, done, approver] = await Promise.all([
    lectureRows(),
    videoRows(),
    selectAll(() => db().from('video_transcripts').select('video_key, youtube_id').eq('status', '완료').order('id')),
    mid ? isApprover(mid) : false,
  ]);
  const mine = mid
    ? await selectAll(() => db().from('lecture_progress').select('*').eq('nid', normId(mid)).order('id'))
    : [];
  const videoOf = new Map(videos.map((v) => [v.video_key, v]));
  const docs = new Set(done.map((t) => t.video_key));
  const progOf = new Map(mine.map((p) => [`${p.lecture_id}|${p.video_key}`, p]));

  const lectures = rows.filter((l) => approver || l.status === '').map((l) => {
    const lessons = (Array.isArray(l.lessons) ? l.lessons : []).map((key) => {
      const v = videoOf.get(key);
      if (!v) return null;   // 영상이 지워졌으면 강에서 뺀다
      const p = progOf.get(`${l.lecture_id}|${key}`);
      const buckets = Array.isArray(p?.buckets) ? p.buckets : [];
      return {
        id: v.video_key, videoId: v.youtube_id, title: v.title, part: v.parts.join(','), uploadDate: v.upload_date, description: v.description,
        docs: docs.has(v.video_key), duration: p?.duration || 0, pct: p?.completed ? 100 : pctOf(buckets, p?.duration || 0),
        completed: !!p?.completed, lastPos: p?.last_pos || 0,
      };
    }).filter(Boolean);
    const doneN = lessons.filter((x) => x.completed).length;
    return {
      lectureId: l.lecture_id, title: l.title, part: l.part, instructor: l.instructor, description: l.description,
      featured: l.featured, hidden: l.status === '숨김', createdBy: l.created_by, updatedAt: fmtTs(l.updated_at),
      lessons, doneCount: doneN, completed: lessons.length > 0 && doneN === lessons.length,
      started: lessons.some((x) => x.pct > 0 || x.completed),
    };
  });
  // 우수 강의 먼저, 그다음 최근 고친 순
  lectures.sort((a, b) => (a.featured !== b.featured ? (a.featured ? -1 : 1) : a.updatedAt < b.updatedAt ? 1 : -1));
  return { lectures, parts: VIDEO_PARTS, approver };
}

/** 강좌 만들기·고치기(교육부·전도부). lessons = 등록된 영상 key 순서. */
async function saveLecture(body) {
  const mid = clip(body.memberId, 40);
  if (!mid || !(await isApprover(mid))) return { error: '강좌는 교육부·전도부만 만들 수 있어요.' };
  const l = body.lecture || {};
  const title = clip(l.title, 80);
  if (!title) return { error: '강좌 이름을 적어 주세요.' };
  const valid = new Set((await videoRows()).map((v) => v.video_key));
  const lessons = [...new Set((Array.isArray(l.lessons) ? l.lessons : []).map((k) => clip(k, 40)))].filter((k) => valid.has(k)).slice(0, 50);
  if (!lessons.length) return { error: '강의 영상을 하나 이상 넣어 주세요.' };
  const fields = {
    title, lessons, part: VIDEO_PARTS.includes(l.part) ? l.part : '', instructor: clip(l.instructor, 40), description: clip(l.description, 1000),
    featured: !!l.featured, status: l.hidden ? '숨김' : '', updated_at: kstDateTime(),
  };
  const id = clip(l.lectureId, 40);
  if (id) {
    const [row] = await run(db().from('lectures').select('id').eq('lecture_id', id).neq('status', '삭제').limit(1));
    if (!row) return { error: '강좌를 찾을 수 없어요.' };
    await run(db().from('lectures').update(fields).eq('id', row.id));
    return { ok: true, lectureId: id };
  }
  const fresh = newId('LC');
  const who = (await findAdmin(mid))?.name || (await findTeacher(mid))?.name || clip(body.name, 40);
  await run(db().from('lectures').insert({ lecture_id: fresh, ...fields, created_by: who, created_at: kstDateTime() }));
  return { ok: true, lectureId: fresh };
}

async function deleteLecture(body) {
  const mid = clip(body.memberId, 40);
  if (!mid || !(await isApprover(mid))) return { error: '강좌는 교육부·전도부만 지울 수 있어요.' };
  await run(db().from('lectures').update({ status: '삭제', updated_at: kstDateTime() }).eq('lecture_id', clip(body.lectureId, 40)));
  return { ok: true };
}

/** 진도 저장 — 본 10초 칸을 지난 것과 합치고, 90% 넘으면 이수. */
async function saveLectureProgress(body) {
  const mid = clip(body.memberId, 40);
  if (!mid || !(await canWatch(mid))) return { error: '교사명단에 있는 교사만 진도가 남아요.' };
  const lectureId = clip(body.lectureId, 40), videoKey = clip(body.videoKey, 40);
  const [lec] = await run(db().from('lectures').select('lessons').eq('lecture_id', lectureId).neq('status', '삭제').limit(1));
  if (!lec || !(lec.lessons || []).includes(videoKey)) return { error: '강좌를 찾을 수 없어요.' };
  const duration = Math.max(0, Math.min(6 * 3600, Math.round(Number(body.duration) || 0)));
  const maxB = Math.ceil((duration || 6 * 3600) / BUCKET);
  const fresh = (Array.isArray(body.buckets) ? body.buckets : []).map(Number).filter((b) => Number.isInteger(b) && b >= 0 && b <= maxB);
  const lastPos = Math.max(0, Math.round(Number(body.lastPos) || 0));

  const nid = normId(mid);
  const [cur] = await run(db().from('lecture_progress').select('*').eq('nid', nid).eq('lecture_id', lectureId).eq('video_key', videoKey).limit(1));
  const buckets = [...new Set([...(cur?.buckets || []), ...fresh])].sort((a, b) => a - b);
  const dur = Math.max(duration, cur?.duration || 0);
  const nowDone = !!cur?.completed || (dur > 0 && covered(buckets, dur) >= dur * DONE_RATIO);
  const now = kstDateTime();
  const name = (await findTeacher(mid))?.name || (await findAdmin(mid))?.name || clip(body.name, 20);
  const fields = { member_id: mid, name, lecture_id: lectureId, video_key: videoKey, buckets, duration: dur, last_pos: lastPos, completed: nowDone, updated_at: now };
  if (nowDone && !cur?.completed) fields.completed_at = now;
  if (cur) await run(db().from('lecture_progress').update(fields).eq('id', cur.id));
  else await run(db().from('lecture_progress').insert(fields));
  return { ok: true, pct: nowDone ? 100 : pctOf(buckets, dur), completed: nowDone, justCompleted: nowDone && !cur?.completed };
}

/** 강좌 수강 현황(교육부·전도부): 교사마다 들은 강 수·이수 여부. */
async function getLectureStats(body) {
  const mid = clip(body.memberId, 40);
  if (!mid || !(await isApprover(mid))) return { error: '교육부·전도부만 볼 수 있어요.' };
  const lectureId = clip(body.lectureId, 40);
  const [lec] = await run(db().from('lectures').select('lessons').eq('lecture_id', lectureId).limit(1));
  if (!lec) return { error: '강좌를 찾을 수 없어요.' };
  const lessons = lec.lessons || [];
  const rows = await selectAll(() => db().from('lecture_progress').select('*').eq('lecture_id', lectureId).order('id'));
  const by = new Map();
  for (const p of rows) {
    if (!lessons.includes(p.video_key)) continue;
    const m = by.get(p.nid) || { name: p.name || p.member_id, memberId: p.member_id, done: 0, started: 0, last: '' };
    m.started++;
    if (p.completed) m.done++;
    const at = fmtTs(p.updated_at);
    if (at > m.last) m.last = at;
    by.set(p.nid, m);
  }
  const people = [...by.values()].map((m) => ({ ...m, completed: lessons.length > 0 && m.done >= lessons.length }))
    .sort((a, b) => (a.completed !== b.completed ? (a.completed ? -1 : 1) : b.done - a.done || (a.last < b.last ? 1 : -1)));
  return { total: lessons.length, people };
}

export default { getLectures, saveLecture, deleteLecture, saveLectureProgress, getLectureStats };
