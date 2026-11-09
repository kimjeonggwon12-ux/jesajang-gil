// R2 버킷 CORS 보기/바꾸기 — 대화방 파일(PPT·한글·PDF)을 브라우저가 R2 로 바로 올리려면 PUT 허용이 필요하다(2026-11-10).
//   node --env-file=.env tools/r2-cors.mjs        → 지금 설정 보기
//   node --env-file=.env tools/r2-cors.mjs set    → GET(누구나 보기) + PUT(앱 주소에서 올리기) 로 설정
import { AwsClient } from 'aws4fetch';

const { R2_ACCOUNT_ID: account, R2_BUCKET: bucket, R2_ACCESS_KEY_ID: key, R2_SECRET_ACCESS_KEY: secret } = process.env;
const aws = new AwsClient({ accessKeyId: key, secretAccessKey: secret, service: 's3', region: 'auto' });
const url = `https://${account}.r2.cloudflarestorage.com/${bucket}?cors`;

const show = async () => { const r = await aws.fetch(url); console.log('GET cors', r.status, await r.text()); };
await show();
if (process.argv[2] === 'set') {
  const origins = ['https://jesajang-gil.vercel.app'];
  const xml = `<?xml version="1.0" encoding="UTF-8"?><CORSConfiguration>
<CORSRule>${origins.map((o) => `<AllowedOrigin>${o}</AllowedOrigin>`).join('')}<AllowedMethod>GET</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedMethod>PUT</AllowedMethod><AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader><MaxAgeSeconds>3600</MaxAgeSeconds></CORSRule>
</CORSConfiguration>`;
  const { createHash } = await import('node:crypto');
  const r = await aws.fetch(url, { method: 'PUT', body: xml, headers: { 'Content-Type': 'application/xml', 'Content-MD5': createHash('md5').update(xml).digest('base64') } });
  console.log('PUT cors', r.status, await r.text());
  await show();
}
