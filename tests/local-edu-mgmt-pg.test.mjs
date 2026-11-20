// 교육 관리 — 부서 범위 공무 저장을 실제 PostgreSQL(격리 합성 DB)에서 검증한다. 운영 DB·Telegram·R2 연결 없음.
// 실행: EDU_MGMT_TEST_DB_URL=postgres://…@127.0.0.1:<port>/edu_mgmt_synth [EDU_MGMT_PG_MODULE=<pg 모듈 file URL>] node --experimental-test-module-mocks --test tests/local-edu-mgmt-pg.test.mjs
// 이 시험은 지정한 합성 DB 의 public 스키마를 지우고 기존 마이그레이션 + 제안 SQL 로 다시 만든다.
import { test, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { pgPool, rebuild, adapter } from './helpers/pg-supabase.mjs';

const URL_ = process.env.EDU_MGMT_TEST_DB_URL;
if (!URL_) { test('합성 DB 주소가 없어 건너뜀(미실행)', { skip: true }, () => {}); }
else {
for (const key of Object.keys(process.env)) if (/SUPABASE|TELEGRAM|GEMINI|R2_|ATT_|BOT_TOKEN/.test(key)) delete process.env[key];
globalThis.fetch = async () => { throw Error('외부 통신 차단'); };
const pool = await pgPool(URL_, 8), A = adapter(pool);
const run = async (q) => { const { data, error } = await q; if (error) throw new Error(error.message); return data; };
mock.module('../server/lib/db.js', { exports: { db: () => A, run, selectAll: async (b) => run(b().range(0, 9999)), isDuplicate: (e) => /duplicate key/i.test(String(e?.message || e)) } });
const GR = new Map();   // nid → grants(null = 책임자)
const permits = (grants, type, id, task) => grants === null || grants.some((g) => g.scope_type === type && g.scope_id === id && (task === 'view' ? g.permissions.length : g.permissions.includes(task)));
const { AccessError: AE } = await import('../server/lib/request-context.js');
mock.module('../server/lib/education-access.js', { exports: {
  EDUCATION_TASKS: {}, educationTasksForScope: () => ({}), permits,
  educationGrants: async (actor) => (GR.has(actor.nid) ? GR.get(actor.nid) : []),
  requireEducationOwner: () => { throw new AE('x'); }, requireEducationScope: async () => { throw new AE('x'); },
  meetingScope: async () => ['meeting', ''], requireMeetingTask: async () => { throw new AE('x'); }, protectCourses: (a) => a,
} });
const { withActor } = await import('../server/lib/request-context.js');
const mgmt = (await import('../server/actions/edu-mgmt.js')).default;
const excused = (await import('../server/actions/edu-excused.js')).default;
const { excusedOf } = await import('../server/lib/edu-attendance.js');

const OWNER = '9900000000900', MANAGER = '9900000000901', H1 = '9900000000911', H2 = '9900000000912', OTHER = '9900000000913';
const D = '2026-11-19', P = (n) => '99000000001' + String(n).padStart(2, '0');
const as = (nid, fn) => withActor({ nid, name: '가짜' + nid.slice(-3) }, fn);
const err = async (p) => { try { await p; } catch (e) { return e; } assert.fail('거절되어야 함'); };
const sql = (q, a) => pool.query(q, a);
const selected = async (kind = '목사교') => (await sql(`select ref_id from cohort_summary_log where cohort_id='#excused' and kind=$1 and date=$2 order by 1`, [kind, D])).rows.map((r) => r.ref_id);

before(async () => { await rebuild(pool, ['supabase/proposals/20261116120000_edu_mgmt_scoped_excused.sql']); });
after(async () => { await pool.end(); });
beforeEach(async () => {
  process.env.EDU_MGMT_ENABLED = '1';
  await sql(`truncate edu_roster, attend_series, attend_meetings, cohort_summary_log, admins, education_delegations, edu_excused_changes, edu_dept_heads, edu_excused_details, edu_excused_detail_log restart identity`);
  await sql(`insert into edu_roster(roster_key,member_id,name,dept,affiliation,district,position,sort_order) values
    ('목요사명자','${P(1)}','가짜일','24부서','가짜기획부','01','부장',1),('목요사명자','${P(2)}','가짜이','24부서','가짜기획부','01','차장',2),('목요사명자','${P(3)}','가짜삼','24부서','가짜기획부','01','담당',3),
    ('목요사명자','${P(4)}','가짜사','24부서','가짜행서부','02','부장',4),('목요사명자','${P(5)}','가짜오','24부서','가짜행서부','02','담당',5),
    ('목요사명자','${P(6)}','가짜육','장년회','','','구역장',6)`);
  await sql(`insert into attend_series(series_id,title,roster_key) values('RS1','가짜 목요 교육','목요사명자')`);
  await sql(`insert into attend_meetings(meeting_id,title,date,series_id) values('MT1','가짜 목요 교육','${D}','RS1')`);
  await sql(`insert into admins(member_id,name,dept) values('${MANAGER}','가짜관리','교육부')`);
  await sql(`insert into education_delegations(scope_type,scope_id,nid,permissions,actor_nid) values('series','RS1','${MANAGER}','{attendance}','${OWNER}')`);
  GR.clear(); GR.set(OWNER, null); GR.set(MANAGER, [{ scope_type: 'series', scope_id: 'RS1', permissions: ['attendance'] }]);
  await as(OWNER, () => mgmt.setEduDeptHead({ op: 'grant', memberId: H1, affiliation: '가짜기획부' }));
  await as(OWNER, () => mgmt.setEduDeptHead({ op: 'grant', memberId: H2, affiliation: '가짜행서부' }));
  // 기존 전체 화면에서 행서부 1명을 먼저 공무로 저장해 둔다.
  await sql(`insert into cohort_summary_log(cohort_id,kind,ref_id,date) values('#excused','목사교','${P(4)}','${D}')`);
});
const scope = (nid, aff) => as(nid, () => mgmt.getEduExcusedScope({ kind: '목사교', date: D, affiliation: aff }));
const save = (nid, s, changes) => as(nid, () => mgmt.applyEduExcusedScope({ kind: '목사교', date: D, affiliation: s.affiliation, revision: s.revision, changes }));

test('부서장은 자기 소속만 보고 저장하며 다른 부서의 기존 공무는 보존된다', async () => {
  const s = await scope(H1);
  assert.equal(s.affiliation, '가짜기획부'); assert.deepEqual(s.options, ['가짜기획부']); assert.equal(s.role, 'head');
  assert.deepEqual(s.people.map((p) => p.memberId), [P(1), P(2), P(3)]);
  await save(H1, s, [{ memberId: P(1), op: 'register', reason: '가짜 교회 행사', followMethod: '영상 시청' }, { memberId: P(2), op: 'register', reason: '가짜 출장' }]);
  assert.deepEqual(await selected(), [P(1), P(2), P(4)]);
  const again = await scope(H1);
  assert.equal(again.people.find((p) => p.memberId === P(1)).reason, '가짜 교회 행사');
  assert.equal(again.people.find((p) => p.memberId === P(1)).source, 'dept');
  assert.equal((await sql(`select count(*)::int n from edu_excused_changes`)).rows[0].n, 1, '기존 전체 이력에도 전후 명단이 남는다');
});

test('타 부서 조회·저장, 다른 소속 사람 끼워 넣기, 미지정 계정은 거절되고 아무것도 바뀌지 않는다', async () => {
  assert.equal((await err(scope(H1, '가짜행서부'))).status, 403);
  const s = await scope(H1);
  assert.equal((await err(save(H1, { ...s, affiliation: '가짜행서부' }, [{ memberId: P(5), op: 'register', reason: 'x' }]))).status, 403);
  assert.equal((await err(save(H1, s, [{ memberId: P(5), op: 'register', reason: 'x' }]))).status, 409);
  assert.equal((await err(scope(OTHER))).status, 403);
  assert.deepEqual(await selected(), [P(4)]);
});

test('두 부서가 동시에 저장해도 서로의 기록을 지우지 않는다', async () => {
  const [s1, s2] = await Promise.all([scope(H1), scope(H2)]);
  const r = await Promise.all([
    save(H1, s1, [{ memberId: P(1), op: 'register', reason: '가짜 사유1' }, { memberId: P(3), op: 'register', reason: '가짜 사유3' }]),
    save(H2, s2, [{ memberId: P(5), op: 'register', reason: '가짜 사유5' }, { memberId: P(4), op: 'cancel', reason: '가짜 취소' }]),
  ]);
  assert.ok(r.every((x) => x.ok));
  assert.deepEqual(await selected(), [P(1), P(3), P(5)]);
});

test('같은 부서의 오래된 화면 저장은 버전 충돌로 거절된다', async () => {
  const s = await scope(H1);
  await save(H1, s, [{ memberId: P(1), op: 'register', reason: '먼저' }]);
  const e = await err(save(H1, s, [{ memberId: P(2), op: 'register', reason: '나중' }]));
  assert.equal(e.status, 409);
  assert.deepEqual(await selected(), [P(1), P(4)]);
});

test('기존 전체 관리자 화면과 병행: 부서 저장 뒤 오래된 전체 저장은 거절, 다시 조회하면 부서 기록이 포함된다', async () => {
  const before = await as(MANAGER, () => excused.getEduExcused({ kind: '목사교', date: D }));
  const body = { kind: '목사교', date: D, revision: before.revision, people: [{ memberId: P(4) }, { memberId: P(5) }], reason: '가짜 전체 변경' };
  const pv = await as(MANAGER, () => excused.previewEduExcused(body));
  await save(H1, await scope(H1), [{ memberId: P(1), op: 'register', reason: '부서 등록' }]);
  const e = await err(as(MANAGER, () => excused.applyEduExcused({ ...body, review: pv.review, confirmed: true })));
  assert.equal(e.status, 409);
  assert.deepEqual(await selected(), [P(1), P(4)]);
  const fresh = await as(MANAGER, () => excused.getEduExcused({ kind: '목사교', date: D }));
  assert.deepEqual(fresh.people.filter((p) => p.on).map((p) => p.memberId), [P(1), P(4)]);
  // 전체 화면이 부서 등록자를 빼면 원본에서 빠지고, 부서 화면에는 '해제됨'으로 보이며 공무로 세지 않는다.
  const body2 = { kind: '목사교', date: D, revision: fresh.revision, people: [{ memberId: P(4) }], reason: '가짜 전체 정리' };
  const pv2 = await as(MANAGER, () => excused.previewEduExcused(body2));
  await as(MANAGER, () => excused.applyEduExcused({ ...body2, review: pv2.review, confirmed: true }));
  const s = await scope(H1);
  assert.equal(s.people.find((p) => p.memberId === P(1)).source, 'released');
  assert.equal(s.people.find((p) => p.memberId === P(1)).excused, false);
  assert.deepEqual([...(await excusedOf('목사교', D))], [P(4)]);
  // 교육 위임 관리자도 새 화면에서 어느 부서든 처리할 수 있다.
  const ms = await scope(MANAGER, '가짜행서부');
  assert.equal(ms.role, 'manager'); assert.deepEqual(ms.options, ['가짜기획부', '가짜행서부']);
  await save(MANAGER, ms, [{ memberId: P(5), op: 'register', reason: '관리자 등록' }]);
  assert.deepEqual(await selected(), [P(4), P(5)]);
});

test('수정·취소·교육 결과가 실행자와 함께 이력에 남고, 결과 입력은 공무 원본을 바꾸지 않는다', async () => {
  let s = await scope(H1);
  await save(H1, s, [{ memberId: P(1), op: 'register', reason: '처음 사유' }]);
  s = await scope(H1);
  await save(H1, s, [{ memberId: P(1), op: 'register', reason: '고친 사유', followMethod: '다음 주 보충' }]);
  s = await scope(H1);
  const p1 = s.people.find((p) => p.memberId === P(1));
  const before = await selected();
  await as(H1, () => mgmt.saveEduExcusedFollowup({ kind: '목사교', date: D, affiliation: '가짜기획부', memberId: P(1), version: p1.version, followMethod: '다음 주 보충', followResult: '보충 완료', followDone: true }));
  assert.deepEqual(await selected(), before, '교육 결과는 출석·공무 원본을 바꾸지 않는다');
  assert.equal((await err(as(H1, () => mgmt.saveEduExcusedFollowup({ kind: '목사교', date: D, affiliation: '가짜기획부', memberId: P(1), version: p1.version, followMethod: '', followResult: '덮어쓰기', followDone: false })))).status, 409);
  assert.equal((await err(as(H2, () => mgmt.saveEduExcusedFollowup({ kind: '목사교', date: D, affiliation: '가짜기획부', memberId: P(1), version: p1.version + 1, followMethod: '', followResult: 'x', followDone: false })))).status, 403);
  s = await scope(H1);
  await save(H1, s, [{ memberId: P(1), op: 'cancel', reason: '참석 가능해짐' }]);
  s = await scope(H1);
  assert.deepEqual(s.history.map((h) => h.action), ['cancel', 'followup', 'update', 'register']);
  assert.ok(s.history.every((h) => h.actorName === '가짜911' && h.actorRole === 'head'));
  assert.equal(s.history[0].cancelReason, '참석 가능해짐');
  assert.equal(s.history[1].followResult, '보충 완료');
  assert.equal(s.people.find((p) => p.memberId === P(1)).excused, false);
});

test('부서장 지정을 회수하면 열린 화면의 저장도 거절된다', async () => {
  const s = await scope(H1);
  await as(OWNER, () => mgmt.setEduDeptHead({ op: 'revoke', memberId: H1, affiliation: '가짜기획부' }));
  const e = await err(save(H1, s, [{ memberId: P(1), op: 'register', reason: 'x' }]));
  assert.ok([403, 409].includes(e.status));
  assert.deepEqual(await selected(), [P(4)]);
  assert.equal((await err(as(H1, () => mgmt.setEduDeptHead({ op: 'grant', memberId: H1, affiliation: '가짜기획부' })))).status, 403, '부서장 지정은 책임자만');
});

test('기능을 끄면 새 조회·저장은 멈추고, 이미 저장한 공무는 기존 보고·전체 화면에 그대로 남는다(A 복귀와 같은 상태)', async () => {
  const s = await scope(H1);
  await save(H1, s, [{ memberId: P(2), op: 'register', reason: '보존 확인' }]);
  delete process.env.EDU_MGMT_ENABLED;
  assert.deepEqual(await as(H1, () => mgmt.eduMgmtAccess()), { enabled: false });
  assert.equal((await err(scope(H1))).status, 503);
  assert.equal((await err(save(H1, s, [{ memberId: P(3), op: 'register', reason: 'x' }]))).status, 503);
  assert.deepEqual([...(await excusedOf('목사교', D))].sort(), [P(2), P(4)]);
  const full = await as(MANAGER, () => excused.getEduExcused({ kind: '목사교', date: D }));
  assert.deepEqual(full.people.filter((p) => p.on).map((p) => p.memberId), [P(2), P(4)]);
  assert.equal((await sql(`select count(*)::int n from edu_excused_details where active`)).rows[0].n, 1);
});
}
