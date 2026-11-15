import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileStorage } from './helpers/backup-file-storage.mjs';
import { inspectBackups, inspectBackupSummary, saveVerifiedBackup } from '../server/lib/backup-storage.js';
import { backupSummaryView, backupTime } from '../next-app/lib/backup-summary.ts';
const now=()=>new Date('2026-11-15T01:00:00.000Z');
const build=async()=>{
  const takenAt='2026-11-15 10:00:00',counts={teachers:1},data={teachers:[{id:'synthetic',payload:randomBytes(256*1024).toString('hex')}]};
  return {takenAt,counts,bytes:gzipSync(JSON.stringify({takenAt,counts,data}))};
};
test('요약은 파일 본문을 받지 않고 기록/크기를 읽으며 전체 검사와 상태·마지막 성공이 같다',async()=>{
  const f=fileStorage(),made=await saveVerifiedBackup(f.client,build,undefined,now);
  f.state.calls=[];f.state.receivedBytes=0;
  const summary=await inspectBackupSummary(f.client,now),small=f.state.receivedBytes;
  assert.equal(summary.state,'healthy');assert.equal(summary.lastSuccessAt,made.completedAt);
  assert.ok(!f.state.calls.some(c=>c.method==='GET'&&c.path.endsWith('.json.gz')));
  assert.ok(f.state.calls.every(c=>c.method==='GET'||c.path.includes('/object/list/')));
  assert.ok(!JSON.stringify(summary).includes(made.name));assert.ok(Buffer.byteLength(JSON.stringify(summary))<350);
  f.state.receivedBytes=0;const full=await inspectBackups(f.client,now),large=f.state.receivedBytes;
  assert.equal(full.health.state,summary.state);assert.equal(full.health.lastSuccessAt,summary.lastSuccessAt);
  assert.equal(large-small,made.bytes);assert.ok(small<6000);
  console.log(JSON.stringify({evidence:'local-sdk-response-bytes',summaryBytes:small,fullBytes:large,archiveBytes:made.bytes,publicSummaryBytes:Buffer.byteLength(JSON.stringify(summary))}));
});
test('미검증·실패·미완료·파일 삭제/크기 변경을 기록과 메타정보로 감지한다',async()=>{
  const f=fileStorage();f.state.exists=false;assert.equal((await inspectBackupSummary(f.client,now)).state,'missing');assert.equal(f.state.exists,false);
  f.state.exists=true;writeFileSync(f.file('backup-20261012-125354.json.gz'),Buffer.from('old'));
  assert.equal((await inspectBackupSummary(f.client,now)).state,'unverified');
  const made=await saveVerifiedBackup(f.client,build,undefined,now),original=readFileSync(f.file(made.name));
  writeFileSync(f.file(made.name),Buffer.from('short'));assert.equal((await inspectBackupSummary(f.client,now)).state,'file_invalid');
  writeFileSync(f.file(made.name),original);unlinkSync(f.file(made.name));assert.equal((await inspectBackupSummary(f.client,now)).state,'file_missing');
  writeFileSync(f.file(made.name),original);
  await assert.rejects(saveVerifiedBackup(f.client,async()=>{throw Error('private');},undefined,()=>new Date(now().getTime()+1000)));
  assert.equal((await inspectBackupSummary(f.client,()=>new Date(now().getTime()+2000))).state,'failed');
});
test('주간 누락은 유예 뒤 경고, 8일 경과와 미완료 15분도 경고한다',async()=>{
  const f=fileStorage(),past=()=>new Date('2026-11-07T18:00:00Z');
  await saveVerifiedBackup(f.client,build,undefined,past);
  assert.equal((await inspectBackupSummary(f.client,()=>new Date('2026-11-14T18:44:59Z'))).state,'healthy');
  assert.equal((await inspectBackupSummary(f.client,()=>new Date('2026-11-14T18:45:00Z'))).state,'overdue');
  assert.equal((await inspectBackupSummary(f.client,()=>new Date('2026-11-16T18:00:01Z'))).state,'stale');
  const fresh=await saveVerifiedBackup(f.client,build,undefined,now);
  const record=JSON.parse(readFileSync(f.file(`_monitor/${fresh.name}.started.json`),'utf8'));
  record.startedAt=new Date(now().getTime()+1000).toISOString();record.name=fresh.name.replace('-000-', '-999-');
  writeFileSync(f.file(`_monitor/${record.name}.started.json`),JSON.stringify(record));
  assert.equal((await inspectBackupSummary(f.client,()=>new Date(now().getTime()+60000))).state,'running');
  assert.equal((await inspectBackupSummary(f.client,()=>new Date(now().getTime()+16*60000))).state,'interrupted');
});
test('같은 크기의 손상은 요약에서 확정하지 않으며 상세 검사에서 발견한다',async()=>{
  const f=fileStorage(),made=await saveVerifiedBackup(f.client,build,undefined,now),b=readFileSync(f.file(made.name));b[0]^=1;writeFileSync(f.file(made.name),b);
  const summary=await inspectBackupSummary(f.client,now);
  assert.equal(summary.verification,'completion-record-and-size');assert.equal(summary.state,'healthy');
  assert.equal((await inspectBackups(f.client,now)).health.state,'file_invalid');
  assert.match(backupSummaryView(summary).title,/기록/);
});
test('첫 화면 문구는 정상/진행/경고/알 수 없는 상태와 한국 시간을 구분한다',()=>{
  for(const state of ['healthy','running','failed','missing','unverified','interrupted','stale','overdue','file_missing','file_invalid','unexpected']){
    const view=backupSummaryView({state,checkedAt:now().toISOString(),verification:'completion-record-and-size',lastSuccessAt:null,latestAttemptAt:null});
    assert.equal(view.warning,!['healthy','running'].includes(state));assert.ok(view.title);
  }
  assert.equal(backupTime('2026-11-15T01:00:00Z'),'2026-11-15 10:00');assert.equal(backupTime(null),'아직 확인되지 않음');
});
