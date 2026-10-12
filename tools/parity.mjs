// 옛 서버(Apps Script)와 새 서버(Vercel)에 같은 요청을 보내 응답이 같은지 비교한다.
// 읽기 전용 action 만 넣을 것 — 쓰기 action 을 넣으면 양쪽에 실제로 기록된다.
//   node tools/parity.mjs <새 서버 주소> [cases.json]
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

const LEGACY = 'https://script.google.com/macros/s/AKfycbyXJtQEWGdF6PKv2qstTp3ZgjhMSWfmUShh4uw8Km9LDJjj78WLmGO89HHE0Eb3M5lW/exec';
const NEXT = process.argv[2];
if (!NEXT) { console.error('새 서버 주소가 필요합니다.'); process.exit(1); }

const cases = process.argv[3]
  ? JSON.parse(readFileSync(process.argv[3], 'utf8'))
  : [
    { action: 'getRoster' },
    { action: 'checkAdmin', memberId: '00230901-00011' },
    { action: 'checkAdmin', memberId: '0020113000010' },
    { action: 'checkAdmin', memberId: '없는번호' },
  ];

async function call(url, payload) {
  const t = Date.now();
  const r = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(process.env.MAINT_KEY ? { ...payload, maint: process.env.MAINT_KEY } : payload), redirect: 'follow',
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { __raw: text.slice(0, 200) }; }
  return { json, ms: Date.now() - t };
}

/** 처음 다른 곳의 경로를 찾아 돌려준다(같으면 null). */
function firstDiff(a, b, path = '') {
  if (isDeepStrictEqual(a, b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const d = firstDiff(a[k], b[k], path + '/' + k);
      if (d) return d;
    }
  }
  return `${path || '/'}: 옛=${JSON.stringify(a)?.slice(0, 120)} 새=${JSON.stringify(b)?.slice(0, 120)}`;
}

let failed = 0;
for (const c of cases) {
  const [oldR, newR] = await Promise.all([call(LEGACY, c), call(NEXT, c)]);
  const diff = firstDiff(oldR.json, newR.json);
  if (diff) failed++;
  console.log(`${diff ? '✗' : '✓'} ${JSON.stringify(c)}  옛 ${oldR.ms}ms / 새 ${newR.ms}ms${diff ? '\n    ' + diff : ''}`);
}
console.log(failed ? `\n${failed}건 다름` : '\n모두 같음');
process.exit(failed ? 1 : 0);
