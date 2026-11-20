// 교육 관리(화전단·목사교) 주간 현황 — 가짜 DB·가짜 출석으로 계산 기준과 권한 범위를 검사한다. 외부 통신 없음.
import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as fake from './helpers/fake-db.mjs';
for (const key of Object.keys(process.env)) if (/SUPABASE|TEACHERSQUARE|GEMINI|TELEGRAM|R2_|ATT_|BOT_TOKEN|VERCEL|EDU_MGMT/.test(key)) delete process.env[key];
globalThis.fetch = async () => { throw Error('외부 통신 차단'); };
mock.module('../server/lib/db.js', { exports: { db: fake.db, run: fake.run, selectAll: fake.selectAll, isDuplicate: fake.isDuplicate } });
const GR = new Map();
const permits = (grants, type, id, task) => grants === null || grants.some((g) => g.scope_type === type && g.scope_id === id && (task === 'view' ? g.permissions.length : g.permissions.includes(task)));
const { AccessError: AE, withActor } = await import('../server/lib/request-context.js');
mock.module('../server/lib/education-access.js', { exports: {
  EDUCATION_TASKS: {}, educationTasksForScope: () => ({}), permits,
  educationGrants: async (actor) => (GR.has(actor.nid) ? GR.get(actor.nid) : []),
  requireEducationOwner: () => { throw new AE('x'); }, requireEducationScope: async () => { throw new AE('x'); },
  meetingScope: async () => ['meeting', ''], requireMeetingTask: async () => { throw new AE('x'); }, protectCourses: (a) => a,
} });
const ATT = {};   // meetingId → [[nid, session, late]]
const closingCalls = [];
import { readFileSync } from 'node:fs';
// 출석 마감 모듈은 출석 원본(closingData)만 가짜로 바꾸고, 나머지 이름은 호출되면 실패하게 둔다.
const closingNames = [...readFileSync(new URL('../server/actions/attendance-closing.js', import.meta.url), 'utf8').matchAll(/export (?:async )?(?:function|const|let) (\w+)/g)].map((m) => m[1]);
mock.module('../server/actions/attendance-closing.js', { exports: {
  ...Object.fromEntries(closingNames.map((k) => [k, () => { throw Error('사용하지 않는 가짜 ' + k); }])), default: {},
  closingData: async (m) => { closingCalls.push(m.meetingId); return { rows: (ATT[m.meetingId] || []).map(([id, session, late], i) => ({ no: i + 1, id, name: '가짜' + id.slice(-2), session, late, meetingId: m.meetingId, dup: false })) }; },
} });
const mgmt = (await import('../server/actions/edu-mgmt.js')).default;
const OWNER = '9900000000900', MANAGER = '9900000000901', HEAD = '9900000000911', NOBODY = '9900000000913';
const n = (x) => '99000000001' + String(x).padStart(2, '0');
const as = (nid, fn) => withActor({ nid, name: '가짜' + nid.slice(-3) }, fn);
const err = async (p) => { try { await p; } catch (e) { return e; } assert.fail('거절되어야 함'); };
const roster = (no, name, dept, aff, district, position = '', region = '') => ({ id: no, roster_key: '목요사명자', member_id: n(no), nid: n(no), name, dept, region, district, affiliation: aff, position, sort_order: no });

