// 채팅·필수교육·피드백·교관 쓰기 기능 연습 점검(시험 계정으로 만들고 끝에 지운다).
//   node --env-file=.env tools/smoke-misc.mjs
import assert from 'node:assert/strict';
import { db, run } from '../server/lib/db.js';
import { actions as a } from '../server/registry.js';

const A = 'ZZTEST-9000011', B = 'ZZTEST-9000012';
try {
  // 채팅
  assert.match((await a.sendMessage({ fromId: A, toId: A, message: 'x' })).error, /본인/);
  const sent = await a.sendMessage({ fromId: A, toId: B, message: '안녕하세요' });
  assert.equal(sent.chatId, `${A}__${B}`);
  await a.sendMessage({ fromId: B, toId: A, message: '반갑습니다' });
  assert.equal((await a.getMessages({ chatId: sent.chatId })).rows.length, 2);
  assert.deepEqual(await a.getConnectUnread({ memberId: A }), { unread: 1, pendingCoop: 0, total: 1 });
  let list = (await a.getChatList({ memberId: A })).rows;
  assert.equal(list.length, 1); assert.equal(list[0].otherId, B); assert.equal(list[0].unreadCount, 1); assert.equal(list[0].lastMessage, '반갑습니다');
  assert.equal((await a.markRead({ chatId: sent.chatId, memberId: A })).updated, 1);
  assert.equal((await a.getConnectUnread({ memberId: A })).total, 0);
  assert.match((await a.shareContact({ fromId: A, toId: B })).error, /전화번호/);

  // 필수교육
  let edu = await a.updateRequiredEducation({ memberId: A, name: '시험', category: '상담교육', date: '2026-09-01', registrar: '관리자' });
  assert.equal(edu['상담교육'], '2026-09-01'); assert.equal(edu['섭외전도교육'], '');
  edu = await a.updateRequiredEducation({ memberId: A, category: '상담교육', clear: true });
  assert.equal(edu['상담교육'], ''); assert.equal(edu.name, '시험');
  const log = (await a.getRequiredEducationLog()).rows;
  assert.deepEqual([log[0].kind, log[1].kind, log[1].date], ['취소', '등록', '2026-09-01']);
  assert.match((await a.updateRequiredEducation({ memberId: A, category: '없는교육' })).error, /카테고리/);

  // 피드백·교관 요청
  const esc = await a.escalate({ memberId: A, name: '시험', situation: '상황', aiCoachText: 'AI 답' });
  assert.match(esc.receiptNo, /^F-\d{6}$/);
  const req = await a.requestCoach({ memberId: A, name: '시험', content: '교관님 도와주세요' });
  assert.notEqual(req.receiptNo, esc.receiptNo);
  assert.equal((await a.getHistory({ memberId: A })).rows.length, 2);
  const mine = (await a.getMyCoachRequests({ memberId: A })).rows;
  assert.equal(mine.length, 1); assert.equal(mine[0].status, '접수'); assert.equal(mine[0].answeredAt, '');

  // 교관: 시험 교사를 명단에 넣고, 같은 부서·지역 교관(관리자 명단)을 임시로 만든다
  await a.upsertRosterLeader({ memberId: A, name: '시험', dept: 'ZZ부', region: 'ZZ지역', position: '' });
  await run(db().from('admins').insert({ member_id: B, name: '시험교관', dept: 'ZZ부', region: 'ZZ지역', position: '복음방교관' }));
  const my = await a.getMyCoach({ memberId: A });
  assert.equal(my.coach.coachName, '시험교관'); assert.equal(my.isCoach, false);
  assert.equal((await a.getMyCoach({ memberId: B })).isCoach, true);
  assert.match((await a.getCoachFeedbacks({ coachId: A })).error, /활성 교관/);
  let inbox = await a.getCoachFeedbacks({ coachId: B });
  assert.equal(inbox.pending.length, 1); assert.equal(inbox.pending[0].receiptNo, req.receiptNo);
  assert.equal((await a.submitCoachReply({ coachId: B, feedbackId: req.receiptNo, reply: '이렇게 해 보세요' })).ok, true);
  inbox = await a.getCoachFeedbacks({ coachId: B });
  assert.equal(inbox.pending.length, 0); assert.equal(inbox.answered[0].handlerAnswer, '이렇게 해 보세요');
  assert.match((await a.getMyCoachRequests({ memberId: A })).rows[0].answeredAt, /^\d{4}-\d\d-\d\dT/);
  console.log('쓰기 점검 통과');
} finally {
  await run(db().from('chat_messages').delete().in('from_id', [A, B]));
  await run(db().from('required_education').delete().eq('member_id', A));
  await run(db().from('required_education_log').delete().eq('member_id', A));
  await run(db().from('feedbacks').delete().eq('member_id', A));
  await run(db().from('admins').delete().eq('member_id', B));
  await run(db().from('teachers').delete().eq('member_id', A));
}
