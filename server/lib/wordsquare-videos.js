// 11/22(사용자): 말씀광장 유튜브(@wordsquare) 새 영상을 매주 월요일 교사광장 영상(videos 표)에 자동으로 넣는다.
//   "성경·신앙 관련 시리즈만" — 아래 SERIES 제목이 들어간 영상만(음식·홍보 쇼츠 등은 넣지 않음). 파트는 시리즈별로 고정('소양'은 안 씀).
//   새 영상 목록 = 채널 공개 피드(유튜브 키 필요 없음, 최근 15개). 이미 있는 영상(지운 것 포함)은 다시 넣지 않는다.
//   예약: attAutoSummary(5분마다) → wordsquareTick — 월요일 09:00~20:00 KST에 하루 한 번(cohort_summary_log '#wordsquare').
import { db, run, selectAll } from './db.js';
import { kstDate, kstDateTime } from './util.js';
import { newId } from './input.js';

export const WORDSQUARE_CHANNEL = 'UCit_z7USCN4WeSSNbyLCBmA';
const FEED = 'https://www.youtube.com/feeds/videos.xml?channel_id=' + WORDSQUARE_CHANNEL;
const BY = '말씀광장(자동)';

// 시리즈 이름(띄어쓰기 무시) → 파트. 10/6에 손으로 올린 같은 시리즈 영상들의 파트를 따름. 힐링바이블은 11/22 새 시리즈(복음방).
export const SERIES = [
  ['나만몰랐던성경', ['무신앙']],
  ['신의선물', ['무신앙']],
  ['바이블프리즘', ['무신앙']],
  ['솜사탕', ['무신앙']],
  ['성경동화', ['복음방']],
  ['힐링바이블', ['복음방']],
  ['요리조리성경맛보기', ['밭갈기']],
];
export function seriesOf(title) {
  const t = String(title || '').replace(/\s+/g, '');
  const hit = SERIES.find(([k]) => t.includes(k));
  return hit ? { series: hit[0], parts: hit[1] } : null;
}

const unxml = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
/** 채널 피드 → [{ videoId, title, date }] (최신순) */
export async function feedVideos() {
  const r = await fetch(FEED, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error('말씀광장 피드 ' + r.status);
  const x = await r.text();
  return [...x.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
    videoId: (e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1],
    title: unxml((e.match(/<title>([^<]*)<\/title>/) || [])[1]),
    date: kstDate(new Date((e.match(/<published>([^<]+)<\/published>/) || [])[1])),
  })).filter((v) => v.videoId && v.title);
}

/** list = [{ videoId, title, date }] 중 시리즈이고 아직 없는 것만 넣는다. dry 면 넣지 않고 무엇을 넣을지만. */
export async function addWordsquareVideos(list, { dry = false } = {}) {
  const have = new Set((await selectAll(() => db().from('videos').select('youtube_id').order('id'))).map((r) => r.youtube_id));
  const added = [], skipped = [];
  for (const v of [...list].reverse()) {   // 오래된 것부터 넣어 최신이 위로
    const s = seriesOf(v.title);
    if (!s) { skipped.push({ ...v, why: '시리즈 아님' }); continue; }
    if (have.has(v.videoId)) { skipped.push({ ...v, why: '이미 있음' }); continue; }
    const row = { video_key: newId('VD'), youtube_id: v.videoId, title: v.title.slice(0, 200), parts: s.parts, description: '',
      upload_date: v.date || kstDate(), created_by_id: '', created_by: BY, status: '', updated_at: kstDateTime(), phone: '' };
    if (!dry) await run(db().from('videos').insert(row));
    have.add(v.videoId);
    added.push({ videoId: v.videoId, title: v.title, date: row.upload_date, parts: s.parts });
  }
  return { added, skipped };
}

export async function wordsquareTick() {
  const now = kstDateTime(), date = kstDate();
  const [y, m, d] = date.split('-').map(Number);
  if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() !== 1) return null;   // 월요일만
  const hm = now.slice(11, 16);
  if (hm < '09:00' || hm >= '20:00') return null;
  const { error } = await db().from('cohort_summary_log').insert({ cohort_id: '#wordsquare', kind: '말씀광장영상', ref_id: WORDSQUARE_CHANNEL, date, sent_at: now });
  if (error) return null;   // 오늘 이미 함
  try { const r = await addWordsquareVideos(await feedVideos()); return { date, added: r.added.map((x) => x.title) }; }
  catch (e) {
    await db().from('cohort_summary_log').delete().eq('cohort_id', '#wordsquare').eq('date', date);   // 다음 5분에 다시
    return { date, error: e.message };
  }
}

// 관리용(운영 키): { action:'wordsquareSync', key, dry?:true } — 지금 피드를 읽어 넣음(dry 면 미리보기만)
async function wordsquareSync(body) {
  if (!process.env.TEACHERSQUARE_CRON_KEY || body.key !== process.env.TEACHERSQUARE_CRON_KEY) return { error: '권한이 없습니다.' };
  const r = await addWordsquareVideos(await feedVideos(), { dry: !!body.dry });
  return { ok: true, dry: !!body.dry, ...r };
}

export default { wordsquareSync };