beforeEach(() => {
  process.env.EDU_MGMT_ENABLED = '1';
  fake.reset({
    attend_series: [{ id: 1, series_id: 'RS1', title: '가짜 목요 교육', roster_key: '목요사명자', summary_to: 'test', status: '열림' }],
    attend_meetings: [
      { id: 1, meeting_id: 'MTHU', title: '가짜 목요 교육', date: '2026-11-19', series_id: 'RS1', cohort_id: '', status: '열림', slots: [{ start: '10:00', end: '12:00' }, { start: '19:30', end: '21:00' }] },
      { id: 2, meeting_id: 'MTUE', title: '가짜 화요전도단', date: '2026-11-17', series_id: '', cohort_id: '', status: '열림', slots: [] },
      { id: 3, meeting_id: 'MTST', title: '[TEST] 가짜 화요전도단', date: '2026-11-17', series_id: '', cohort_id: '', status: '열림' },
      { id: 4, meeting_id: 'MNXT', title: '가짜 화요전도단', date: '2026-11-24', series_id: '', cohort_id: '', status: '열림' },
    ],
    edu_roster: [roster(1, '가짜일', '24부서', '가짜기획부', '01'), roster(2, '가짜이', '24부서', '가짜기획부', '01'), roster(3, '가짜삼', '24부서', '가짜기획부', '01'),
      roster(4, '가짜사', '24부서', '가짜행서부', '02'), roster(5, '가짜오', '24부서', '가짜행서부', '02'),
      roster(6, '가짜육', '장년회', '', '', '구역장', '03지역'), roster(7, '가짜칠', '장년회', '', '', '구역장', '03지역'),
      roster(8, '가짜팔', '교회교역', '', '', '전도사'), roster(9, '가짜구', '교회교역', '', '', '원장')],
    edu_roster_policy: [{ roster_key: '목요사명자', excluded_positions: ['원장'], always_present_nids: [], dept_overrides: {} }],
    cohort_summary_log: [{ id: 1, cohort_id: '#excused', kind: '목사교', ref_id: n(3), date: '2026-11-19' }, { id: 2, cohort_id: '#excused', kind: '목사교', ref_id: n(4), date: '2026-11-19' },
      { id: 3, cohort_id: '#excused', kind: '화전단', ref_id: n(2), date: '2026-11-17' }],
    edu_dept_heads: [{ id: 1, nid: HEAD, affiliation: '가짜행서부', revoked: false }],
    edu_excused_self: [],
  });
  Object.assign(ATT, {
    MTHU: [[n(1), '오전', '정상 출석'], [n(1), '저녁', '정상 출석'], [n(2), '오전', '12분 지각'], [n(3), '오전', '정상 출석'], [n(6), '저녁', '정상 출석'], [n(8), '오전', '정상 출석'], ['9900000000199', '오전', '정상 출석']],
    MTUE: [[n(1), '오전', '정상 출석']],
  });
  GR.clear(); GR.set(OWNER, null); GR.set(MANAGER, [{ scope_type: 'series', scope_id: 'RS1', permissions: ['reports'] }]);
});
const pick = (rows, label) => rows.find((r) => r.label === label);
const four = (r) => r.onTime + r.late + r.excused + r.absent;

test('주간 요약: 오전·저녁 중복 1명, 지각은 참석의 일부, 실제 참석이 공무보다 우선, 공무는 분모에 포함', async () => {
  const w = await as(OWNER, () => mgmt.getEduWeekly({ date: '2026-11-18' }));
  assert.deepEqual(w.week, { from: '2026-11-16', to: '2026-11-22' });
  assert.deepEqual(w.items.map((i) => i.meetingId), ['MTUE', 'MTHU'], '[TEST]·다음 주 모임은 빠진다');
  const thu = w.items[1];
  assert.equal(thu.basis, 'full'); assert.deepEqual(thu.sessions, ['오전', '저녁']);
  assert.deepEqual({ n: thu.total.n, came: thu.total.came, onTime: thu.total.onTime, late: thu.total.late, excused: thu.total.excused, absent: thu.total.absent, rate: thu.total.rate },
    { n: 8, came: 5, onTime: 4, late: 1, excused: 1, absent: 2, rate: '62.5%' }, '원장 제외 8명, 재적 밖 참석자는 세지 않음');
  assert.equal(four(thu.total), thu.total.n);
  assert.deepEqual(thu.total.by, { 오전: 4, 저녁: 2 });
  assert.deepEqual(thu.rows.map((r) => r.label), ['교회 교역자', '24부서', '장년회'], '기존 카드 순서, 재적 없는 조직은 생략');
  const d24 = pick(thu.rows, '24부서');
  assert.deepEqual([d24.n, d24.came, d24.late, d24.excused, d24.absent, d24.rate], [5, 3, 1, 1, 1, '60.0%']);
  const tue = w.items[0];
  assert.equal(tue.basis, '24'); assert.match(tue.basisLabel, /확인 필요/);
  assert.deepEqual(tue.rows.map((r) => [r.label, r.n, r.came, r.excused, r.absent]), [['가짜기획부', 3, 1, 1, 1], ['가짜행서부', 2, 0, 0, 2]]);
  for (const it of w.items) for (const r of [...it.rows, it.total]) assert.equal(four(r), r.n);
});

test('조직 상세: 24부서는 소속별, 장년회는 지역별, 사람별 상태와 지각 분', async () => {
  const d = await as(MANAGER, () => mgmt.getEduWeeklyDetail({ date: '2026-11-19', meetingId: 'MTHU', group: '24부서' }));
  assert.deepEqual(d.rows.map((r) => [r.label, r.n, r.came, r.late, r.excused, r.absent]), [['가짜기획부', 3, 3, 1, 0, 0], ['가짜행서부', 2, 0, 0, 1, 1]]);
  assert.deepEqual(d.people.map((p) => [p.name, p.status, p.lateMin]), [['가짜일', '참석', []], ['가짜이', '지각', [12]], ['가짜삼', '참석', []], ['가짜사', '공무', []], ['가짜오', '불참', []]]);
  const j = await as(MANAGER, () => mgmt.getEduWeeklyDetail({ date: '2026-11-19', meetingId: 'MTHU', group: '장년회' }));
  assert.deepEqual(j.rows.map((r) => r.label), ['3지역']);
});

