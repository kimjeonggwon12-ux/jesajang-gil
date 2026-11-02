// 센터 보내기 흐름 + 휴교사→활동교사(4회) 점검 — 시험 계정을 만들고 끝에 지운다.
//   node --env-file=.env tools/smoke-center-send.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db, run } from '../server/lib/db.js';
import { kstDateTime } from '../server/lib/util.js';
import { actions as a } from '../server/registry.js';
import { promoteOnRecord } from '../server/actions/tiers.js';

const T = { memberId: 'ZZTEST-9100001', name: '시험교사S' };
const L = { memberId: 'ZZTEST-9100002', name: '시험지역장' };
const X = { memberId: 'ZZTEST-9100003', name: '다른지역장' };
const S = { memberId: 'ZZTEST-9100004', name: '시험강사' };
const HQ = { memberId: '20113000010', name: '관리자' };
const tid = 'zztest-' + randomUUID();
let centerId = null;
const ids = [T, L, X, S].map((p) => p.memberId);
try {
  await a.upsertRosterLeader({ ...T, dept: '기타', region: 'ZZ지역', position: '' });
  await a.upsertRosterLeader({ ...L, dept: '기타', region: 'ZZ지역', position: '지역장' });
  await a.upsertRosterLeader({ ...X, dept: '기타', region: 'YY지역', position: '지역장' });
  await a.upsertRosterLeader({ ...S, dept: '교역자', region: '', position: '' });

  // ── 휴교사 → 활동교사: 최근 한 달 4회 ──
  await run(db().from('teachers').update({ tier: '휴교사' }).eq('member_id', T.memberId));
  const rec = () => run(db().from('activities').insert({ member_id: T.memberId, name: T.name, submitted_at: kstDateTime(), activities: ['섭외'], roles: ['교사'] }));
  for (let i = 1; i <= 3; i++) { await rec(); const r = await promoteOnRecord(T.memberId); assert.deepEqual(r, { restCount: i, restGoal: 4 }); }
  let s = await a.getMyTierStatus(T);
  assert.equal(s.tier, '휴교사'); assert.equal(s.recentRecords, 3); assert.equal(s.activeGoal, 4);
  await rec();
  assert.equal((await promoteOnRecord(T.memberId)).tierNow, '활동교사');
  s = await a.getMyTierStatus(T);
  assert.equal(s.tier, '활동교사'); assert.ok(s.restInDays >= 29);
  console.log('✓ 휴교사 → 활동교사 4회 규칙');

  // ── 센터 보내기 ──
  await run(db().from('targets').insert({ target_id: tid, creator_id: T.memberId, teacher_name: T.name, target_name: '홍길동', stage: '복음방', created_at: kstDateTime(), updated_at: kstDateTime() }));
  assert.match((await a.saveCenter({ ...L, centerName: 'X', openMonth: '2026-11' })).error, /전도부/);
  centerId = (await a.saveCenter({ ...HQ, centerName: 'ZZ시험센터', cohortNo: '1기', openMonth: '2026-11', staff: [{ ...S, role: '강사' }] })).id;
  assert.ok(centerId);

  assert.match((await a.requestCenterApproval({ ...L, targetId: tid })).error, /본인 담당/);
  const req = await a.requestCenterApproval({ ...T, targetId: tid, note: '복음방 3과까지', hopeCenter: '11월 개강' });
  assert.equal(req.referral.status, '요청'); assert.equal(req.referral.region, 'ZZ지역');
  assert.match((await a.requestCenterApproval({ ...T, targetId: tid })).error, /이미/);
  const rid = req.referral.id;

  const deskL = await a.getCenterDesk(L);
  assert.ok(deskL.me.canDecide); assert.ok(deskL.rows.some((r) => r.id === rid));
  assert.ok(!(await a.getCenterDesk(X)).rows.some((r) => r.id === rid));   // 다른 지역은 못 봄
  assert.equal((await a.getCenterSendBadge(L)).toDecide >= 1, true);
  assert.match((await a.getCenterReferral({ ...X, id: rid })).error, /볼 수 있는/);
  assert.equal((await a.decideCenterReferral({ ...X, ids: [rid], decision: '승인' })).done, 0);
  assert.match((await a.decideCenterReferral({ ...L, ids: [rid], decision: '반려' })).error, /사유/);
  assert.equal((await a.decideCenterReferral({ ...L, ids: [rid], decision: '승인', note: '좋아요' })).done, 1);
  assert.match((await a.cancelCenterRequest({ ...T, id: rid })).error, /이미 처리/);

  const sent = await a.sendToCenter({ ...L, ids: [rid], centerId, note: '잘 부탁드립니다' });
  assert.equal(sent.done, 1); assert.match(sent.center, /ZZ시험센터 1기/);
  const deskS = await a.getCenterDesk(S);
  assert.ok(deskS.inbox.some((r) => r.id === rid));
  assert.equal((await a.getCenterSendBadge(S)).unread, 1);
  const doc = await a.getCenterReferral({ ...S, id: rid });
  assert.equal(doc.snapshot.target.name, '홍길동'); assert.ok(doc.row.centerReadAt);
  assert.equal((await a.getCenterSendBadge(S)).unread, 0);
  const st = await a.getCenterSendState({ ...T, targetId: tid });
  assert.equal(st.referral.status, '전달'); assert.match(st.referral.centerLabel, /ZZ시험센터/);
  console.log('✓ 요청 → 지역장 승인 → 센터 전달 → 센터 서류 열람');
  // 담긴 건 빼기(센터 강사) → 지역장 승인 전 대기, 다른 지역장은 못 뺌
  assert.match((await a.reopenCenterReferral({ ...X, id: rid })).error, /처리할 수 있는/);
  assert.ok((await a.reopenCenterReferral({ ...S, id: rid, note: '서류 보완' })).ok);
  let back = (await a.getCenterSendState({ ...T, targetId: tid })).referral;
  assert.equal(back.status, '요청'); assert.match(back.decideNote, /^센터에서 뺌 — 시험강사.*서류 보완/);
  assert.ok(!(await a.getCenterDesk(S)).inbox.some((r) => r.id === rid));
  assert.equal((await a.decideCenterReferral({ ...L, ids: [rid], decision: '승인' })).done, 1);
  assert.equal((await a.sendToCenter({ ...L, ids: [rid], centerId })).done, 1);
  console.log('✓ 센터에서 빼기 → 승인 전 대기 → 다시 승인·보내기');
  // 기수 삭제: 전도부만, 받은 서류는 '승인'(보내기 대기)으로 돌아감
  assert.match((await a.deleteCenter({ ...L, id: centerId })).error, /전도부/);
  assert.ok((await a.getCenterDesk(HQ)).inbox.some((r) => r.id === rid));   // 전도부는 모든 기수의 받은 서류를 봄
  assert.equal((await a.deleteCenter({ ...HQ, id: centerId })).moved, 1);
  assert.equal((await a.getCenterSendState({ ...T, targetId: tid })).referral.status, '승인');
  assert.match((await a.deleteCenter({ ...HQ, id: centerId })).error, /이미/);
  centerId = null;
  console.log('✓ 기수 삭제 → 서류는 센터 보내기 대기로');
  console.log('센터 보내기 점검 통과');
} finally {
  await run(db().from('center_referrals').delete().eq('target_id', tid));
  if (centerId) await run(db().from('centers').delete().eq('id', centerId));
  await run(db().from('targets').delete().eq('target_id', tid));
  await run(db().from('target_history').delete().eq('target_id', tid));
  await run(db().from('activities').delete().in('member_id', ids));
  await run(db().from('tier_history').delete().in('member_id', ids));
  await run(db().from('teachers').delete().in('member_id', ids));
}
