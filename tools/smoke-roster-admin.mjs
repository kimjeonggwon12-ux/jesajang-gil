// 명단 관리 쓰기 기능 연습 점검(시험 계정으로 만들고 끝에 지운다).
//   node --env-file=.env tools/smoke-roster-admin.mjs
import assert from 'node:assert/strict';
import { db, run } from '../server/lib/db.js';
import { actions as a } from '../server/registry.js';

const STAFF = 'ZZTEST-9000061', PLAIN = 'ZZTEST-9000062', NEW = 'ZZTEST-9000063';
try {
  await run(db().from('admins').insert([
    { member_id: STAFF, name: '시험담당', dept: '전도부', region: '', position: '서기' },
    { member_id: PLAIN, name: '시험지역장', dept: '부녀회', region: '01지역', position: '부녀회지역장' },
  ]));
  const me = { memberId: STAFF };

  // 권한: 교육·전도 담당이 아니면 관리자여도 못 한다
  assert.match((await a.searchRoster({ memberId: PLAIN, query: '시험' })).error, /교육부·전도부/);
  assert.match((await a.saveRosterMember({ memberId: PLAIN, member: { memberId: NEW, name: 'x', dept: 'y', isNew: true } })).error, /교육부·전도부/);

  // 추가
  assert.match((await a.saveRosterMember({ ...me, member: { memberId: '12', name: 'x', dept: 'y', isNew: true } })).error, /고유번호/);
  assert.match((await a.saveRosterMember({ ...me, member: { memberId: NEW, dept: 'y', isNew: true } })).error, /이름/);
  assert.match((await a.saveRosterMember({ ...me, member: { memberId: NEW, name: '시험새교사', dept: '청년회' } })).error, /찾을 수 없/);
  const made = await a.saveRosterMember({ ...me, member: { memberId: NEW, name: '시험새교사', dept: '청년회', region: '02지역', isNew: true } });
  assert.equal(made.created, true); assert.equal(made.member.tier, '활동교사');
  assert.match((await a.saveRosterMember({ ...me, member: { memberId: NEW, name: '또', dept: '청년회', isNew: true } })).error, /이미 명단에 있는/);
  assert.equal((await a.checkAdmin({ memberId: NEW })).roster.name, '시험새교사');   // 로그인에 바로 반영

  // 찾기: 이름, 번호
  let found = (await a.searchRoster({ ...me, query: '시험새' })).rows;
  assert.equal(found.length, 1); assert.equal(found[0].inRoster, true); assert.equal(found[0].admin, null);
  assert.equal((await a.searchRoster({ ...me, query: '9000063' })).rows[0].memberId, NEW);
  assert.match((await a.searchRoster({ ...me, query: '시' })).hint, /두 글자/);

  // 고치기(이름·지역) — 등급은 그대로
  const edited = await a.saveRosterMember({ ...me, member: { memberId: NEW, name: '시험개명', dept: '청년회', region: '03지역' } });
  assert.deepEqual([edited.member.name, edited.member.region, edited.member.tier], ['시험개명', '03지역', '활동교사']);
  assert.equal((await a.saveRosterMember({ ...me, member: { memberId: NEW, name: '시험개명', dept: '청년회', region: '03지역' } })).unchanged, true);

  // 관리자 지정 → 수정 → 해제
  assert.match((await a.setAdminMember({ ...me, targetId: NEW, on: true, admin: {} })).error, /직책/);
  assert.equal((await a.setAdminMember({ ...me, targetId: NEW, on: true, admin: { position: '청년회복음방교관', region: '03지역' } })).created, true);
  assert.equal((await a.checkAdmin({ memberId: NEW })).isAdmin, true);
  found = (await a.searchRoster({ ...me, query: '시험개명' })).rows;
  assert.deepEqual([found[0].admin.position, found[0].admin.dept, found[0].admin.name], ['청년회복음방교관', '청년회', '시험개명']);
  assert.equal((await a.setAdminMember({ ...me, targetId: NEW, on: true, admin: { position: '청년회총교관' } })).admin.position, '청년회총교관');
  assert.match((await a.setAdminMember({ ...me, targetId: STAFF, on: false })).error, /스스로 해제/);
  assert.equal((await a.setAdminMember({ ...me, targetId: NEW, on: false })).ok, true);
  assert.equal((await a.checkAdmin({ memberId: NEW })).isAdmin, false);

  // 삭제
  assert.equal((await a.removeRosterMember({ ...me, targetId: NEW })).ok, true);
  assert.equal((await a.checkAdmin({ memberId: NEW })).roster, null);
  assert.match((await a.removeRosterMember({ ...me, targetId: NEW })).error, /찾을 수 없/);

  // 변경 기록: 최신이 위
  const log = (await a.getRosterLog(me)).rows.filter((c) => c.targetId === NEW);
  assert.deepEqual(log.map((c) => c.kind), ['교사 삭제', '관리자 해제', '관리자 수정', '관리자 지정', '교사 수정', '교사 추가']);
  assert.equal(log[4].before.name, '시험새교사'); assert.equal(log[4].after.name, '시험개명'); assert.equal(log[0].actor, '시험담당');
  console.log('쓰기 점검 통과');
} finally {
  await run(db().from('roster_changes').delete().in('target_id', [NEW, STAFF, PLAIN]));
  await run(db().from('admins').delete().in('member_id', [STAFF, PLAIN, NEW]));
  await run(db().from('teachers').delete().eq('member_id', NEW));
}
