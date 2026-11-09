// 대화방 첨부(11/10) R2 점검: 작은 파일 서버 업로드 / 큰 파일 서명 주소 PUT / 크기 확인 / 받기 이름 / 지우기
//   node --env-file=.env tools/smoke-room-files.mjs
import { putDoc, presignDoc, storedSize, deleteStored, cleanFileName } from '../server/lib/images.js';

const name = cleanFileName('C:\\x\\[TEST] 대화방 첨부 시험.pptx');
console.log('name', name, cleanFileName('a.exe') === '' ? '(exe 거절 OK)' : '(exe 거절 실패)');
const small = await putDoc(Buffer.from('hello pptx'), name, 'room-files');
console.log('small', await storedSize(small), 'bytes');
const g = await fetch(small);
console.log('GET', g.status, g.headers.get('content-type'), '|', g.headers.get('content-disposition'));
const p = await presignDoc('[TEST] 큰 한글.hwp', 'room-files');
const put = await fetch(p.put, { method: 'PUT', headers: p.headers, body: Buffer.alloc(4 * 1024 * 1024, 1) });
console.log('presigned PUT', put.status, await storedSize(p.url), 'bytes');
const pre = await fetch(p.put, { method: 'OPTIONS', headers: { Origin: 'https://jesajang-gil.vercel.app', 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type,content-disposition' } });
console.log('CORS preflight', pre.status, pre.headers.get('access-control-allow-methods') || '(PUT 허용 없음)');
await deleteStored(small); await deleteStored(p.url);
console.log('after delete', await storedSize(small), await storedSize(p.url));