test('부서장은 두 교육 모두 자기 소속 줄만 보고 다른 조직 상세는 거절된다', async () => {
  const w = await as(HEAD, () => mgmt.getEduWeekly({ date: '2026-11-19' }));
  assert.deepEqual(w.items.map((i) => [i.meetingId, i.scope, i.rows.map((r) => r.label), i.total.n]), [['MTUE', 'dept', ['가짜행서부'], 2], ['MTHU', 'dept', ['가짜행서부'], 2]]);
  assert.equal((await err(as(HEAD, () => mgmt.getEduWeeklyDetail({ date: '2026-11-19', meetingId: 'MTHU', group: '교회 교역자' })))).status, 403);
  assert.equal((await err(as(HEAD, () => mgmt.getEduWeeklyDetail({ date: '2026-11-19', meetingId: 'MTHU', group: '24부서/가짜기획부' })))).status, 403);
  const own = await as(HEAD, () => mgmt.getEduWeeklyDetail({ date: '2026-11-19', meetingId: 'MTHU', group: '24부서/가짜행서부' }));
  assert.deepEqual(own.people.map((p) => p.status), ['공무', '불참']);
  const none = await as(NOBODY, () => mgmt.getEduWeekly({ date: '2026-11-19' }));
  assert.deepEqual(none.items, [], '권한 없는 계정에는 숫자도 주지 않는다');
  assert.equal((await as(NOBODY, () => mgmt.eduMgmtAccess())).visible, false);
  assert.equal((await as(HEAD, () => mgmt.eduMgmtAccess())).visible, true);
});

test('요약 CSV는 화면과 같은 숫자를 담고 개인 이름은 넣지 않는다', async () => {
  const w = await as(OWNER, () => mgmt.getEduWeekly({ date: '2026-11-19' }));
  const csv = await as(OWNER, () => mgmt.exportEduWeekly({ date: '2026-11-19' }));
  assert.equal(csv.filename, '주간교육출석_2026-11-16.csv');
  const lines = csv.text.replace(/^﻿/, '').trim().split('\n').slice(2);
  assert.equal(lines.length, w.items.reduce((s, i) => s + i.rows.length + 1, 0));
  assert.ok(lines.includes('목요사명자교육,2026-11-19,가짜 목요 교육,교육 대상 재적,종합,8,5,4,1,1,2,62.5%'));
  assert.ok(!/가짜일|가짜이/.test(csv.text));
  // 11/17(사용자): 내려받기는 김논 서무님·책임자만 — 다른 관리자는 거절, 화면 단추도 숨김
  await assert.rejects(as(MANAGER, () => mgmt.exportEduWeekly({ date: '2026-11-19' })), /김논/);
  assert.equal((await as(MANAGER, () => mgmt.eduMgmtAccess())).canDownload, false);
  assert.equal((await as(OWNER, () => mgmt.eduMgmtAccess())).canDownload, true);
});

test('기능이 꺼져 있으면 화면 진입도 숨기고 조회·내보내기·저장·지정 모두 멈추며 DB를 읽지 않는다', async () => {
  delete process.env.EDU_MGMT_ENABLED;
  fake.calls.length = 0; closingCalls.length = 0;
  assert.deepEqual(await as(OWNER, () => mgmt.eduMgmtAccess()), { enabled: false });
  for (const [name, body] of [['getEduWeekly', { date: '2026-11-19' }], ['getEduWeeklyDetail', {}], ['exportEduWeekly', {}], ['getEduExcusedScope', {}], ['applyEduExcusedScope', {}], ['saveEduExcusedFollowup', {}], ['listEduDeptHeads', {}], ['setEduDeptHead', {}]])
    assert.equal((await err(as(OWNER, () => mgmt[name](body)))).status, 503, name);
  assert.equal(fake.calls.length, 0); assert.equal(closingCalls.length, 0);
});

test('로그인하지 않은 요청과 잘못된 날짜는 거절된다', async () => {
  assert.equal((await err(mgmt.getEduWeekly({ date: '2026-11-19' }))).status, 401);
  assert.equal((await err(as(OWNER, () => mgmt.getEduWeekly({ date: '2026-02-30' })))).status, 400);
});

