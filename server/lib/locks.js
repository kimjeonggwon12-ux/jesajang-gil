// 같은 일을 두 곳에서 동시에 하지 않게 하는 짧은 잠금.
import { db, run } from './db.js';

/** 잠금을 잡으면 true. 다른 곳이 잡고 있으면(아직 만료 전) false. */
export async function tryLock(key, seconds) {
  await run(db().from('work_locks').delete().eq('key', key).lt('expires_at', new Date().toISOString()));
  const { error } = await db().from('work_locks').insert({ key, expires_at: new Date(Date.now() + seconds * 1000).toISOString() });
  return !error;
}

export const unlock = (key) => run(db().from('work_locks').delete().eq('key', key));
