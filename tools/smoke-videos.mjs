// 영상·교재 신청 쓰기 기능 연습 점검(시험 계정으로 만들고 끝에 지운다). 제목이 [TEST] 로 시작하면 봇 알림을 보내지 않는다.
//   node --env-file=.env tools/smoke-videos.mjs
import assert from 'node:assert/strict';
import { db, run } from '../server/lib/db.js';
import { actions as a } from '../server/registry.js';

const STAFF = 'ZZTEST-9000031', TEACHER = 'ZZTEST-9000032', OUTSIDER = 'ZZTEST-9000033';
const URL = 'https://youtu.be/ZZtest00001';
try {
  await run(db().from('admins').insert({ member_id: STAFF, name: '시험담당', dept: '전도부', position: '교육부장' }));
  await a.upsertRosterLeader({ memberId: TEACHER, name: '시험교사', dept: '기타', region: 'ZZ지역', position: '' });

  // 신청 → 댓글 → 승인
  assert.match((await a.requestVideo({ memberId: OUTSIDER, video: { url: URL } })).error, /교사명단/);
  assert.match((await a.requestVideo({ memberId: TEACHER, video: { url: 'x', parts: ['상담'] } })).error, /유튜브 주소/);
  assert.match((await a.requestVideo({ memberId: TEACHER, video: { url: URL, title: '[TEST] 시험 영상 123', parts: ['상담'] } })).error, /전화번호/);
  const req = await a.requestVideo({ memberId: TEACHER, video: { url: URL, title: '[TEST] 시험 영상 123', parts: ['복음방', '상담', '없는코너'], phone: '010-1234-5678' } });
  assert.equal(req.ok, true);
  assert.match((await a.requestVideo({ memberId: TEACHER, video: { url: URL, title: '[TEST] 다른 제목', parts: ['상담'], phone: '01012345678' } })).error, /승인을 기다리는/);
  assert.equal((await a.getVideos({})).videos.some((v) => v.id === req.id), false);   // 승인 전에는 목록에 없다

  let box = await a.getVideoRequests({ memberId: TEACHER });
  assert.equal(box.isApprover, false); assert.equal(box.requests.length, 1); assert.equal(box.requests[0].part, '상담,복음방'); assert.equal(box.requests[0].phone, '');
  box = await a.getVideoRequests({ memberId: STAFF });
  assert.equal(box.isApprover, true); assert.equal(box.requests.find((r) => r.id === req.id).phone, '010-1234-5678');
  assert.match((await a.addRequestComment({ memberId: OUTSIDER, reqId: req.id, text: 'x' })).error, /내가 낸 신청/);
  assert.equal((await a.addRequestComment({ memberId: TEACHER, reqId: req.id, text: '부탁드립니다' })).comment.staff, false);
  assert.equal((await a.addRequestComment({ memberId: STAFF, reqId: req.id, text: '확인했어요' })).comment.staff, true);
  assert.equal((await a.getVideoRequests({ memberId: TEACHER })).comments[req.id].length, 2);

  assert.match((await a.reviewVideoRequest({ memberId: TEACHER, id: req.id, approve: true })).error, /교육부·전도부만/);
  const approved = await a.reviewVideoRequest({ memberId: STAFF, id: req.id, approve: true, title: '[TEST] 고친 제목 123', parts: ['소양'] });
  assert.deepEqual([approved.status, approved.part, approved.videoId], ['승인', '소양', 'ZZtest00001']);
  assert.equal((await a.getVideos({ part: '소양' })).videos.find((v) => v.id === req.id).title, '[TEST] 고친 제목 123');
  assert.match((await a.reviewVideoRequest({ memberId: STAFF, id: req.id, approve: true })).error, /이미 처리/);

  // 바로 올리기: 같은 영상·비슷한 제목 확인
  assert.match((await a.saveVideo({ memberId: TEACHER, video: { url: URL } })).error, /교육부·전도부만/);
  assert.match((await a.saveVideo({ memberId: STAFF, video: { url: URL, title: '[TEST] x', parts: ['소양'] } })).error, /올라와 있는/);
  const similar = await a.saveVideo({ memberId: STAFF, video: { url: 'ZZtest00002', title: '[TEST] 고친 제목 123', parts: ['소양'] } });
  assert.equal(similar.needConfirm, true); assert.equal(similar.similar[0].videoId, 'ZZtest00001');
  const second = await a.saveVideo({ memberId: STAFF, video: { url: 'ZZtest00002', title: '[TEST] 고친 제목 123', parts: ['소양'], force: true, uploadDate: '2026-01-02' } });
  assert.equal((await a.saveVideo({ memberId: STAFF, video: { id: second.id, url: 'ZZtest00002', title: '[TEST] 둘째 영상 456', parts: ['무신앙'] } })).ok, true);
  assert.equal((await a.getVideoTranscript({ id: second.id })).exists, false);
  assert.match((await a.videoTranscribe({ memberId: TEACHER, id: second.id })).error, /관리자만/);
  assert.equal((await a.deleteVideo({ memberId: STAFF, id: second.id })).ok, true);
  assert.match((await a.deleteVideo({ memberId: STAFF, id: second.id })).error, /찾을 수 없/);

  // 교재 신청
  const wish = await a.requestTextbook({ memberId: TEACHER, wish: { title: '[TEST] 희망 교재', part: '상담', note: '메모', phone: '01012345678' } });
  box = await a.getVideoRequests({ memberId: TEACHER });
  assert.equal(box.wishes.length, 1); assert.equal(box.wishes[0].status, '신청');
  assert.equal((await a.reviewTextbookRequest({ memberId: STAFF, id: wish.id })).ok, true);
  assert.equal((await a.getVideoRequests({ memberId: TEACHER })).wishes[0].status, '확인');
  assert.equal((await a.reviewTextbookRequest({ memberId: STAFF, id: wish.id, remove: true })).ok, true);
  assert.equal((await a.getVideoRequests({ memberId: TEACHER })).wishes.length, 0);
  assert.equal((await a.vtAuto({ key: 'wrong' })).error, 'key');
  console.log('쓰기 점검 통과');
} finally {
  const mine = await run(db().from('videos').select('video_key').in('created_by_id', [STAFF, TEACHER]));
  const wishes = await run(db().from('textbook_wishes').select('wish_id').eq('member_id', TEACHER));
  const ids = [...mine.map((v) => v.video_key), ...wishes.map((w) => w.wish_id)];
  if (ids.length) await run(db().from('request_comments').delete().in('request_id', ids));
  await run(db().from('videos').delete().in('created_by_id', [STAFF, TEACHER]));
  await run(db().from('textbook_wishes').delete().eq('member_id', TEACHER));
  await run(db().from('admins').delete().eq('member_id', STAFF));
  await run(db().from('teachers').delete().eq('member_id', TEACHER));
}