// ── 공무 본인 신고(11/16) ──
const self = (await import('../server/actions/edu-excused-self.js')).default;
const nextThu = () => { const { kstDate } = { kstDate: () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10) }; let d = kstDate(); while (new Date(d + 'T00:00:00Z').getUTCDay() !== 4) d = new Date(Date.parse(d + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10); return d; };
test('본인 신고: 로그인한 장년회 사명자는 바로 눌러 신고되고 소속이 재적에서 자동 기록되며, 취소도 기록을 남긴다', async () => {
  fake.rows.edu_excused_self = [];
  fake.rows.attend_series[0].weekdays = [4];
  const me = await as(n(6), () => self.getMyExcused({}));
  assert.equal(me.eligible, true); assert.equal(me.group, '장년회'); assert.equal(me.region, '03지역');
  assert.deepEqual(me.kinds.map((k) => [k.kind, k.title, k.dates.length]), [['화전단', '화요 전도단', 2], ['목사교', '목요 사명자 교육', 2]]);
  const thu = me.kinds[1].dates; assert.equal(thu[0].date, nextThu()); assert.equal(thu[0].mine, undefined);
  assert.ok(me.kinds[0].dates.every((x) => new Date(x.date + 'T00:00:00Z').getUTCDay() === 2), '화요전도단 = 화요일');
  const r = await as(n(6), () => self.submitMyExcused({ kind: '목사교', date: nextThu() }));
  assert.match((await err(as(n(6), () => self.submitMyExcused({ kind: '화전단', date: nextThu() })))).message, /다가오는/, '화요전도단에 목요일 날짜는 거절');
  assert.equal(r.ok, true);
  assert.deepEqual(fake.rows.edu_excused_self.map((x) => [x.nid, x.dept, x.region, x.reason, x.active]), [[n(6), '장년회', '03지역', '공무', true]], '사유를 비우면 공무, 소속은 서버가 채움');
  await as(n(6), () => self.submitMyExcused({ kind: '목사교', date: nextThu(), reason: '가짜 출장', memberId: n(7) }));
  assert.equal(fake.rows.edu_excused_self.length, 1, '본문의 다른 번호는 무시하고 본인 것만 고친다');
  assert.equal(fake.rows.edu_excused_self[0].reason, '가짜 출장');
  await as(n(6), () => self.cancelMyExcused({ kind: '목사교', date: nextThu() }));
  assert.equal(fake.rows.edu_excused_self[0].active, false);
});
test('본인 신고: 24부서 사명자도 같은 카드(소속 부서 기록), 원장·재적 밖·로그인 없음·지난 날짜·기능 꺼짐은 거절', async () => {
  fake.rows.edu_excused_self = [];
  const m24 = await as(n(1), () => self.getMyExcused({}));
  assert.equal(m24.eligible, true); assert.equal(m24.group, '24부서 가짜기획부');
  await as(n(1), () => self.submitMyExcused({ kind: '목사교', date: nextThu() }));
  assert.deepEqual(fake.rows.edu_excused_self.map((x) => [x.dept, x.region]), [['24부서', '가짜기획부']]);
  fake.rows.edu_excused_self = [];
  assert.equal((await as(n(9), () => self.getMyExcused({}))).eligible, false, '원장은 집계 제외라 카드 없음');
  assert.match((await err(as(n(9), () => self.submitMyExcused({ kind: '목사교', date: nextThu() })))).message, /원장/);
  assert.match((await err(as(NOBODY, () => self.submitMyExcused({ date: nextThu() })))).message, /재적에 없어요/);
  assert.equal((await err(self.submitMyExcused({ date: nextThu() }))).status, 401);
  assert.match((await err(as(n(6), () => self.submitMyExcused({ date: '2026-01-01' })))).message, /다가오는/);
  delete process.env.EDU_MGMT_ENABLED;
  assert.deepEqual(await as(n(6), () => self.getMyExcused({})), { enabled: false });
  assert.equal((await err(as(n(6), () => self.submitMyExcused({ date: nextThu() })))).status, 503);
  assert.equal(fake.rows.edu_excused_self.length, 0);
});
test('본인 신고는 관리자 명단과 합쳐 공무로 세고(실제 참석 우선), 상세에 사유를 붙인다', async () => {
  fake.rows.edu_excused_self = [{ id: 1, kind: '목사교', date: '2026-11-19', nid: n(7), name: '가짜칠', dept: '장년회', region: '03지역', reason: '가짜 병원', active: true },
    { id: 2, kind: '목사교', date: '2026-11-19', nid: n(6), name: '가짜육', dept: '장년회', region: '03지역', reason: '왔지만 신고', active: true },
    { id: 3, kind: '목사교', date: '2026-11-19', nid: n(5), name: '가짜오', dept: '24부서', region: '', reason: '취소됨', active: false }];
  const w = await as(OWNER, () => mgmt.getEduWeekly({ date: '2026-11-19' }));
  const thu = w.items.find((i) => i.meetingId === 'MTHU');
  assert.deepEqual([thu.total.came, thu.total.excused, thu.total.absent], [5, 2, 1], '장년 가짜칠 공무 추가, 참석한 가짜육은 참석, 취소된 신고는 무시');
  const d = await as(OWNER, () => mgmt.getEduWeeklyDetail({ date: '2026-11-19', meetingId: 'MTHU', group: '장년회' }));
  assert.deepEqual(d.people.map((p) => [p.name, p.status, p.selfReason || '']), [['가짜육', '참석', ''], ['가짜칠', '공무', '가짜 병원']]);
});

