// 외부 감시 전용. 업무 DB, 백업 생성, 기존 보고방에는 쓰지 않는다.
import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DAY = 86400000, WEEK = 7 * DAY;
const CODES = new Set(['healthy', 'missing', 'unverified', 'failed', 'interrupted', 'stale', 'file_missing', 'file_invalid', 'running']);
const LABELS = {
  missing: '백업 파일 없음', unverified: '검증된 백업 없음', failed: '백업 실패', interrupted: '백업 실행 중단',
  stale: '최신 백업이 8일을 초과함', file_missing: '완료된 백업 파일 소실', file_invalid: '백업 파일 검증 실패',
  overdue: '일요일 03시 백업의 완료 기한 경과', unreachable: '백업 상태 서버 연결 실패',
  unauthorized: '백업 감시 인증 실패', invalid_response: '백업 상태 응답 확인 실패', api_error: '백업 상태 조회 실패',
};
const time = value => typeof value === 'string' ? Date.parse(value) : NaN;
const result = (code, now, lastSuccessAt = null) => ({ code, level: code === 'healthy' ? 'healthy' : code === 'running' ? 'pending' : 'incident', checkedAt: new Date(now).toISOString(), lastSuccessAt });

// 기존 예약: 토요일 18:00 UTC = 일요일 03:00 KST. 45분 유예 후 누락을 감지한다.
export function latestDueStart(now) {
  const epoch = Date.UTC(1970, 0, 3, 18);
  return epoch + Math.floor((now - 45 * 60000 - epoch) / WEEK) * WEEK;
}

export function evaluateBackup(status, body, now = Date.now()) {
  if (status === 401 || status === 403) return result('unauthorized', now);
  if (status !== 200 && status !== 503) return result('api_error', now);
  const h = body?.health;
  if (body?.checkOnly !== true || !h || !CODES.has(h.state) || !Number.isFinite(time(h.checkedAt)) || Math.abs(now - time(h.checkedAt)) > 5 * 60000)
    return result(body?.code === 'BACKUP_FAILED' && status === 503 ? 'api_error' : 'invalid_response', now);
  const lastTime = time(h.lastSuccessAt);
  const lastAt = Number.isFinite(lastTime) && lastTime <= now + 60000 ? new Date(lastTime).toISOString() : null;
  if (!['healthy', 'running'].includes(h.state)) return result(h.state, now, lastAt);
  if (h.state === 'running') {
    const start = time(h.latestAttempt?.startedAt);
    if (!Number.isFinite(start) || start > now + 60000) return result('invalid_response', now, lastAt);
    if (now - start > 15 * 60000) return result('interrupted', now, lastAt);
    if (lastAt && (!Number.isFinite(time(h.lastSuccess?.startedAt)) || h.lastSuccess?.completedAt !== h.lastSuccessAt)) return result('invalid_response', now, lastAt);
    if (time(h.lastSuccess?.startedAt) < latestDueStart(now) || !lastAt) return result('overdue', now, lastAt);
    return result('running', now, lastAt);
  }
  const last = h.lastSuccess;
  if (status !== 200 || body.ok !== true || !lastAt || last?.status !== 'succeeded' || last.completedAt !== h.lastSuccessAt ||
      !Number.isFinite(time(last.startedAt)) || time(last.startedAt) > lastTime || !/^[a-f0-9]{64}$/.test(last.sha256 || '') ||
      !Number.isSafeInteger(last.bytes) || last.bytes <= 0 || !Number.isSafeInteger(last.tables) || last.tables <= 0 ||
      !Number.isSafeInteger(last.rows) || last.rows < 0)
    return result('invalid_response', now, lastAt);
  if (now - lastTime > 8 * DAY) return result('stale', now, lastAt);
  if (time(last.startedAt) < latestDueStart(now)) return result('overdue', now, lastAt);
  return result('healthy', now, lastAt);
}

async function smallJson(response) {
  if (!response.body) throw Error('empty');
  const reader = response.body.getReader(); let size = 0; const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > 256 * 1024) throw Error('large'); chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); }
}

export async function probeBackup({ key, fetchImpl = fetch, now = Date.now, timeoutMs = 30000 }) {
  if (!key) throw Error('BACKUP_WATCH_KEY_MISSING');
  let response;
  try {
    response = await fetchImpl('https://jesajang-gil.vercel.app/api', {
      method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'content-type': 'application/json' },
      // checkOnly를 옵션이나 사용자 입력으로 바꿀 수 없게 고정한다.
      body: JSON.stringify({ action: 'backupNow', checkOnly: true, key }),
    });
    if (response.status === 401 || response.status === 403) return result('unauthorized', now());
    let body;
    try { body = await smallJson(response); } catch { return result('invalid_response', now()); }
    return evaluateBackup(response.status, body, now());
  } catch { return result('unreachable', now()); }
}

export function backupSummary(health) {
  const title = health.level === 'healthy' ? '백업 정상' : health.level === 'pending' ? '백업 실행 중' : '백업 확인 필요';
  const kst = value => value ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) : '확인 안 됨';
  return `## 교사광장 ${title}\n\n${LABELS[health.code] || (health.level === 'healthy' ? '파일과 완료 기록을 확인했습니다.' : '아직 완료되지 않았습니다.')}\n\n- 확인 시각: ${kst(health.checkedAt)} (한국 시간)\n- 마지막 성공: ${kst(health.lastSuccessAt)} (한국 시간)\n\n이 검사는 읽기 전용입니다. 백업 재실행·DB 복원·업무 기록 변경을 자동으로 하지 않습니다.\n`;
}

async function main() {
  const health = await probeBackup({ key: process.env.BACKUP_WATCH_KEY });
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, backupSummary(health));
  console.log(JSON.stringify(health));
  if (health.level === 'incident') console.error('::error title=교사광장 백업 확인 필요::' + LABELS[health.code]);
  process.exitCode = health.level === 'incident' ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => { console.error(JSON.stringify({ code: 'BACKUP_WATCH_EXECUTION_FAILED', message: '감시 설정·실행을 확인하세요. 비밀값은 출력하지 않습니다.' })); process.exitCode = 1; });
}
