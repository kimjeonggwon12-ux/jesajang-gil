// HTTP 본문과 분리한 요청별 신원. 다른 동시 요청의 신원과 섞이지 않는다.
import { AsyncLocalStorage } from 'node:async_hooks';

const context = new AsyncLocalStorage();
export const currentActor = () => context.getStore() || null;
export const withActor = (actor, work) => context.run(actor, work);

export class AccessError extends Error {
  constructor(message, status = 403) {
    super(message);
    this.status = status;
  }
}

export function requireActor() {
  const actor = currentActor();
  if (!actor || actor.guest || actor.cron) throw new AccessError('로그인이 필요해요.', 401);
  return actor;
}
