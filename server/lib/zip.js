// 작은 zip 만들기(xlsx 는 XML 파일들을 묶은 zip 이다).
import { crc32, deflateRawSync } from 'node:zlib';

/** { '경로': '내용' } → zip 바이트(Buffer). */
export function zip(files) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, 'utf8');
    const raw = Buffer.from(content, 'utf8');
    const data = deflateRawSync(raw);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);   // 파일 머리
    head.writeUInt16LE(20, 4);           // 필요한 버전
    head.writeUInt16LE(0x0800, 6);       // 이름은 UTF-8
    head.writeUInt16LE(8, 8);            // 압축 방식: deflate
    head.writeUInt32LE(0x00210000, 10);  // 시각·날짜(1980-01-01 00:00)
    head.writeUInt32LE(crc32(raw), 14);
    head.writeUInt32LE(data.length, 18);
    head.writeUInt32LE(raw.length, 22);
    head.writeUInt16LE(nameBytes.length, 26);
    local.push(head, nameBytes, data);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);  // 목차 항목
    entry.writeUInt16LE(20, 4);
    head.copy(entry, 6, 4, 30);          // 버전~이름 길이는 파일 머리와 같다
    entry.writeUInt32LE(offset, 42);     // 파일 머리가 있는 자리
    central.push(entry, nameBytes);
    offset += head.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);      // 목차 끝
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
