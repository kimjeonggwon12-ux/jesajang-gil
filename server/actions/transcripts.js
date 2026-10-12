// 영상 녹취 → 요약 → 자료 패키지(교안·나눔질문·퀴즈·전도문구).
// 한 번 부를 때 한 단계만 한다(구간 하나 녹취 / 요약 / 자료). 화면이나 자동 실행이 '완료'가 될 때까지 되풀이해 부른다.
import { db, run, selectAll } from '../lib/db.js';
import { kstDateTime } from '../lib/util.js';
import { clip } from '../lib/input.js';
import { tryLock, unlock } from '../lib/locks.js';
import {
  SEGMENT_SECONDS, MAX_SEGMENTS, MODELS, SUMMARY_SPLIT, PACKAGE_PARTS, AUTO_SKIP,
  transcribePrompt, summaryPrompt, packagePrompt, parsePackage,
} from '../lib/video-prompts.js';
import { isAdmin } from './roster.js';
import { videoRows } from './videos.js';

const CELL_MAX = 49000;
const PACKAGE_KEYS = PACKAGE_PARTS.map(([key]) => key);
const END_MARK = /\[\[\s*영상\s*끝\s*\]\]/g;

const findRecord = async (videoKey) =>
  (await run(db().from('video_transcripts').select('*').eq('video_key', videoKey).limit(1)))[0] || null;

const missingParts = (rec) => PACKAGE_PARTS.filter(([key]) => !rec.pkg[key]);
const joined = (rec) => rec.texts.slice(0, rec.segs).join('\n\n').trim();

async function getVideoTranscript(body) {
  const key = clip(body.id, 40);
  const rec = key ? await findRecord(key) : null;
  if (!rec) return { exists: false };
  return {
    exists: true, status: rec.status, duration: rec.duration, segs: rec.segs, done: rec.done, summary: rec.summary,
    transcript: joined(rec), pkg: Object.fromEntries(PACKAGE_KEYS.map((k) => [k, rec.pkg[k] || ''])),
    updatedAt: rec.updated_at, error: rec.error,
  };
}

// ── AI 호출 ──

async function callGemini(payload, model) {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    return await r.json();
  } catch (e) {
    return { error: { code: 500, message: String(e.message || e) } };
  }
}

/** 응답에서 글만(생각 과정 제외). 길이 제한으로 잘렸으면 cut. */
function readAnswer(res) {
  const c = res?.candidates?.[0];
  if (!c) {
    const msg = res?.error?.message || '';
    return { error: '⚠️ AI 응답을 받아오지 못했습니다. 잠시 후 다시 시도해주세요.' + (msg ? ` (${msg})` : '') };
  }
  const text = (c.content?.parts || []).filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('').trim();
  return text ? { text, cut: c.finishReason === 'MAX_TOKENS' } : { error: `AI가 빈 응답을 보냈어요(${c.finishReason || ''}).` };
}

/**
 * 녹취용 모델을 차례로 써 본다(무료 한도가 작은 상담용 모델로는 넘어가지 않는다).
 * 붐빔·한도 초과면 다음 모델로, 그 밖의 오류는 바로 돌려준다.
 */
async function ask(payload, deadline = Date.now() + 120000) {
  let out = { error: 'AI 응답을 받지 못했어요.' };
  const tries = [];
  let quotaHits = 0;
  for (const model of MODELS) {
    const p = structuredClone(payload);
    let res;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (Date.now() > deadline) return { error: 'AI가 붐벼서 시간이 오래 걸리고 있어요. 잠시 뒤 이어서 만들게요.', busy: true, tries: tries.join(', ') };
      const t = Date.now();
      res = await callGemini(p, model);
      const code = res?.error?.code;
      tries.push(`${model}:${code || 'ok'}:${Math.round((Date.now() - t) / 1000)}s`);
      // 이 모델이 생각 수준·해상도 설정을 모르면 그 설정만 빼고 한 번 더.
      if (attempt === 0 && code && /thinking|mediaresolution|media_resolution/i.test(String(res.error.message || ''))) {
        delete p.generationConfig.thinkingConfig;
        delete p.generationConfig.mediaResolution;
        continue;
      }
      break;
    }
    out = { ...readAnswer(res), tries: tries.join(', ') };
    if (!out.error) return out;
    out.code = res?.error?.code;
    if (out.code === 429) quotaHits++;
    if (![429, 500, 503, 404].includes(out.code)) return out;
    out.busy = true;
  }
  if (quotaHits === MODELS.length) {
    out.quota = true;
    out.error = 'AI 하루 사용 한도를 다 썼어요. 한도가 풀리면 자동으로 이어서 만들어요.';
  }
  return out;
}