// ── 공무자 관리(11/16 4차) ──
test('공무자 관리: 본인 신고·관리자 등록·도우미연결 명단을 한 목록으로, 그날 출석 여부와 함께(관리자만)', async () => {
  fake.rows.edu_excused_self = [
    { id: 1, kind: '목사교', date: '2026-11-19', nid: n(7), name: '가짜칠', dept: '장년회', region: '03지역', reason: '가짜 병원', active: true, registered_by: '' },
    { id: 2, kind: '목사교', date: '2026-11-19', nid: n(8), name: '가짜팔', dept: '교회교역', region: '', reason: '가짜 대신', active: true, registered_by: '가짜관리' },
    { id: 3, kind: '목사교', date: '2026-11-19', nid: n(6), name: '가짜육', dept: '장년회', region: '03지역', reason: '취소됨', active: false, registered_by: '' }];
  const L = await as(MANAGER, () => mgmt.getExcusedList({ kind: '목사교', date: '2026-11-19' }));
  assert.deepEqual(L.rows.map((r) => [r.name, r.group, r.source, r.attended]),
    [['가짜팔', '교역자', '관리자 등록', true], ['가짜삼', '24부서', '도우미연결 명단', true], ['가짜사', '24부서', '도우미연결 명단', false], ['가짜칠', '장년회', '본인 신고', false]]);
  assert.deepEqual(L.counts, { total: 4, self: 1, admin: 1, list: 2, attended: 2 });
  assert.equal((await err(as(HEAD, () => mgmt.getExcusedList({ kind: '목사교', date: '2026-11-19' })))).status, 403, '관리자가 아니면 거절');
});
test('공무자 관리: 대신 등록은 등록자를 남기고, 해제는 본인 신고는 비활성·도우미연결은 그 한 줄만 지운다', async () => {
  fake.rows.edu_excused_self = [];
  const r = await as(MANAGER, () => mgmt.adminSetExcused({ kind: '목사교', date: '2026-11-19', memberId: n(7), reason: '' }));
  assert.equal(r.name, '가짜칠');
  assert.deepEqual(fake.rows.edu_excused_self.map((x) => [x.nid, x.reason, x.registered_by, x.region]), [[n(7), '공무', '가짜901', '03지역']]);
  assert.match((await err(as(MANAGER, () => mgmt.adminSetExcused({ kind: '목사교', date: '2026-11-19', memberId: n(9) })))).message, /원장/);
  await as(MANAGER, () => mgmt.adminCancelExcused({ kind: '목사교', date: '2026-11-19', memberId: n(7) }));
  assert.deepEqual(fake.rows.edu_excused_self.map((x) => [x.active, x.canceled_by]), [[false, '가짜901']]);
  const before = fake.rows.cohort_summary_log.length;
  await as(MANAGER, () => mgmt.adminCancelExcused({ kind: '목사교', date: '2026-11-19', memberId: n(4) }));
  assert.equal(fake.rows.cohort_summary_log.length, before - 1);
  assert.ok(fake.rows.cohort_summary_log.some((x) => x.ref_id === n(3) && x.kind === '목사교'), '다른 사람 줄은 그대로');
  assert.equal((await err(as(MANAGER, () => mgmt.adminCancelExcused({ kind: '목사교', date: '2026-11-19', memberId: n(4) })))).status, 409);
  const hits = await as(MANAGER, () => mgmt.searchEduRosterForExcused({ q: '가짜' }));
  assert.ok(!hits.rows.some((h) => h.name === '가짜구'), '원장은 찾기에서 빠짐');
});
