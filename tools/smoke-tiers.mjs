// 등급 쓰기 기능 연습 점검(시험 교사를 만들고 끝에 지운다).
//   node --env-file=.env tools/smoke-tiers.mjs
import assert from 'node:assert/strict';
import { db, run } from '../server/lib/db.js';
import { actions as a } from '../server/registry.js';

const T = { memberId: 'ZZTEST-9000003', name: '시험교사C' };
try {
  assert.equal((await a.upsertRosterLeader({ ...T, dept: '기타', region: 'ZZ지역', position: '' })).created, true);
  let s = await a.getMyTierStatus(T);
  assert.equal(s.tier, '활동교사'); assert.equal(s.nextTier, '정교사');
  assert.equal(s.suggestion.suggestedTier, '휴교사');   // 활동이 없으니 휴교사 전환 제안

  // 사유자 등록 → 심사 목록에 사유가 붙는다 → 취소
  assert.match((await a.registerLeaveReason({ ...T, reason: '여행' })).error, /사유는/);
  assert.equal((await a.registerLeaveReason({ ...T, reason: '질병' })).created, true);
  assert.equal((await a.registerLeaveReason({ ...T, reason: '출산' })).updated, true);
  const row = (await a.checkTierChanges({})).rows.find((r) => r.memberId === T.memberId);
  assert.match(row.reason, /사유자\(출산\)/); assert.equal(row.pendingType, 'reason');
  assert.equal((await a.deleteApprovalRow({ ...T, suggestedTier: '휴교사' })).deleted, true);
  assert.equal((await a.deleteApprovalRow({ ...T, suggestedTier: '휴교사' })).deleted, false);

  // 일괄 등급 변경
  assert.match((await a.bulkChangeTier({ approverDept: '청년회', approverName: '홍', items: [{ ...T, newTier: '정교사' }] })).error, /교육부·전도부만/);
  const res = await a.bulkChangeTier({ approverDept: '교육부', approverName: '홍길동', items: [
    { ...T, newTier: '정교사' }, { memberId: '없는번호-1', newTier: '정교사' }, { ...T, newTier: '이상한등급' },
  ] });
  assert.deepEqual(res.changed, [{ memberId: T.memberId, name: T.name, prevTier: '활동교사', tier: '정교사' }]);
  assert.equal(res.failed.length, 2); assert.equal(res.approver, '교육부 홍길동');
  s = await a.getMyTierStatus(T);
  assert.equal(s.tier, '정교사'); assert.match(s.tierChangedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.match((await a.bulkChangeTier({ approverDept: '전도부', approverName: '홍', items: [{ ...T, newTier: '정교사' }] })).failed[0].error, /이미 정교사/);
  const hist = await run(db().from('tier_history').select('*').eq('member_id', T.memberId));
  assert.equal(hist.length, 1); assert.equal(hist[0].reason, '일괄 승인');
  console.log('등급 쓰기 점검 통과');
} finally {
  await run(db().from('tier_history').delete().eq('member_id', T.memberId));
  await run(db().from('tier_approvals').delete().eq('member_id', T.memberId));
  await run(db().from('teachers').delete().eq('member_id', T.memberId));
}
