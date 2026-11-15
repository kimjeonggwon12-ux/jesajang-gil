// 사진 저장소: Cloudflare R2 (2026-10-15).
// 예전에는 사진을 data:image(base64) 글자로 표 안에 넣어서, 목록을 읽을 때마다 사진까지 Supabase 에서 내려받았다(Egress 초과의 원인).
// 이제 들어온 data:image 는 R2 에 올리고 표에는 주소(https://…)만 넣는다. 사진은 브라우저가 R2 에서 직접 받는다(R2 는 내보내기 요금 없음).
// R2 설정(환경값 5개)이 없으면 예전처럼 data:image 를 그대로 둔다 — 설정 전에 배포해도 안전하다.
import { AwsClient } from 'aws4fetch';
import { randomUUID } from 'node:crypto';
import { IMAGE_MAX_BYTES, prepareImage } from './image-variants.js';
import { AccessError } from './request-context.js';

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
  const input = String(v || '');
  if (input.length > Math.ceil(IMAGE_MAX_BYTES / 3) * 4 + 100) throw new AccessError('사진 용량을 줄여 주세요.', 400);
  const m = input.match(/^data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=]+)$/i);
  if (!m || !TYPES[m[1].toLowerCase()]) return null;
  if (m[2].length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(m[2])) return null;
  return { type: m[1].toLowerCase(), bytes: Buffer.from(m[2], 'base64') };
}

/** 바이트를 R2 에 올리고 공개 주소를 돌려준다. */
export async function putImage(bytes, type, folder) {
  const name = `${folder}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${TYPES[type] || 'bin'}`;
  return putImageObject(bytes, type, name);
}

async function putImageObject(bytes, type, name) {
  const e = env();
  const r = await r2().fetch(`https://${e.account}.r2.cloudflarestorage.com/${e.bucket}/${name}`, {
    method: 'PUT', body: bytes,
    headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
  if (!r.ok) throw new Error(`R2 업로드 실패 HTTP ${r.status}`);
  return `${e.base}/${name}`;
}

/** 모든 사본 업로드 성공 후에만 버전 표시 주소를 반환한다. 기존 URL/원본 덮어쓰기 없음. */
async function putImageWithVariants(bytes, type, folder, variants) {
  if (!variants.length) return putImage(bytes, type, folder);
  const stem = `${folder}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.iv1-${variants.map(v => v.side).join('-')}`;
  try {
    for (const v of variants) await putImageObject(v.bytes, v.type, `${stem}.w${v.side}.webp`);
  } catch {
    // 사본 장애가 원본 등록을 막지 않도록 옛 주소 형식으로 저장한다.
    // 일부 만들어진 미참조 사본의 정리는 후속 작업이며 여기서 파일을 지우지 않는다.
    return putImage(bytes, type, folder);
  }
  return putImageObject(bytes, type, `${stem}.${TYPES[type]}`);
}

// ── 문서 파일(2026-11-10, 섭외자 대화방 첨부) ── PPT·한글·PDF. 받을 때 원래 이름으로 내려받게 Content-Disposition 을 붙인다.
export const DOC_TYPES = {
  ppt: 'application/vnd.ms-powerpoint', pps: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppsx: 'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
  hwp: 'application/x-hwp', hwpx: 'application/hwp+zip', pdf: 'application/pdf',
};
export const docExt = (name) => { const m = String(name || '').toLowerCase().match(/\.([a-z0-9]{2,5})$/); return m && DOC_TYPES[m[1]] ? m[1] : ''; };
/** 파일 이름 정리 — 경로·제어문자 빼고 100자 안으로(확장자는 지킴). 문서가 아니면 ''. */
export function cleanFileName(name) {
  const s = String(name || '').split(/[\\/]/).pop().replace(/[\u0000-\u001f"<>|*?:]/g, '').trim();
  const ext = docExt(s);
  if (!ext) return '';
  const base = s.slice(0, -(ext.length + 1)).slice(0, 90) || '파일';
  return `${base}.${ext}`;
}
const disposition = (name) => `attachment; filename="${encodeURIComponent(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`;
const docKey = (folder, ext) => `${folder}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${ext}`;
const objUrl = (key) => { const e = env(); return `https://${e.account}.r2.cloudflarestorage.com/${e.bucket}/${key}`; };
const keyOf = (url) => String(url).slice(env().base.length + 1);

/** 작은 문서(서버가 바이트를 받은 경우)를 올린다. */
export async function putDoc(bytes, name, folder) {
  const ext = docExt(name), key = docKey(folder, ext);
  const r = await r2().fetch(objUrl(key), {
    method: 'PUT', body: bytes,
    headers: { 'Content-Type': DOC_TYPES[ext], 'Content-Disposition': disposition(name), 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
  if (!r.ok) throw new Error(`R2 업로드 실패 HTTP ${r.status}`);
  return `${env().base}/${key}`;
}

/** 큰 문서 — 브라우저가 R2 로 바로 PUT 하도록 서명한 주소(30분). 브라우저는 headers 를 그대로 보내야 한다(버킷 CORS 에 PUT 필요). */
export async function presignDoc(name, folder) {
  const ext = docExt(name), key = docKey(folder, ext);
  const u = new URL(objUrl(key));
  u.searchParams.set('X-Amz-Expires', '1800');
  const headers = { 'Content-Type': DOC_TYPES[ext], 'Content-Disposition': disposition(name) };
  const signed = await r2().sign(u.toString(), { method: 'PUT', headers, aws: { signQuery: true } });
  return { put: signed.url, headers, url: `${env().base}/${key}` };
}

/** 우리 R2 주소 → 올라간 크기(없으면 0). */
export async function storedSize(url) {
  if (!isStoredUrl(url)) return 0;
  const r = await r2().fetch(objUrl(keyOf(url)), { method: 'HEAD' });
  return r.ok ? Number(r.headers.get('content-length')) || 0 : 0;
}

/** 우리 R2 주소의 파일 지우기(실패해도 조용히). */
export async function deleteStored(url) {
  if (!isStoredUrl(url)) return;
  try { await r2().fetch(objUrl(keyOf(url)), { method: 'DELETE' }); } catch { /* 그대로 둠 */ }
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
  if (!img) {
    if (s.startsWith('data:image')) throw new AccessError('올바른 사진 파일을 선택해 주세요.', 400);
    return '';
  }
  const prepared = await prepareImage(img.bytes, img.type);
  if (!r2Configured()) return s;
  return putImageWithVariants(img.bytes, img.type, folder, prepared.variants);
}
