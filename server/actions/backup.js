// 백업: 모든 표를 한 파일(JSON, gzip)로 묶어 Supabase 저장소의 비공개 칸 'backups' 에 둔다.
// 매주 자동으로 한 번(예약) + 관리자가 필요할 때 바로. 확인된 최근 8개를 남긴다. 과거 미확인 파일은 자동 삭제하지 않는다.
import { gzipSync } from 'node:zlib';
import { db, run, selectAll } from '../lib/db.js';
import { backupTableQuery } from '../lib/backup-order.js';
import { BACKUP_BUCKET, saveVerifiedBackup, inspectBackups } from '../lib/backup-storage.js';
import { kstDateTime } from '../lib/util.js';
import { clip } from '../lib/input.js';
import { isApprover } from './roster.js';

/** 모든 표를 읽어 파일 하나로 만든다. */
async function buildBackup() {
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

const makeBackup = () => saveVerifiedBackup(db(), buildBackup);

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
  if (!mid || !(await isApprover(mid))) return { error: '백업은 교육부·전도부 담당만 받을 수 있어요.' };
  const made = await makeBackup();
  const { data, error } = await db().storage.from(BACKUP_BUCKET).createSignedUrl(made.name, 600, { download: made.name });
  if (error) throw new Error(error.message);
  return { ...made, url: data.signedUrl };
}

/** 보관 중인 백업 목록. */
async function getBackups(body) {
  const mid = clip(body.memberId, 40);
  if (!mid || !(await isApprover(mid))) return { error: '백업은 교육부·전도부 담당만 볼 수 있어요.' };
  return inspectBackups(db());
}

export default { backupNow, createBackup, getBackups };
