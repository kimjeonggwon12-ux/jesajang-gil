// 쓰기 기능 연습 점검(시험 계정으로 만들고 끝에 지운다).
//   node --env-file=.env tools/smoke-activities.mjs
import assert from 'node:assert/strict';
import { db, run } from '../server/lib/db.js';
import { actions as a } from '../server/registry.js';

const A = { memberId: 'ZZTEST-9000001', name: '시험교사A' };
const B = { memberId: 'ZZTEST-9000002', name: '시험교사B' };
const target = { name: 'ZZ시험대상', gender: '여', ageGroup: '40대', stage: '친분', note: '첫 기록', todayWork: '인사', nextWork: '차 한잔' };

let r = await a.submitActivity({ ...A, roles: ['인도자', '없는역할'], activityItem: '친분', date: '2026-10-01', target });
assert.equal(r.ok, true); assert.match(r.submittedAt, /^2026-10-01 \d\d:\d\d:\d\d$/);

let mine = await a.getMyActivities(A);
assert.equal(mine.rows.length, 1);
assert.deepEqual(mine.rows[0].roles, ['인도자']);
assert.equal(mine.rows[0].targetDept, '부녀');
assert.equal(mine.roleCounts['인도자'], 1);
assert.equal(mine.roleItemCounts['인도자']['친분'], 1);

let t = (await a.getTargets(A)).rows;
assert.equal(t.length, 1);
const targetId = t[0].targetId;
assert.equal(t[0].stage, '친분'); assert.equal(t[0].leaderId, A.memberId); assert.equal(t[0].history.length, 1);
assert.equal(t[0].history[0].memo, '활동 등록으로 자동 생성');

// 다른 교사가 같은 대상자를 못 건드린다
assert.match((await a.updateTarget({ ...B, targetId, stage: '만남1' })).error, /본인 소유/);

// 같은 대상자에 단계가 올라간 활동 → 갱신 + 이력
await a.submitActivity({ ...A, roles: ['섬김이'], activityItem: '만남1', target: { ...target, stage: '만남1', note: '두번째' } });
t = (await a.getTargets(A)).rows;
assert.equal(t.length, 1); assert.equal(t[0].stage, '만남1'); assert.equal(t[0].helperId, A.memberId); assert.equal(t[0].history.length, 2);

assert.equal((await a.updateTargetStage({ ...A, targetId, stage: '상담1', memo: '메모', nextMeetingDate: '2026-11-01', completed: true })).ok, true);
const j = await a.getTargetJournal({ ...A, targetId });
assert.equal(j.target.stage, '상담1'); assert.equal(j.target.completed, true); assert.equal(j.target.nextMeetingDate, '2026-11-01');
assert.equal(j.stageHistory.length, 3); assert.equal(j.journal.length, 2);

r = await a.addTarget({ ...A, targetName: 'ZZ시험대상2', stage: '이상한단계' });
assert.equal((await a.getTargets(A)).rows.length, 2);
assert.equal((await a.deleteTarget({ ...A, targetId: r.targetId })).deletedHistory, 1);

const del = await a.deleteTarget({ ...A, targetId });
assert.deepEqual([del.deletedActivities, del.deletedHistory], [2, 3]);
assert.equal((await a.getMyActivities(A)).rows.length, 0);
assert.equal((await a.getTargets(A)).rows.length, 0);

// 격려 메시지
r = await a.sendEncouragement({ fromId: B.memberId, fromName: B.name, toId: A.memberId, message: '힘내세요' });
let msgs = (await a.getMyEncouragements(A)).rows;
assert.equal(msgs.length, 1);
assert.equal((await a.markEncouragementRead({ messageId: msgs[0].id })).ok, true);
assert.equal((await a.getMyEncouragements(A)).rows.length, 0);
await run(db().from('encouragements').delete().eq('to_id', A.memberId));

// 인도 실적
await a.submitGospelLead({ ...A, leadName: 'ZZ' });
assert.equal((await a.getMyGospelLeads(A)).rows.length, 1);
await run(db().from('gospel_leads').delete().eq('member_id', A.memberId));

console.log('쓰기 점검 통과');
