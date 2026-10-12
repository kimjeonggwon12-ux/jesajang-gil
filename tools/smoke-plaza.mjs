// 광장·일정·연결 쓰기 기능 연습 점검(시험 계정으로 만들고 끝에 지운다).
//   node --env-file=.env tools/smoke-plaza.mjs
import assert from 'node:assert/strict';
import { db, run } from '../server/lib/db.js';
import { actions as a } from '../server/registry.js';

const A = 'ZZTEST-9000021', B = 'ZZTEST-9000022';
const PIC = 'data:image/png;base64,AAAA';
const made = { posts: [], events: [], ads: [], helps: [] };
try {
  // ── 광장 ──
  assert.match((await a.savePlazaPost({ memberId: A, data: { category: '전도부', title: 't', body: 'b' } })).error, /자유 게시판/);
  assert.match((await a.savePlazaPost({ memberId: A, data: { category: '사례', body: 'b' } })).error, /제목/);
  const post = await a.savePlazaPost({ memberId: A, name: '시험A', data: { category: '성공사례', title: 'ZZ시험 글', body: '본문 입니다', tags: ['#전도', '전도', '기쁨'], photos: [PIC, 'http://x'], thumb: PIC } });
  made.posts.push(post.postId);
  let got = await a.getPlazaPost({ postId: post.postId, memberId: A });
  assert.equal(got.post.category, '사례'); assert.deepEqual(got.post.tags, ['전도', '기쁨']);
  assert.deepEqual(got.post.photos, [PIC]); assert.equal(got.post.isMine, true); assert.equal(got.post.name, '시험A');
  assert.match((await a.savePlazaPost({ memberId: B, data: { postId: post.postId, category: '사례', title: 'x', body: 'y' } })).error, /내가 쓴 글만/);
  await a.savePlazaPost({ memberId: A, data: { postId: post.postId, category: '질문', title: 'ZZ시험 글2', body: '고침' } });
  assert.deepEqual(await a.togglePlazaLike({ postId: post.postId, memberId: B }), { ok: true, liked: true, likeCount: 1 });
  assert.deepEqual(await a.togglePlazaLike({ postId: post.postId, memberId: A }), { ok: true, liked: true, likeCount: 2 });
  assert.deepEqual(await a.togglePlazaLike({ postId: post.postId, memberId: B }), { ok: true, liked: false, likeCount: 1 });
  assert.match((await a.togglePlazaLike({ postId: 'none', memberId: B })).error, /찾지 못/);
  await a.addPlazaComment({ postId: post.postId, memberId: B, name: '시험B', text: '좋아요' });
  got = await a.getPlazaPost({ postId: post.postId, memberId: B });
  assert.equal(got.post.title, 'ZZ시험 글2'); assert.equal(got.post.liked, false); assert.equal(got.post.likeCount, 1);
  assert.equal(got.comments.length, 1); assert.equal(got.comments[0].isMine, true);
  const listed = (await a.listPlazaPosts({ keyword: 'ZZ시험' })).rows;
  assert.equal(listed.length, 1); assert.equal(listed[0].commentCount, 1);
  assert.match((await a.deletePlazaComment({ commentId: got.comments[0].commentId, memberId: A })).error, /내 댓글만/);
  assert.equal((await a.deletePlazaComment({ commentId: got.comments[0].commentId, memberId: B })).ok, true);
  assert.match((await a.adminSetPlazaPhotos({ postId: post.postId, memberId: B, photos: [] })).error, /관리자만/);
  assert.equal((await a.deletePlazaPost({ postId: post.postId, memberId: A })).ok, true);
  assert.match((await a.getPlazaPost({ postId: post.postId })).error, /없는 글/);

  // ── 일정 ──
  assert.match((await a.saveCalendarEvent({ event: { category: '공식', title: 'x', startDate: '2026-12-01' } })).error, /유형/);
  const ev = await a.saveCalendarEvent({ by: A, event: { category: '내일정', title: 'ZZ내일정', startDate: '2026-12-01', repeatDays: [3, 1, 3], repeatUntil: '2099-01-01' } });
  made.events.push(ev.eventId);
  let mine = (await a.getCalendarEvents({ memberId: A })).rows.find((e) => e.eventId === ev.eventId);
  assert.deepEqual(mine.repeatDays, [1, 3]); assert.equal(mine.repeatUntil, '2027-12-01'); assert.equal(mine.type, '내일정');
  assert.equal((await a.getCalendarEvents({ memberId: B })).rows.some((e) => e.eventId === ev.eventId), false);
  assert.equal((await a.getCalendarEvents({})).rows.some((e) => e.eventId === ev.eventId), false);
  assert.match((await a.applyEventStaff({ eventId: ev.eventId, memberId: B, dept: '없음' })).error, /부서/);
  assert.equal((await a.applyEventStaff({ eventId: ev.eventId, memberId: B, name: '시험B', dept: '청', note: '안내' })).ok, true);
  assert.equal((await a.applyEventStaff({ eventId: ev.eventId, memberId: B, name: '시험B', dept: '장' })).updated, true);
  const att = await a.applyEventAttendee({ eventId: ev.eventId, applicantId: B, applicantName: '시험B', applicantDept: '청', applicantRole: '인', guestName: '손님', guestDept: '청', guestAge: '25', guestStage: '친분' });
  let my = await a.getMyEventSignups({ eventId: ev.eventId, memberId: B });
  assert.deepEqual(my.staff, { dept: '장', note: '' }); assert.equal(my.attendees.length, 1); assert.equal(my.totalAttendees, 1);
  const report = await a.getCalendarReport({ eventId: ev.eventId });
  assert.equal(report.total, 1); assert.equal(report.byStage['친분'], 1); assert.equal(report.staffByDept['장'], 1);
  assert.match((await a.deleteEventAttendee({ id: att.id, memberId: A })).error, /찾지 못/);
  assert.equal((await a.deleteEventAttendee({ id: att.id, memberId: B })).ok, true);
  await a.cancelEventStaff({ eventId: ev.eventId, memberId: B });
  my = await a.getMyEventSignups({ eventId: ev.eventId, memberId: B });
  assert.equal(my.staff, null); assert.equal(my.totalAttendees, 0);
  assert.match((await a.deleteCalendarEvent({ eventId: ev.eventId, memberId: B })).error, /본인이 등록한/);
  assert.equal((await a.deleteCalendarEvent({ eventId: ev.eventId, memberId: A })).ok, true);

  const ad = await a.saveCalendarAd({ ad: { title: 'ZZ공지', body: '내용' } });
  made.ads.push(ad.adId);
  const q = await a.saveAdQuestion({ memberId: A, name: '시험A', adId: ad.adId, text: '질문입니다' });
  assert.match((await a.answerAdQuestion({ memberId: A, questionId: q.questionId, answer: '답' })).error, /관리자만/);
  assert.match((await a.saveAdQuestion({ memberId: A, questionId: q.questionId, text: '고침' })).error, /관리자만/);
  assert.equal((await a.getAdQuestions({ adId: ad.adId })).rows[0].text, '질문입니다');
  assert.equal((await a.deleteCalendarAd({ adId: ad.adId })).ok, true);

  // ── 연결 ──
  assert.match((await a.saveConnectCard({ memberId: A, data: { name: '시험A' } })).error, /전화번호/);
  const card = await a.saveConnectCard({ memberId: A, data: { name: '시험A', phone: '010-0000-0001', schedType: '등록', from: '2026-10-01', to: '2026-10-02', days: ['월', '없음'], roles: ['교사', '이상한역할'], hasMajor: true, majorName: '신학' } });
  assert.equal(card.card.expired, true); assert.deepEqual(card.card.days, ['월']); assert.deepEqual(card.card.roles, ['교사']);
  assert.equal((await a.saveConnectCard({ memberId: A, data: { name: '시험A', phone: '01000000001', schedType: '언제나' } })).updated, true);
  const mineCard = (await a.getConnectCard({ memberId: A })).card;
  assert.equal(mineCard.schedType, '언제나'); assert.equal(mineCard.from, ''); assert.equal(mineCard.hasMajor, false);
  assert.equal((await a.searchConnectCards({ keyword: '시험A' })).total, 1);

  assert.match((await a.saveHelpPost({ memberId: A, data: { type: '교사 · 없는항목' } })).error, /역할과 항목/);
  const help = await a.saveHelpPost({ memberId: A, name: '시험A', data: { type: '협력교사·동아리', dept: '청', startDate: '2026-10-01', endDate: '2099-01-01', oneLiner: 'ZZ도움', target: '대상', need: '필요' } });
  made.helps.push(help.helpId);
  let helps = (await a.getHelpPosts({ memberId: B })).rows.filter((h) => h.helpId === help.helpId);
  assert.equal(helps[0].type, '협력교사 · 동아리'); assert.equal(helps[0].isMine, false);
  assert.equal((await a.recordMatch({ kind: '도와주세요', refId: help.helpId, fromId: B, toId: A })).ok, true);
  assert.equal((await a.recordMatch({ kind: '도와주세요', refId: help.helpId, fromId: B, toId: A })).duplicate, true);
  const match = (await a.getConnectAdminOverview()).matches.find((m) => m.refId === help.helpId);
  assert.equal((await a.setMatchDone({ matchId: match.matchId, status: '성사' })).ok, true);
  assert.match((await a.closeHelpPost({ helpId: help.helpId, memberId: B })).error, /본인이 등록한/);
  assert.equal((await a.closeHelpPost({ helpId: help.helpId, memberId: A })).ok, true);
  assert.equal((await a.getHelpPosts({ memberId: B })).rows.some((h) => h.helpId === help.helpId), false);
  assert.match((await a.deleteHelpPost({ helpId: help.helpId, memberId: B })).error, /본인이 등록한/);
  assert.equal((await a.deleteHelpPost({ helpId: help.helpId, memberId: A })).ok, true);
  assert.equal((await a.deleteConnectCard({ memberId: A })).ok, true);
  assert.equal((await a.getConnectCard({ memberId: A })).card, null);
  console.log('쓰기 점검 통과');
} finally {
  if (made.posts.length) {
    await run(db().from('plaza_comments').delete().in('post_id', made.posts));
    await run(db().from('plaza_posts').delete().in('post_id', made.posts));
  }
  for (const id of made.events) await a.deleteCalendarEvent({ eventId: id });
  if (made.ads.length) {
    await run(db().from('ad_questions').delete().in('ad_id', made.ads));
    await run(db().from('calendar_ads').delete().in('ad_id', made.ads));
  }
  if (made.helps.length) {
    await run(db().from('matches').delete().in('ref_id', made.helps));
    await run(db().from('help_posts').delete().in('help_id', made.helps));
  }
  await run(db().from('connect_cards').delete().eq('member_id', A));
}
