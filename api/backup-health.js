// 외부 감시 전용 GET. 기존 업무/예약 API와 인증을 공유하지 않는다.
import { createHash, timingSafeEqual } from 'node:crypto';
import { db } from '../server/lib/db.js';
import { inspectBackups } from '../server/lib/backup-storage.js';

const digest = value => createHash('sha256').update(value).digest();
const states = new Set(['healthy', 'missing', 'unverified', 'failed', 'interrupted', 'stale', 'file_missing', 'file_invalid', 'running']);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Authorization');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }
  // 서버에는 전용 키의 SHA-256만 저장한다. 미설정/잘못된 설정이면 조회도 하지 않는다.
  const configured = process.env.TEACHERSQUARE_BACKUP_WATCH_KEY_SHA256;
  if (!/^[a-f0-9]{64}$/i.test(configured || '')) return res.status(503).json({ code: 'BACKUP_WATCH_UNAVAILABLE' });
  const expected = Buffer.from(configured, 'hex');
  // 기존 실행 키를 감시 키로 잘못 복사한 설정은 활성화하지 않는다.
  const cron = process.env.TEACHERSQUARE_CRON_KEY;
  if (cron && timingSafeEqual(digest(cron), expected)) return res.status(503).json({ code: 'BACKUP_WATCH_UNAVAILABLE' });
  const header = req.headers?.authorization;
  const match = typeof header === 'string' && /^Bearer (tsbw_[a-f0-9]{64})$/i.exec(header);
  if (!match || !timingSafeEqual(digest(match[1]), expected)) return res.status(401).json({ code: 'UNAUTHORIZED' });

  try {
    // 조회 함수만 호출한다. 파일 생성/정리/서명 URL/업무 DB 쿼리 경로가 없다.
    const { health: h } = await inspectBackups(db());
    if (!h || !states.has(h.state)) throw new Error('Invalid backup state');
    // 실패 기록에도 내부 원인이 있을 수 있으므로 통째로 반환하지 않는다.
    const health = {
      state: h.state, checkedAt: h.checkedAt, lastSuccessAt: h.lastSuccessAt,
      latestAttempt: h.latestAttempt ? { startedAt: h.latestAttempt.startedAt } : null,
      lastSuccess: h.lastSuccess ? {
        status: h.lastSuccess.status, startedAt: h.lastSuccess.startedAt, completedAt: h.lastSuccess.completedAt,
      } : null,
    };
    return res.status(h.state === 'healthy' ? 200 : 503).json({ ok: h.state === 'healthy', checkOnly: true, verification: 'sha256', health });
  } catch {
    return res.status(503).json({ code: 'BACKUP_WATCH_UNAVAILABLE' });
  }
}
