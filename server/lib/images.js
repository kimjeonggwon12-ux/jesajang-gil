// 사진 저장소: Cloudflare R2 (2026-10-15).
// 예전에는 사진을 data:image(base64) 글자로 표 안에 넣어서, 목록을 읽을 때마다 사진까지 Supabase 에서 내려받았다(Egress 초과의 원인).
// 이제 들어온 data:image 는 R2 에 올리고 표에는 주소(https://…)만 넣는다. 사진은 브라우저가 R2 에서 직접 받는다(R2 는 내보내기 요금 없음).
// R2 설정(환경값 5개)이 없으면 예전처럼 data:image 를 그대로 둔다 — 설정 전에 배포해도 안전하다.
import { AwsClient } from 'aws4fetch';
import { randomUUID } from 'node:crypto';

const env = () => ({
  account: process.env.R2_ACCOUNT_ID, bucket: process.env.R2_BUCKET,
  key: process.env.R2_ACCESS_KEY_ID, secret: process.env.R2_SECRET_ACCESS_KEY,
  base: String(process.env.R2_PUBLIC_BASE || '').replace(/\/+$/, ''),
});
export const r2Configured = () => { const e = env(); return !!(e.account && e.bucket && e.key && e.secret && e.base); };

let client = null;
const r2 = () => (client ||= new AwsClient({ accessKeyId: env().key, secretAccessKey: env().secret, service: 's3', region: 'auto' }));

const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

/** 우리 R2 에 있는 사진 주소인가. */
export const isStoredUrl = (v) => { const b = env().base; return !!b && String(v || '').startsWith(b + '/'); };

/** data:image → { type, bytes }. 아니면 null. */
function decode(v) {
  const m = String(v || '').match(/^data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!m || !TYPES[m[1].toLowerCase()]) return null;
  return { type: m[1].toLowerCase(), bytes: Buffer.from(m[2], 'base64') };
}

/** 바이트를 R2 에 올리고 공개 주소를 돌려준다. */
export async function putImage(bytes, type, folder) {
  const e = env();
  const name = `${folder}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${TYPES[type] || 'bin'}`;
  const r = await r2().fetch(`https://${e.account}.r2.cloudflarestorage.com/${e.bucket}/${name}`, {
    method: 'PUT', body: bytes,
    headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
  if (!r.ok) throw new Error(`R2 업로드 실패 HTTP ${r.status}`);
  return `${e.base}/${name}`;
}

/**
 * 사진 값 하나를 저장용으로 바꾼다.
 * data:image → R2 주소(설정이 없으면 그대로), 우리 R2 주소 → 그대로, 그 밖은 ''.
 */
export async function storeImage(v, folder) {
  const s = String(v || '');
  if (!s) return '';
  if (isStoredUrl(s)) return s;
  const img = decode(s);
  if (!img) return '';
  if (!r2Configured()) return s;
  return putImage(img.bytes, img.type, folder);
}
