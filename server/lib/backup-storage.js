// DB 구조 변경 없이 비공개 Storage에 실행 기록과 파일 확인 결과를 보관한다.
// 시작/종료 기록은 실행별 불변 파일이다. 동시에 실행해도 서로 덮어쓰지 않는다.
import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

export const BACKUP_BUCKET = 'backups';
const MONITOR = '_monitor';
const KEEP = 8;
const MAX_AGE = 8 * 24 * 60 * 60 * 1000; // 주 1회 + 1일 여유
const RUN_TIMEOUT = 15 * 60 * 1000;
const FILE = /^backup-\d{8}-\d{6}(?:-(?:\d{3}-)?[a-f0-9-]{36})?\.json\.gz$/;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const missing = error => String(error?.statusCode || error?.status) === '404' || error?.code === 'NoSuchKey' || error?.code === 'NoSuchBucket';
const store = client => client.storage.from(BACKUP_BUCKET);
const startedPath = name => `${MONITOR}/${name}.started.json`;
const resultPath = name => `${MONITOR}/${name}.result.json`;

async function bucketExists(client) {
  const { data, error } = await client.storage.getBucket(BACKUP_BUCKET);
  if (error) { if (missing(error)) return false; throw new Error('백업 보관함 조회 실패'); }
  if (!data) throw new Error('백업 보관함 응답을 확인할 수 없어요.');
  if (data.public !== false) throw new Error('백업 보관함이 비공개인지 확인해 주세요.');
  return true;
}
async function ensureBucket(client) {
  if (await bucketExists(client)) return;
  const { error } = await client.storage.createBucket(BACKUP_BUCKET, { public: false });
  // 동시 생성은 실제 비공개 보관함을 다시 확인한 경우에만 허용한다.
  if (error && !(await bucketExists(client))) throw new Error('백업 보관함 생성 실패');
  if (!(await bucketExists(client))) throw new Error('백업 보관함 생성 확인 실패');
}
async function readBytes(client, path, optional = false) {
  const { data, error } = await store(client).download(path, { cacheNonce: randomUUID() }, { cache: 'no-store' });
  if (error) { if (optional && missing(error)) return null; throw new Error('백업 파일 읽기 실패'); }
  if (!data) throw new Error('백업 파일 응답 없음');
  return Buffer.from(await data.arrayBuffer());
}
async function readRecord(client, path, optional = false) {
  const bytes = await readBytes(client, path, optional);
  return bytes === null ? null : JSON.parse(bytes.toString('utf8'));
}
async function writeRecord(client, path, value) {
  const bytes = Buffer.from(JSON.stringify(value));
  const { error } = await store(client).upload(path, bytes, { contentType: 'application/json', cacheControl: '0', upsert: false });
  if (error) throw new Error('백업 실행 기록 저장 실패');
  if (!bytes.equals(await readBytes(client, path))) throw new Error('백업 실행 기록 확인 실패');
}
async function listFiles(client) {
  const files = [];
  for (let offset = 0; offset < 2000; offset += 100) {
    const { data, error } = await store(client).list('', { limit: 100, offset, sortBy: { column: 'name', order: 'desc' } });
    if (error || !Array.isArray(data)) throw new Error('백업 파일 목록 조회 실패');
    files.push(...data.filter(f => FILE.test(f.name) && f.id !== null));
    if (data.length < 100) return files;
  }
  throw new Error('백업 파일 수가 점검 한도를 넘었어요. 자동 정리는 중단합니다.');
}
function validSuccess(record, name) {
  return record?.version === 1 && record.status === 'succeeded' && record.name === name
    && /^[a-f0-9]{64}$/.test(record.sha256) && Number.isSafeInteger(record.bytes) && record.bytes > 0
    && Number.isFinite(Date.parse(record.completedAt)) && Number.isFinite(Date.parse(record.startedAt))
    && Date.parse(record.completedAt) >= Date.parse(record.startedAt);
}
async function verifiedRecords(client, files) {
  const records = [];
  for (let i = 0; i < files.length; i += 4) {
    const batch = await Promise.all(files.slice(i, i + 4).map(async file => {
      const [record, failed] = await Promise.all([
        readRecord(client, resultPath(file.name), true),
        readRecord(client, `${MONITOR}/${file.name}.failed.json`, true),
      ]);
      if (failed) return null;
      if (record && record.status === 'succeeded' && !validSuccess(record, file.name)) throw new Error('백업 성공 기록 형식 오류');
      return validSuccess(record, file.name) ? record : null;
    }));
    records.push(...batch.filter(Boolean));
  }
  return records.sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt) || b.name.localeCompare(a.name));
}
function validateArchive(backup) {
  const value = JSON.parse(gunzipSync(backup.bytes).toString('utf8'));
  const names = Object.keys(value.data || {});
  if (!names.length || names.length !== Object.keys(value.counts || {}).length || value.takenAt !== backup.takenAt) throw new Error('백업 내용 형식 오류');
  for (const name of names) if (!Array.isArray(value.data[name]) || value.data[name].length !== value.counts[name] || value.counts[name] !== backup.counts[name]) throw new Error('백업 행 수 불일치');
}

