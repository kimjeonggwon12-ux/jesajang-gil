// 응답을 먼저 보내고 뒤에서 마저 할 일(알림 등).
// Vercel 에서는 waitUntil 로 맡겨야 응답 뒤에도 끝까지 실행된다. 그 밖(내 컴퓨터·점검 도구)에서는 그냥 실행해 둔다.
let waitUntil = null;
try { ({ waitUntil } = await import('@vercel/functions')); } catch { /* 설치돼 있지 않으면 그냥 실행 */ }

const pending = new Set();

/** work(약속)를 뒤에서 마저 돌린다. 실패해도 응답에는 영향이 없다. */
export function runLater(work) {
  const safe = Promise.resolve(work).catch((e) => console.log('뒤에서 하던 일 오류: ' + e));
  pending.add(safe);
  safe.finally(() => pending.delete(safe));
  if (process.env.VERCEL && waitUntil) waitUntil(safe);
}

/** 뒤에서 돌던 일이 다 끝날 때까지 기다린다(점검 도구용). */
export const settled = () => Promise.all([...pending]);
