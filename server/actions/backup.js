// 백업: 모든 표를 한 파일(JSON, gzip)로 묶어 Supabase 저장소의 비공개 칸 'backups' 에 둔다.
// 매주 자동으로 한 번(예약) + 관리자가 필요할 때 바로. 최근 8개만 남긴다.
import { gzipSync } from 'node:zlib';
import { db, run, selectAll } from '../lib/db.js';
import { kstDateTime } from '../lib/util.js';
import { clip } from '../lib/input.js';
import { isApprover } from './roster.js';

const BUCKET = 'backups';
const KEEP = 8;
// 줄 순서를 정할 열(없으면 id).
const ORDER_BY = { teachers: 'member_id' };

async function ensureBucket() {
  const { data } = await db().storage.getBucket(BUCKET);
  if (data) return;
  const { error } = await db().storage.createBucket(BUCKET, { public: false });
  if (error && !/exist/i.test(error.message)) throw new Error('백업 보관함을 만들지 못했습니다: ' + error.message);
}

/** 모든 표를 읽어 파일 하나로 만든다. */
async function buildBackup() {
  const tables = await run(db().rpc('backup_tables'));
  const data = {};
  const counts = {};
  for (const table of tables) {
    data[table] = await selectAll(() => db().from(table).select('*').order(ORDER_BY[table] || 'id'));
    counts[table] = data[table].length;
  }
  const takenAt = kstDateTime();
  const bytes = gzipSync(Buffer.from(JSON.stringify({ takenAt, counts, data })));
  return { bytes, counts, takenAt, name: `backup-${takenAt.replace(/[-: ]/g, '').replace(/^(\d{8})(\d{6})$/, '$1-$2')}.json.gz` };
}

async function listFiles() {
  const { data, error } = await db().storage.from(BUCKET).list('', { limit: 100, sortBy: { column: 'name', order: 'desc' } });
  if (error) throw new Error(error.message);
  return (data || []).filter((f) => f.name.startsWith('backup-'));
}

/** 백업을 만들어 보관하고, 오래된 것은 지운다. */
async function makeBackup() {
  await ensureBucket();
  const backup = await buildBackup();
  const { error } = await db().storage.from(BUCKET).upload(backup.name, backup.bytes, { contentType: 'application/gzip', upsert: true });
  if (error) throw new Error('백업을 올리지 못했습니다: ' + error.message);
  const old = (await listFiles()).slice(KEEP).map((f) => f.name);
  if (old.length) await db().storage.from(BUCKET).remove(old);
  return { ok: true, name: backup.name, sizeKB: Math.round(backup.bytes.length / 1024), rows: Object.values(backup.counts).reduce((a, b) => a + b, 0), tables: Object.keys(backup.counts).length };
}

/** 주기 실행(주 1회)용. */
async function backupNow(body) {
  const cronKey = process.env.TEACHERSQUARE_CRON_KEY;
  if (!cronKey || String(body.key) !== cronKey) return { error: 'key' };
  return makeBackup();
}

/** 관리자가 바로 백업을 만들고, 내려받을 주소(10분 동안만 열림)를 받는다. */
async function createBackup(body) {
  const mid = clip(body.memberId, 40);
  if (!mid || !(await isApprover(mid))) return { error: '백업은 교육부·전도부 담당만 받을 수 있어요.' };
  const made = await makeBackup();
  const { data, error } = await db().storage.from(BUCKET).createSignedUrl(made.name, 600, { download: made.name });
  if (error) throw new Error(error.message);
  return { ...made, url: data.signedUrl };
}

/** 보관 중인 백업 목록. */
async function getBackups(body) {
  const mid = clip(body.memberId, 40);
  if (!mid || !(await isApprover(mid))) return { error: '백업은 교육부·전도부 담당만 볼 수 있어요.' };
  await ensureBucket();
  return { rows: (await listFiles()).map((f) => ({ name: f.name, sizeKB: Math.round((f.metadata?.size || 0) / 1024), createdAt: f.created_at })) };
}

export default { backupNow, createBackup, getBackups };