export async function saveVerifiedBackup(client, build, verify = async () => {}, now = () => new Date()) {
  const startedAt = now().toISOString(), runId = randomUUID();
  const stamp = new Date(Date.parse(startedAt) + 9 * 3600000).toISOString().replace(/[-:TZ.]/g, '');
  const name = `backup-${stamp.slice(0, 8)}-${stamp.slice(8, 14)}-${stamp.slice(14)}-${runId}.json.gz`;
  const base = { version: 1, runId, name, startedAt };
  let stage = 'bucket', completed = false, storageReady = false;
  try {
    await verify();
    await ensureBucket(client);
    storageReady = true;
    stage = 'start_record';
    await writeRecord(client, startedPath(name), { ...base, status: 'running' });
    stage = 'read_database';
    const backup = await build();
    stage = 'validate_archive';
    validateArchive(backup);
    await verify();
    stage = 'upload';
    const { error } = await store(client).upload(name, backup.bytes, { contentType: 'application/gzip', cacheControl: '0', upsert: false });
    if (error) throw new Error('백업 업로드 실패');
    stage = 'verify_file';
    const downloaded = await readBytes(client, name);
    const hash = sha(backup.bytes);
    if (downloaded.length !== backup.bytes.length || sha(downloaded) !== hash) throw new Error('백업 파일 내용 불일치');
    await verify();
    stage = 'success_record';
    const record = { ...base, status: 'succeeded', completedAt: now().toISOString(), sha256: hash, bytes: downloaded.length,
      tables: Object.keys(backup.counts).length, rows: Object.values(backup.counts).reduce((a, b) => a + b, 0) };
    await writeRecord(client, resultPath(name), record);
    completed = true;
    // 파일과 완료 기록을 확인하기 전에는 과거 백업을 지우지 않는다.
    // 확인 기록 없는 예전 파일/실패 파일은 자동 삭제 대상에서 제외한다.
    let retentionWarning = false;
    try {
      await verify();
      const records = await verifiedRecords(client, await listFiles(client));
      const old = records.slice(KEEP).filter(r => r.name !== name).map(r => r.name);
      if (old.length) {
        const { error: removeError } = await store(client).remove(old);
        if (removeError) throw new Error('오래된 백업 정리 실패');
        const remaining = new Set((await listFiles(client)).map(f => f.name));
        if (old.some(file => remaining.has(file))) throw new Error('백업 정리 확인 실패');
      }
    } catch {
      retentionWarning = true;
      console.error(JSON.stringify({ event: 'backup_retention_warning', runId }));
    }
    return { ok: true, ...record, sizeKB: Math.round(record.bytes / 1024), verified: true, retentionWarning };
  } catch (error) {
    let failureRecorded = false;
    if (!completed && storageReady) {
      try {
        // 성공 기록 저장 응답이 불명확하면 덮어쓰지 않고 별도 실패 기록으로 남긴다.
        await writeRecord(client, `${MONITOR}/${name}.failed.json`, { ...base, status: 'failed', failedAt: now().toISOString(), stage });
        failureRecorded = true;
      } catch { /* 저장소 장애는 HTTP 실패와 비밀값 없는 서버 로그로 확인한다. */ }
    }
    error.backupFailure = { runId, stage, failureRecorded };
    console.error(JSON.stringify({ event: 'backup_failed', ...error.backupFailure }));
    throw error;
  }
}

