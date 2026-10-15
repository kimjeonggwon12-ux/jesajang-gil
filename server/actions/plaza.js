// 교사 광장: 글 · 댓글 · 좋아요 · 이달의 교사
import { db, run, selectAll } from '../lib/db.js';
import { normId, kstDate, kstDateTime, fmtTs, sameId } from '../lib/util.js';
import { clip, pickList, newId } from '../lib/input.js';
import { afterAction } from '../lib/events.js';
import { teachersByNid, isAdmin } from './roster.js';
import { storeImage, isStoredUrl } from '../lib/images.js';
import { TARGET_STAGES } from './targets.js';

const CATEGORIES = ['사례', '질문', '나눔', '불편신고', '전도부'];
// 예전에 '성공사례'·'실패사례'로 나뉘어 있던 글도 '사례'로 본다.
const CATEGORY_ALIASES = { 사례: ['사례', '성공사례', '실패사례'] };
// '마당' = 교사 마당: 사례(교사 이야기)와 전도부(전도부 게시판)가 아닌 모든 글
const YARD = '마당';
const inCategory = (wanted, actual) => !wanted || (wanted === YARD
  ? !CATEGORY_ALIASES.사례.includes(actual) && actual !== '전도부'
  : (CATEGORY_ALIASES[wanted] || [wanted]).includes(actual));
const CONTEST_TAG = '[이름 공모]';
const PHOTO_MAX = 44000;
const THUMB_MAX = 12000;
const ORG_MAIN_DEPTS = ['교역자', '자문회', '장년회', '부녀회', '청년회'];

