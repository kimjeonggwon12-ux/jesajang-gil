// 표 안에 data:image 로 들어 있는 사진을 R2 로 옮기고 주소로 바꾼다(2026-10-15).
//   node --env-file=.env tools/migrate-images-r2.mjs          → 무엇을 옮길지 세기만
//   node --env-file=.env tools/migrate-images-r2.mjs --apply  → 실제로 올리고 표를 고침
// .env 에 R2_ACCOUNT_ID · R2_BUCKET · R2_ACCESS_KEY_ID · R2_SECRET_ACCESS_KEY · R2_PUBLIC_BASE 가 있어야 한다.
import { db, run, selectAll } from '../server/lib/db.js';
import { storeImage, r2Configured } from '../server/lib/images.js';

const apply = process.argv.includes('--apply');
if (apply && !r2Configured()) { console.error('R2 환경값이 .env 에 없습니다.'); process.exit(1); }
const isData = (v) => /^data:image\//.test(String(v || ''));
let moved = 0, bytes = 0;

// 연결 명함 사진
const cards = await selectAll(() => db().from('connect_cards').select('id, photo_url').like('photo_url', 'data:image%').order('id'));
for (const c of cards) {
  bytes += c.photo_url.length;
  if (!apply) continue;
  const url = await storeImage(c.photo_url, 'connect');
  await run(db().from('connect_cards').update({ photo_url: url }).eq('id', c.id));
  moved++;
}
console.log(`명함 사진 ${cards.length}장`);

// 광장 글 사진·썸네일
const posts = await selectAll(() => db().from('plaza_posts').select('id, photos, thumb').order('id'));
let postCount = 0;
for (const p of posts) {
  if (!isData(p.thumb) && !p.photos.some(isData)) continue;
  postCount++;
  bytes += p.photos.filter(isData).reduce((n, x) => n + x.length, 0) + (isData(p.thumb) ? p.thumb.length : 0);
  if (!apply) continue;
  const photos = [];
  for (const x of p.photos) photos.push(isData(x) ? await storeImage(x, 'plaza') : x);
  const thumb = isData(p.thumb) ? await storeImage(p.thumb, 'plaza/thumb') : p.thumb;
  await run(db().from('plaza_posts').update({ photos, thumb }).eq('id', p.id));
  moved++;
}
console.log(`광장 글 ${postCount}개`);
console.log(`옮길 사진 합계 약 ${(bytes / 1024 / 1024).toFixed(2)}MB` + (apply ? ` → ${moved}건 옮김` : ' (--apply 로 실제 실행)'));