// 요약은 동일한 완료/실패 기록을 사용하되 gzip 본문 다운로드를 생략한다.
async function inspectBackupState(client, now, verifyArchive) {
  const checkedAt = now().toISOString();
  if (!(await bucketExists(client))) return { rows: [], health: { state: 'missing', checkedAt, lastSuccessAt: null, latestAttempt: null } };
  const files = await listFiles(client);
  const records = await verifiedRecords(client, files);
  const { data: starts, error } = await store(client).list(MONITOR, { limit: 1, search: '.started.json', sortBy: { column: 'name', order: 'desc' } });
  if (error || !Array.isArray(starts)) throw new Error('백업 실행 상태 조회 실패');
  let latestAttempt = null;
  if (starts.length) {
    const name = starts[0].name.replace(/\.started\.json$/, '');
    if (!FILE.test(name)) throw new Error('백업 실행 기록 이름 오류');
    const start = await readRecord(client, startedPath(name));
    if (start?.version !== 1 || start.name !== name || !Number.isFinite(Date.parse(start.startedAt))) throw new Error('백업 시작 기록 형식 오류');
    const failed = await readRecord(client, `${MONITOR}/${name}.failed.json`, true);
    const result = await readRecord(client, resultPath(name), true);
    if (failed && (failed.status !== 'failed' || failed.name !== name || !Number.isFinite(Date.parse(failed.failedAt)))) throw new Error('백업 실패 기록 형식 오류');
    if (result && !validSuccess(result, name)) throw new Error('백업 완료 기록 형식 오류');
    latestAttempt = failed || result || { ...start, status: Date.parse(checkedAt) - Date.parse(start.startedAt) > RUN_TIMEOUT ? 'interrupted' : 'running' };
  }
  // 시작 기록 저장 자체가 실패했어도, 별도로 남길 수 있었던 실패를 발견한다.
  const failureList = await store(client).list(MONITOR, { limit: 1, search: '.failed.json', sortBy: { column: 'name', order: 'desc' } });
  if (failureList.error || !Array.isArray(failureList.data)) throw new Error('백업 실패 목록 조회 실패');
  if (failureList.data.length) {
    const failure = await readRecord(client, `${MONITOR}/${failureList.data[0].name}`);
    if (failure?.status !== 'failed' || !FILE.test(failure.name) || !Number.isFinite(Date.parse(failure.startedAt))) throw new Error('백업 실패 기록 형식 오류');
    if (!latestAttempt || Date.parse(failure.startedAt) >= Date.parse(latestAttempt.startedAt)) latestAttempt = failure;
  }
  const last = [records[0], latestAttempt?.status === 'succeeded' ? latestAttempt : null].filter(Boolean)
    .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))[0] || null;
  let state = last ? 'healthy' : files.length ? 'unverified' : 'missing';
  if (last) {
    if (verifyArchive) {
      const bytes = await readBytes(client, last.name, true);
      if (!bytes || bytes.length !== last.bytes || sha(bytes) !== last.sha256) state = 'file_invalid';
    } else {
      const file = files.find(file => file.name === last.name);
      if (!file) state = 'file_missing';
      else if (!Number.isSafeInteger(file.metadata?.size)) state = 'unverified';
      else if (file.metadata.size !== last.bytes) state = 'file_invalid';
    }
    if (state === 'healthy' && (Date.parse(last.completedAt) > Date.parse(checkedAt) || Date.parse(checkedAt) - Date.parse(last.completedAt) > MAX_AGE)) state = 'stale';
  }
  if (latestAttempt?.status === 'succeeded' && !files.some(f => f.name === latestAttempt.name)) state = 'file_missing';
  if (['failed', 'running', 'interrupted'].includes(latestAttempt?.status)) state = latestAttempt.status;
  const verified = new Map(records.map(record => [record.name, record]));
  return {
    rows: files.map(file => ({ name: file.name, sizeKB: Math.round((file.metadata?.size || 0) / 1024), createdAt: file.created_at,
      verifiedAt: verified.get(file.name)?.completedAt || null })),
    health: { state, checkedAt, lastSuccessAt: last?.completedAt || null, latestAttempt,
      lastSuccess: last, maxAgeHours: MAX_AGE / 3600000, runTimeoutMinutes: RUN_TIMEOUT / 60000 },
  };
}

/** 상세/외부 감시: 읽기 전용으로 파일 본문과 SHA까지 재검사한다. */
export function inspectBackups(client, now = () => new Date()) {
  return inspectBackupState(client, now, true);
}

/** 첫 화면: 상태와 시각만 반환한다. 파일명/주소/자료 수/실행 ID는 노출하지 않는다. */
export async function inspectBackupSummary(client, now = () => new Date()) {
  const status = await inspectBackupState(client, now, false), h = status.health;
  let state = h.state;
  // 기존 주간 예약: 일요일 03:00 KST. 45분 유예가 끝난 가장 최근 예약분을 확인한다.
  const epoch = Date.UTC(1970, 0, 3, 18), week = 7 * 86400000;
  const due = epoch + Math.floor((Date.parse(h.checkedAt) - 45 * 60000 - epoch) / week) * week;
  if (['healthy', 'running'].includes(state) && (!h.lastSuccess || Date.parse(h.lastSuccess.startedAt) < due)) state = 'overdue';
  return { state, checkedAt: h.checkedAt, lastSuccessAt: h.lastSuccessAt,
    verification: 'completion-record-and-size', latestAttemptAt: h.latestAttempt?.startedAt || null };
}

// 기존 서버(오류도 HTTP200)에도 백업 경로만 좁게 적용할 수 있는 응답 계약.
export function backupHttpStatus(action, result) {
  if (!['backupNow', 'createBackup', 'getBackups', 'getBackupSummary'].includes(action)) return 200;
  if (result?.error) return result.error === 'key' ? 401 : 503;
  return action === 'backupNow' && result?.checkOnly && result?.health?.state !== 'healthy' ? 503 : 200;
}
export function backupErrorBody(error) {
  return { error: '백업 완료를 확인하지 못했어요. 백업 상태를 확인해 주세요.', code: 'BACKUP_FAILED',
    ...(error.backupFailure || {}), retry: false };
}
