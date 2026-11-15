// 기존 PNG는 그대로 두고 별도 파일을 생성한다. 네트워크/DB 접근 없음.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
const root = new URL('../', import.meta.url);
const output = new URL('assets/optimized/', root);
await fs.mkdir(output, { recursive: true });
const rows = [];
for (const name of ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png']) {
  const input = await fs.readFile(new URL(name, root));
  const encoded = await sharp(input).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
  const bytes = encoded.length < input.length ? encoded : input;
  const originalPixels = await sharp(input).ensureAlpha().raw().toBuffer();
  const resultPixels = await sharp(bytes).ensureAlpha().raw().toBuffer();
  if (!originalPixels.equals(resultPixels)) throw Error(`${name}: 픽셀 불일치`);
  await fs.writeFile(new URL(name, output), bytes);
  rows.push({ name, originalBytes: input.length, optimizedBytes: bytes.length, pixelsEqual: true, originalSha256: createHash('sha256').update(input).digest('hex') });
}
console.log(JSON.stringify(rows, null, 2));
