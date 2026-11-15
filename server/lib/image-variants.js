// 새 업로드의 바이트는 원본으로 보존하고, 화면 표시용 사본만 만든다.
import { AccessError } from './request-context.js';

export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const IMAGE_MAX_PIXELS = 20_000_000;
const formats = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

export async function prepareImage(bytes, type) {
  if (!formats[type] || !bytes.length || bytes.length > IMAGE_MAX_BYTES) {
    throw new AccessError('사진 형식이나 용량을 확인해 주세요. 사진은 8MB까지 올릴 수 있어요.', 400);
  }
  const { default: sharp } = await import('sharp');
  const options = { limitInputPixels: IMAGE_MAX_PIXELS, failOn: 'warning' };
  try {
    const metadata = await sharp(bytes, options).metadata();
    if (metadata.format !== formats[type] || !metadata.width || !metadata.height) throw Error('format');
    // 작은 출력이라도 디코딩을 끝까지 시도한다. 잘린 파일을 정상 업로드로 처리하지 않는다.
    await sharp(bytes, options).rotate().resize(1, 1, { fit: 'inside' }).timeout({ seconds: 5 }).toBuffer();
    const variants = [];
    // 움직이는 사진을 정지 사진으로 바꾸지 않는다. 이미 작은 사진도 다시 압축하지 않는다.
    if (metadata.format !== 'gif' && (metadata.pages || 1) === 1 && bytes.length >= 64 * 1024) {
      // 현재 화면이 사용하는 두 크기만 만든다. 확대는 보존된 원본을 연다.
      for (const side of [320, 960]) {
        // 같은 크기의 사본을 여러 개 만들지 않는다.
        if (side > 320 && Math.max(metadata.width, metadata.height) <= 320) continue;
        const { data, info } = await sharp(bytes, options).rotate()
          .resize(side, side, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: side === 320 ? 80 : 88, alphaQuality: 100, effort: 4 })
          .timeout({ seconds: 5 }).toBuffer({ resolveWithObject: true });
        // 압축 사본이 원본과 비슷하거나 더 크면 원본을 사용한다.
        if (data.length < bytes.length * 0.9) variants.push({ side, bytes: data, type: 'image/webp', width: info.width, height: info.height });
      }
    }
    return { variants, width: metadata.width, height: metadata.height, format: metadata.format };
  } catch (error) {
    if (error instanceof AccessError) throw error;
    throw new AccessError('사진을 처리하지 못했어요. 손상되지 않은 JPG·PNG·WebP·GIF 사진을 선택해 주세요. 최대 2천만 화소까지 지원해요.', 400);
  }
}
