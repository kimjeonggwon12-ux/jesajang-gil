// 같은 요청이 동시에 여러 번 들어와도 겹치지 않는지 점검한다(시험 계정으로 만들고 끝에 지운다).
//   node --env-file=.env tools/smoke-concurrency.mjs
import assert from 'node:assert/strict';
import { db, run } from '../server/lib/db.js';
import { actions as a } from '../server/registry.js';

const T = { memberId: 'ZZTEST-9000051', name: '동시시험' };
const many = (n, make) => Promise.all(Array.from({ length: n }, (_, i) => make(i)));
try {
  // 같은 대상자로 활동 등록 8건이 동시에 → 활동은 8건, 대상자는 1명
  const target = { name: 'ZZ동시대상', gender: '남', ageGroup: '20대', stage: '친분' };
  const acts = await many(8, () => a.submitActivity({ ...T, roles: ['인도자'], activityItem: '친분', target }));
  assert.equal(acts.every((r) => r.ok), true);
  assert.equal((await a.getMyActivities(T)).rows.length, 8);
  const targets = (await a.getTargets(T)).rows;
  assert.equal(targets.length, 1, '대상자가 한 명이어야 한다');

  // 접수 8건이 동시에 → 접수번호가 모두 다르다
  const receipts = await many(8, (i) => a.escalate({ ...T, situation: '동시 접수 ' + i, aiCoachText: '' }));
  assert.equal(new Set(receipts.map((r) => r.receiptNo)).size, 8, '접수번호가 겹치면 안 된다');

  // 명함 저장 6건이 동시에 → 명함은 한 장
  const cards = await many(6, (i) => a.saveConnectCard({ memberId: T.memberId, data: { name: T.name, phone: '010-0000-0051', schedType: '언제나', oneLiner: '저장 ' + i } }));
  assert.equal(cards.every((r) => r.ok), true);
  const stored = await run(db().from('connect_cards').select('id').eq('member_id', T.memberId));
  assert.equal(stored.length, 1, '명함이 한 장이어야 한다');

  // 좋아요 10명이 동시에 → 10개
  const post = await a.savePlazaPost({ ...T, data: { category: '나눔', title: 'ZZ동시 글', body: '본문' } });
  await many(10, (i) => a.togglePlazaLike({ postId: post.postId, memberId: 'ZZTEST-90001' + String(i).padStart(2, '0') }));
  assert.equal((await a.getPlazaPost({ postId: post.postId })).post.likeCount, 10);
  await run(db().from('plaza_posts').delete().eq('post_id', post.postId));
  console.log('동시성 점검 통과');
} finally {
  const mine = await run(db().from('targets').select('target_id').eq('creator_id', T.memberId));
  if (mine.length) await run(db().from('target_history').delete().in('target_id', mine.map((t) => t.target_id)));
  await run(db().from('targets').delete().eq('creator_id', T.memberId));
  await run(db().from('activities').delete().eq('member_id', T.memberId));
  await run(db().from('feedbacks').delete().eq('member_id', T.memberId));
  await run(db().from('connect_cards').delete().eq('member_id', T.memberId));
  await run(db().from('plaza_posts').delete().eq('member_id', T.memberId));
}
