// 백업: 모든 표를 한 파일(JSON, gzip)로 묶어 Supabase 저장소의 비공개 칸 'backups' 에 둔다.
// 매주 자동으로 한 번(예약) + 관리자가 필요할 때 바로. 확인된 최근 8개를 남긴다. 과거 미확인 파일은 자동 삭제하지 않는다.
import { gzipSync } from 'node:zlib';
import { db, run, selectAll } from '../lib/db.js';
import { kstDateTime } from '../lib/util.js';
import { clip } from '../lib/input.js';
import { isOwner } from './roster.js';
import { isSystemOwner } from '../lib/system-owner.js';
import { sensitiveActor } from '../lib/sensitive-actor.js';
import { AccessError } from '../lib/request-context.js';
import { backupTableQuery } from '../lib/backup-order.js';
import { BACKUP_BUCKET, saveVerifiedBackup, inspectBackups, inspectBackupSummary } from '../lib/backup-storage.js';

async function backupActor(mid) {
  if (!mid || !isOwner(mid)) throw new AccessError('전체 시스템 백업은 앱 관리자만 사용할 수 있어요.');
  const identity = await sensitiveActor();
  return async () => {
    if (!(await run(db().rpc('sensitive_actor_valid', { p: identity })))) throw new AccessError('로그인이나 담당 정보가 바뀌었어요. 다시 들어와 주세요.', 401);
  };
}

/** 모든 표를 읽어 파일 하나로 만든다. */
export async function buildBackup() {
  const tables = await run(db().rpc('backup_tables'));
  const data = {};
  const counts = {};
  for (const table of tables) {
    data[table] = await selectAll(() => backupTableQuery(db(), table));
    counts[table] = data[table].length;
  }
  const takenAt = kstDateTime();
  const bytes = gzipSync(Buffer.from(JSON.stringify({ takenAt, counts, data })));
  return { bytes, counts, takenAt, name: `backup-${takenAt.replace(/[-: ]/g, '').replace(/^(\d{8})(\d{6})$/, '$1-$2')}.json.gz` };
}

/** 저장된 파일과 완료 기록을 확인한 뒤에만 성공한다. */
const makeBackup = verify => saveVerifiedBackup(db(), buildBackup, verify);

/** 주기 실행(주 1회)용. */
async function backupNow(body) {
  const cronKey = process.env.TEACHERSQUARE_CRON_KEY;
  if (!cronKey || String(body.key) !== cronKey) return { error: 'key' };
  if (body.checkOnly === true) {
    const status = await inspectBackups(db());
    return { ok: status.health.state === 'healthy', checkOnly: true, ...status };
  }
  return makeBackup();
}

/** 관리자가 바로 백업을 만들고, 내려받을 주소(10분 동안만 열림)를 받는다. */
async function createBackup(body) {
  const mid = clip(body.memberId, 40);
  const verify = await backupActor(mid);
  const made = await makeBackup(verify);
  await verify();
  const { data, error } = await db().storage.from(BACKUP_BUCKET).createSignedUrl(made.name, 600, { download: made.name });
  if (error) throw new Error(error.message);
  await verify();
  return { ...made, url: data.signedUrl };
}

/** 보관 중인 백업 목록. */
async function getBackups(body) {
  const mid = clip(body.memberId, 40);
  const verify = await backupActor(mid);
  await verify();
  const status = await inspectBackups(db());
  await verify();
  return status;
}

async function getBackupSummary(body) {
  if (!isSystemOwner(body.memberId)) throw new AccessError('최종 책임자만 백업 상태를 볼 수 있어요.');
  const verify = await backupActor(clip(body.memberId, 40));
  await verify();
  const summary = await inspectBackupSummary(db());
  await verify();
  return summary;
}

export default { backupNow, createBackup, getBackups, getBackupSummary };