/** 유튜브 페이지에서 영상 길이(초)를 읽어 본다. 서버에서는 막혀서 0 이 나오는 일이 많다. */
async function fetchDuration(videoId) {
  try {
    const html = await (await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=ko`)).text();
    let m = html.match(/"lengthSeconds":"(\d+)"/);
    if (m) return Number(m[1]);
    m = html.match(/"approxDurationMs":"(\d+)"/);
    if (m) return Math.round(Number(m[1]) / 1000);
  } catch { /* 못 읽으면 0 */ }
  return 0;
}

// ── 한 단계 ──

/** 같은 영상을 두 곳(화면·자동 실행)에서 동시에 만들지 않게 잠그고 한 단계를 한다. */
async function step(video, opts) {
  const lockKey = 'vt_busy_' + video.video_key;
  if (!(await tryLock(lockKey, 360))) {
    return { error: '지금 다른 곳에서 이 영상의 녹취를 만들고 있어요. 잠시 뒤 확인해 주세요.', busy: true, other: true };
  }
  try { return await stepInner(video, opts); } finally { await unlock(lockKey); }
}

async function stepInner(video, opts) {
  const key = video.video_key;
  let rec = await findRecord(key);
  const save = async (patch) => {
    await run(db().from('video_transcripts').update({ updated_at: kstDateTime(), error: '', ...patch }).eq('video_key', key));
    Object.assign(rec, patch);
  };

  // 처음이거나, 다시 만들기거나, 영상 주소가 바뀌었으면 새로 시작한다.
  if (!rec || opts.restart || rec.youtube_id !== video.youtube_id) {
    let duration = Math.round(Number(opts.duration) || 0);   // 화면 플레이어·자동 실행기가 잰 길이
    if (!(duration > 0 && duration < 6 * 3600)) duration = await fetchDuration(video.youtube_id);
    const segs = duration ? Math.max(1, Math.ceil(duration / SEGMENT_SECONDS)) : 1;
    if (segs > MAX_SEGMENTS) return { error: '3시간이 넘는 영상은 녹취할 수 없어요.' };
    const now = kstDateTime();
    const fresh = {
      video_key: key, youtube_id: video.youtube_id, status: '진행중', duration, segs, done: 0, summary: '',
      created_at: now, created_by: opts.by || '', updated_at: now, error: '', texts: [], pkg: {},
    };
    [rec] = await run(db().from('video_transcripts').upsert(fresh, { onConflict: 'video_key' }).select());
  }
  if (opts.summaryOnly && rec.done >= rec.segs) await save({ summary: '' });

  const fail = async (o) => {
    await run(db().from('video_transcripts').update({ updated_at: kstDateTime(), error: o.error }).eq('video_key', key));
    return { error: o.error, busy: !!o.busy, quota: !!o.quota, tries: o.tries, status: '진행중', done: rec.done, segs: rec.segs };
  };

  // ① 녹취: 구간 하나
  const done = rec.done;
  if (done < rec.segs) {
    const open = !rec.duration;   // 길이를 모르는 영상: AI 가 [[영상끝]] 을 쓸 때까지 10분씩 이어 간다
    const start = done * SEGMENT_SECONDS;
    const end = rec.duration ? Math.min(rec.duration, start + SEGMENT_SECONDS) : start + SEGMENT_SECONDS;
    const previous = done > 0 ? rec.texts[done - 1] || '' : '';
    const media = { fileData: { fileUri: 'https://www.youtube.com/watch?v=' + video.youtube_id } };
    if (rec.segs > 1 || open) media.videoMetadata = { startOffset: start + 's', endOffset: end + 's' };
    const withSummary = open ? done === 0 : rec.segs === 1;   // 한 구간으로 끝날 수 있으면 요약까지 한 번에
    const out = await ask({
      contents: [{ role: 'user', parts: [media, { text: transcribePrompt(video.title, done, open ? 0 : rec.segs, start, end, previous.slice(-1500), withSummary) }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 32768, mediaResolution: 'MEDIA_RESOLUTION_LOW', thinkingConfig: { thinkingLevel: 'low' } },
    }, opts.deadline);

    const endHere = async () => { await save({ segs: done }); return { ok: true, status: '진행중', step: '녹취', done, segs: done }; };
    if (out.error && open && done > 0 && out.code === 400) return endHere();   // 영상 끝을 넘겨 요청한 것
    if (out.error) return fail(out);

    let text = out.text;
    let summary = '';
    const cutAt = text.indexOf(SUMMARY_SPLIT);
    if (withSummary && cutAt !== -1) { summary = text.slice(cutAt + SUMMARY_SPLIT.length).trim(); text = text.slice(0, cutAt).trim(); }
    let segs = rec.segs;
    if (open) {
      const ended = new RegExp(END_MARK.source).test(text);
      text = text.replace(END_MARK, '').trim();
      if (!text && done > 0) return endHere();
      if (!ended && done + 1 < MAX_SEGMENTS) { segs = done + 2; summary = ''; }   // 더 이어짐 → 구간 추가(요약은 전체 녹취로 다시)
      else segs = done + 1;
    }
    if (out.cut) text += '\n\n[이 구간은 길어서 끝부분이 잘렸을 수 있어요]';
    const texts = [...rec.texts];
    texts[done] = text.slice(0, CELL_MAX);
    await save({ texts: Array.from(texts, (t) => t || ''), done: done + 1, segs, ...(summary && !out.cut ? { summary: summary.slice(0, CELL_MAX) } : {}) });
    return { ok: true, status: '진행중', step: '녹취', done: done + 1, segs, tries: out.tries };
  }

  // ② 요약
  if (!rec.summary) {
    const out = await ask({
      contents: [{ role: 'user', parts: [{ text: summaryPrompt(video.title, joined(rec)) }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 16384, thinkingConfig: { thinkingLevel: 'low' } },
    }, opts.deadline);
    if (out.error) return fail(out);
    await save({ summary: out.text.slice(0, CELL_MAX) });
    return { ok: true, status: '진행중', step: '요약', done: rec.segs, segs: rec.segs, tries: out.tries };
  }

  // ③ 자료 패키지: 아직 없는 것만 한 번에 요청해 나눠 담는다
  const missing = missingParts(rec);
  if (missing.length) {
    const out = await ask({
      contents: [{ role: 'user', parts: [{ text: packagePrompt(video.title, rec.summary, joined(rec), missing) }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 32768, thinkingConfig: { thinkingLevel: 'low' } },
    }, opts.deadline);
    if (out.error) return fail(out);
    const got = parsePackage(out.text);
    const pkg = { ...rec.pkg };
    let added = 0;
    for (const k of PACKAGE_KEYS) if (got[k] && !pkg[k]) { pkg[k] = got[k].slice(0, CELL_MAX); added++; }
    if (!added) return fail({ error: '자료를 나누지 못했어요. 다시 시도할게요.', busy: true });
    await save({ pkg });
    if (missingParts(rec).length) return { ok: true, status: '진행중', step: '자료', done: rec.segs, segs: rec.segs, tries: out.tries };
  }

  await save({ status: '완료' });
  return { ok: true, status: '완료', step: '자료', done: rec.segs, segs: rec.segs };
}

/** 화면에서 관리자가 누르는 "녹취·자료 만들기" — 한 단계. */
async function videoTranscribe(body) {
  const mid = clip(body.memberId, 40);
  if (!mid || !(await isAdmin(mid))) return { error: '녹취·자료는 관리자만 만들 수 있어요.' };
  const video = (await videoRows()).find((v) => v.video_key === clip(body.id, 40));
  if (!video) return { error: '영상을 찾을 수 없어요.' };
  return step(video, { restart: !!body.restart, summaryOnly: !!body.summaryOnly, duration: body.duration, by: mid });
}

/** 아직 자료가 다 만들어지지 않은 영상(음악 영상은 제외). */
async function pendingVideos() {
  const [videos, recs] = await Promise.all([videoRows(), selectAll(() => db().from('video_transcripts').select('*').order('id'))]);
  const recOf = new Map(recs.map((r) => [r.video_key, r]));
  return videos.filter((v) => {
    if (AUTO_SKIP.test(v.title)) return false;
    const r = recOf.get(v.video_key);
    return !r || r.youtube_id !== v.youtube_id || r.status !== '완료' || missingParts(r).length > 0;
  }).map((v) => {
    const r = recOf.get(v.video_key);
    return { video: v, info: { id: v.video_key, videoId: v.youtube_id, title: v.title, started: !!(r && r.youtube_id === v.youtube_id) } };
  });
}

/**
 * 자동 실행(GitHub Actions 가 30분마다 호출): 밀린 영상을 차례로 만든다.
 * 새 단계는 90초 안에만 시작한다(한 단계가 3분 넘게 걸릴 수 있다).
 */
async function vtAuto(body) {
  const cronKey = process.env.TEACHERSQUARE_CRON_KEY;
  if (!cronKey || String(body.key) !== cronKey) return { error: 'key' };
  if (body.peek) return { ok: true, pending: (await pendingVideos()).map((p) => p.info) };

  const started = Date.now();
  const durations = body.durations || {};
  const steps = [];
  outer: for (const { video } of await pendingVideos()) {
    for (let guard = 0; guard < 25; guard++) {
      if (Date.now() - started > 90000) break outer;
      const res = await step(video, { duration: durations[video.youtube_id], by: 'auto', deadline: started + 130000 });
      const state = res.error ? '✗ ' + res.error : `${res.step} ${res.done}/${res.segs}${res.status === '완료' ? ' 완료' : ''}`;
      steps.push(`${video.video_key} ${state}${res.tries ? ` (${res.tries})` : ''}`);
      if (res.quota) break outer;
      if (res.error || res.status === '완료') break;   // 오류면 이 영상은 다음 실행 때 다시
    }
  }
  return { ok: true, steps, left: (await pendingVideos()).length };
}

export default { getVideoTranscript, videoTranscribe, vtAuto };