/** 사진은 크기 제한 안의 data:image 또는 이미 R2 에 올린 주소만 받는다. */
const image = (v, max) => { const s = String(v || ''); return isStoredUrl(s) || (/^data:image\//.test(s) && s.length <= max) ? s : ''; };
const photosFrom = (list) => (Array.isArray(list) ? list : []).map((x) => image(x, PHOTO_MAX)).filter(Boolean).slice(0, 4);
/** 받은 사진·썸네일을 R2 에 올리고 주소로 바꾼다(R2 설정이 없으면 그대로). */
async function storePhotos(photos, thumb) {
  const stored = (await Promise.all(photos.map((p) => storeImage(p, 'plaza')))).filter(Boolean);
  return { photos: stored, thumb: stored.length && thumb ? await storeImage(thumb, 'plaza/thumb') : '' };
}

const visiblePosts = () => selectAll(() => db().from('plaza_posts').select('*').neq('status', '삭제').order('id'));

/** 글마다 달린 댓글 수(삭제된 것 제외). */
async function commentCounts() {
  const rows = await selectAll(() => db().from('plaza_comments').select('post_id').neq('status', '삭제').order('id'));
  const counts = new Map();
  for (const c of rows) counts.set(c.post_id, (counts.get(c.post_id) || 0) + 1);
  return counts;
}

/** DB 글 → 화면용. full 이면 본문·사진까지. */
function toPost(p, roster, viewerId, counts, full) {
  const author = roster.get(normId(p.member_id)) || {};
  const post = {
    postId: p.post_id, memberId: p.member_id, name: p.name || author.name || '', category: p.category,
    title: p.title, summary: p.body.replace(/\s+/g, ' ').slice(0, 120),
    tags: p.tags, thumb: p.thumb, photoCount: p.photos.length,
    likeCount: p.likes.length, liked: !!viewerId && p.likes.includes(normId(viewerId)),
    commentCount: counts.get(p.post_id) || 0,
    createdAt: fmtTs(p.created_at), updatedAt: fmtTs(p.updated_at),
    region: author.region || '', dept: author.dept || '', tier: author.tier || '',
    isMine: !!viewerId && sameId(p.member_id, viewerId),
  };
  if (full) { post.body = p.body; post.photos = p.photos; }
  return post;
}

const newestFirst = (a, b) => (a.createdAt < b.createdAt ? 1 : -1);

/** 글을 많이 올린 교사(전도부 알림 글은 빼고 셈): 글 수 → 최근에 쓴 순. posts 는 최신순. */
function topWriters(posts, max) {
  const byWriter = new Map();
  for (const o of posts) {
    if (o.category === '전도부') continue;
    const who = normId(o.memberId);
    if (!byWriter.has(who)) byWriter.set(who, { memberId: o.memberId, name: o.name, region: o.region, dept: o.dept, count: 0, lastAt: o.createdAt });
    byWriter.get(who).count++;
  }
  return [...byWriter.values()].sort((a, b) => b.count - a.count || (a.lastAt < b.lastAt ? 1 : -1)).slice(0, max);
}

/** 글 목록(최신순, 주제·검색어로 거름). 첫 쪽에는 최근 2주 인기 글 5개(hot)도 함께. */
async function listPlazaPosts(body) {
  const me = clip(body.memberId, 40);
  const category = clip(body.category, 20);
  const keyword = clip(body.keyword, 40).toLowerCase();
  const offset = Math.max(0, Number(body.offset || 0));
  const limit = Math.max(1, Math.min(50, Number(body.limit || 20)));

  const [posts, counts] = await Promise.all([visiblePosts(), commentCounts()]);
  const roster = await teachersByNid(posts.map((p) => p.member_id));
  const all = posts.map((p) => toPost(p, roster, me, counts, false)).sort(newestFirst);
  const rows = all.filter((o) => inCategory(category, o.category)
    && (!keyword || `${o.title} ${o.summary} ${o.tags.join(' ')} ${o.name}`.toLowerCase().includes(keyword)));

  const result = { rows: rows.slice(offset, offset + limit), total: rows.length, categories: CATEGORIES };
  if (!offset) {
    const since = kstDateTime(new Date(Date.now() - 14 * 864e5));
    result.hot = all.filter((o) => o.createdAt >= since && inCategory(category, o.category))
      .map((o) => ({ o, score: o.likeCount * 2 + o.commentCount }))
      .sort((a, b) => b.score - a.score || newestFirst(a.o, b.o))
      .slice(0, 5).map((x) => x.o);
    if (category === YARD) result.writers = topWriters(all, 5);
  }
  return result;
}

async function getPlazaPost(body) {
  const me = clip(body.memberId, 40);
  const postId = clip(body.postId, 40);
  const [row] = await run(db().from('plaza_posts').select('*').eq('post_id', postId).neq('status', '삭제').limit(1));
  if (!row) return { error: '삭제되었거나 없는 글이에요.' };

  const [counts, commentRows, cards] = await Promise.all([
    commentCounts(),
    run(db().from('plaza_comments').select('*').eq('post_id', postId).neq('status', '삭제').order('id')),
    run(db().from('connect_cards').select('member_id, photo_url').eq('nid', normId(row.member_id)).order('id')),
  ]);
  const roster = await teachersByNid([row.member_id, ...commentRows.map((c) => c.member_id)]);
  const post = toPost(row, roster, me, counts, true);
  const card = cards.find((c) => sameId(c.member_id, post.memberId));
  if (card) post.authorPhoto = card.photo_url;

  const comments = commentRows.map((c) => {
    const author = roster.get(normId(c.member_id)) || {};
    return {
      commentId: c.comment_id, memberId: c.member_id, name: c.name || author.name || '', text: c.body,
      createdAt: fmtTs(c.created_at), region: author.region || '', isMine: !!me && sameId(c.member_id, me),
    };
  }).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  return { post, comments };
}

const rosterName = async (memberId) => (await teachersByNid([memberId])).get(normId(memberId))?.name || '';

/** 글 쓰기·고치기(data.postId 가 있으면 고치기 — 내가 쓴 글만). */
async function savePlazaPost(body) {
  const mid = clip(body.memberId, 40);
  const d = body.data || {};
  if (!mid) return { error: 'memberId 가 필요합니다.' };
  const asked = d.category === '성공사례' || d.category === '실패사례' ? '사례' : d.category;
  const category = CATEGORIES.includes(asked) ? asked : '';
  if (!category) return { error: '주제를 골라주세요.' };
  if (category === '전도부' && !(await isAdmin(mid))) return { error: '전도부 자유 게시판은 전도부(관리자)만 글을 올릴 수 있어요.' };
  const title = clip(d.title, 80);
  if (!title) return { error: '제목을 입력해주세요.' };
  const text = clip(d.body, 5000);
  if (!text) return { error: '내용을 입력해주세요.' };
  const tags = pickList((Array.isArray(d.tags) ? d.tags : []).map((t) => String(t || '').replace(/^#/, '').slice(0, 20)), null, 10);
  const content = { category, title, body: text, tags, ...(await storePhotos(photosFrom(d.photos), image(d.thumb, THUMB_MAX))) };
  const now = kstDateTime();

  const postId = clip(d.postId, 40);
  if (postId) {
    const [row] = await run(db().from('plaza_posts').select('id, member_id').eq('post_id', postId).limit(1));
    if (!row) return { error: '글을 찾지 못했어요.' };
    if (!sameId(row.member_id, mid)) return { error: '내가 쓴 글만 고칠 수 있어요.' };
    await run(db().from('plaza_posts').update({ ...content, updated_at: now }).eq('id', row.id));
    return afterAction('savePlazaPost', body, { ok: true, postId });
  }

  const fresh = newId('PZ');
  await run(db().from('plaza_posts').insert({
    post_id: fresh, member_id: mid, name: clip(body.name, 30) || await rosterName(mid),
    ...content, created_at: now, updated_at: now, status: '게시',
  }));
  return afterAction('savePlazaPost', body, { ok: true, postId: fresh });
}

/** 관리자가 남의 글 사진을 바꾼다(부적절한 사진 정리용). */
async function adminSetPlazaPhotos(body) {
  const mid = clip(body.memberId, 40);
  const postId = clip(body.postId, 40);
  if (!mid || !(await isAdmin(mid))) return { error: '관리자만 사진을 고칠 수 있어요.' };
  const updated = await run(db().from('plaza_posts')
    .update(await storePhotos(photosFrom(body.photos), image(body.thumb, THUMB_MAX))).eq('post_id', postId).select('id'));
  return updated.length ? { ok: true, postId } : { error: '글을 찾지 못했어요.' };
}

async function deletePlazaPost(body) {
  const mid = clip(body.memberId, 40);
  const [row] = await run(db().from('plaza_posts').select('id, member_id').eq('post_id', clip(body.postId, 40)).limit(1));
  if (!row) return { error: '글을 찾지 못했어요.' };
  if (!sameId(row.member_id, mid)) return { error: '내가 쓴 글만 지울 수 있어요.' };
  await run(db().from('plaza_posts').update({ status: '삭제' }).eq('id', row.id));
  return { ok: true };
}

/** 좋아요를 누르거나 푼다. 두 사람이 동시에 눌러도 서로 덮어쓰지 않도록 DB 함수 한 번으로 처리한다. */
async function togglePlazaLike(body) {
  const mid = clip(body.memberId, 40);
  if (!mid) return { error: 'memberId 가 필요합니다.' };
  const result = await run(db().rpc('toggle_plaza_like', { p_post_id: clip(body.postId, 40), p_nid: normId(mid) }));
  const row = Array.isArray(result) ? result[0] : result;
  if (!row) return { error: '글을 찾지 못했어요.' };
  return { ok: true, liked: row.liked, likeCount: row.like_count };
}

async function addPlazaComment(body) {
  const mid = clip(body.memberId, 40);
  const text = clip(body.text, 1000);
  if (!mid) return { error: 'memberId 가 필요합니다.' };
  if (!text) return { error: '댓글을 입력해주세요.' };
  await run(db().from('plaza_comments').insert({
    comment_id: newId('PC'), post_id: clip(body.postId, 40), member_id: mid,
    name: clip(body.name, 30) || await rosterName(mid), body: text, created_at: kstDateTime(), status: '게시',
  }));
  return { ok: true };
}

/** 내 댓글의 글을 고친다. */
async function editPlazaComment(body) {
  const mid = clip(body.memberId, 40);
  const text = clip(body.text, 1000);
  if (!text) return { error: '댓글을 입력해주세요.' };
  const [row] = await run(db().from('plaza_comments').select('id, member_id, status').eq('comment_id', clip(body.commentId, 40)).limit(1));
  if (!row || row.status === '삭제') return { error: '댓글을 찾지 못했어요.' };
  if (!sameId(row.member_id, mid)) return { error: '내 댓글만 고칠 수 있어요.' };
  await run(db().from('plaza_comments').update({ body: text }).eq('id', row.id));
  return { ok: true };
}

async function deletePlazaComment(body) {
  const mid = clip(body.memberId, 40);
  const [row] = await run(db().from('plaza_comments').select('id, member_id').eq('comment_id', clip(body.commentId, 40)).limit(1));
  if (!row) return { error: '댓글을 찾지 못했어요.' };
  if (!sameId(row.member_id, mid)) return { error: '내 댓글만 지울 수 있어요.' };
  await run(db().from('plaza_comments').update({ status: '삭제' }).eq('id', row.id));
  return { ok: true };
}

// ── 이달의 교사 · 커피 쿠폰 ──

// 활동 항목별 점수(단계가 깊을수록 높다). 목록에 없는 항목은 1점.
const ITEM_SCORE = { 섭외: 1, 친분: 1, 만남1: 2, 만남2: 2, 상담1: 3, 상담2: 3, 복음방: 4, 센터소개: 5, 센터수강: 5 };

/** 그 달 교사별 활동 점수. */
function scoreActivities(activities) {
  const stats = new Map();
  for (const a of activities) {
    if (!stats.has(a.nid)) {
      stats.set(a.nid, { memberId: a.member_id, name: a.name, score: 0, count: 0, positive: 0, items: {}, targets: new Set(), best: -1 });
    }
    const s = stats.get(a.nid);
    const items = a.activities.filter(Boolean).length ? a.activities.filter(Boolean) : ['활동'];
    for (const item of items) { s.items[item] = (s.items[item] || 0) + 1; s.score += ITEM_SCORE[item] || 1; }
    s.count++;
    if (a.reaction === '긍정적') { s.positive++; s.score++; }
    if (a.target_name) s.targets.add(a.target_name.trim());
    s.best = Math.max(s.best, TARGET_STAGES.indexOf(a.target_stage), ...items.map((item) => TARGET_STAGES.indexOf(item)));
  }
  return stats;
}

/** 부서마다 한 명: 점수 → 활동 건수 → 이름 순으로 앞선 사람. */
const outranks = (s, cur) => !cur || s.score > cur.score
  || (s.score === cur.score && (s.count > cur.count || (s.count === cur.count && s.name < cur.name)));

async function getPlazaMonthly(body) {
  const month = /^\d{4}-\d{2}$/.test(String(body.month || '')) ? String(body.month) : kstDate().slice(0, 7);
  const [year, mon] = month.split('-').map(Number);
  const nextMonth = mon === 12 ? `${year + 1}-01` : `${year}-${String(mon + 1).padStart(2, '0')}`;

  const [activities, posts, counts] = await Promise.all([
    selectAll(() => db().from('activities').select('member_id, nid, name, activities, reaction, target_name, target_stage')
      .neq('member_id', '').gte('submitted_at', `${month}-01`).lt('submitted_at', `${nextMonth}-01`).order('id')),
    visiblePosts(),
    commentCounts(),
  ]);
  const stats = scoreActivities(activities);
  const roster = await teachersByNid([...[...stats.values()].map((s) => s.memberId), ...posts.map((p) => p.member_id)]);

  const winners = {};
  for (const [nid, s] of stats) {
    const dept = (roster.get(nid)?.dept || '').trim();
    if (ORG_MAIN_DEPTS.includes(dept) && outranks(s, winners[dept])) winners[dept] = s;
  }
  const winnerNids = Object.values(winners).map((s) => normId(s.memberId));
  const cards = winnerNids.length
    ? await run(db().from('connect_cards').select('nid, photo_url').in('nid', winnerNids).neq('photo_url', '').order('id'))
    : [];
  const photoOf = new Map(cards.map((c) => [c.nid, c.photo_url]));

  const teachers = ORG_MAIN_DEPTS.filter((d) => winners[d]).map((dept) => {
    const s = winners[dept];
    const p = roster.get(normId(s.memberId)) || {};
    const top = Object.keys(s.items).sort((a, b) => s.items[b] - s.items[a]);
    const itemText = top.slice(0, 3).map((k) => `${k} ${s.items[k]}`).join('·') + (top.length > 3 ? ' 외' : '');
    const bestStage = s.best >= 0 ? TARGET_STAGES[s.best] : '';
    const result = [
      s.positive ? `긍정 반응 ${s.positive}건` : '',
      s.targets.size ? `대상자 ${s.targets.size}명` : '',
      bestStage ? `${bestStage} 단계까지` : '',
    ].filter(Boolean);
    return {
      dept, name: s.name || p.name || '', region: p.region || '', tier: p.tier || '',
      photo: photoOf.get(normId(s.memberId)) || '', score: s.score, count: s.count, positive: s.positive, targets: s.targets.size,
      bestStage, items: top.map((item) => ({ item, count: s.items[item] })),
      summary: `활동 ${s.count}건(${itemText})` + (result.length ? ' · ' + result.join(' · ') : ''),
    };
  });

  // 그 달에 좋아요를 받은 글(이름 공모 글은 제외): 좋아요 → 댓글 → 먼저 쓴 순
  const liked = posts.map((p) => toPost(p, roster, body.memberId, counts, false))
    .filter((o) => o.createdAt.slice(0, 7) === month && !o.title.startsWith(CONTEST_TAG) && o.likeCount)
    .sort((a, b) => b.likeCount - a.likeCount || b.commentCount - a.commentCount || (a.createdAt < b.createdAt ? -1 : 1));
  // 쿠폰은 한 사람에 하나씩, 3명까지
  const coupon = [];
  const seen = new Set();
  for (const post of liked) {
    if (coupon.length >= 3) break;
    const who = normId(post.memberId);
    if (seen.has(who)) continue;
    seen.add(who);
    coupon.push(post);
  }
  const couponIds = coupon.map((p) => p.postId);
  const popular = liked.slice(0, 10).map((p) => Object.assign(p, { coupon: couponIds.includes(p.postId) }));
  return { month, teachers, coupon, popular };
}

export default {
  listPlazaPosts, getPlazaPost, savePlazaPost, adminSetPlazaPhotos, deletePlazaPost,
  togglePlazaLike, addPlazaComment, editPlazaComment, deletePlazaComment, getPlazaMonthly,
};
