// 교육 관리(화전단·목사교) A(app.html)·B(next-app) 표시·입력 계약이 같은지 — 같은 서버 응답으로 같은 칸·문구·변경 목록을 만든다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import * as B from '../next-app/lib/edu-mgmt.ts';
import * as BX from '../next-app/lib/edu-excused-self.ts';

const html = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
const block = html.slice(html.indexOf('/* EM-VIEW-START */'), html.indexOf('/* EM-VIEW-END */'));
const A = vm.runInNewContext(block + ';({EM_HEAD,EM_STATUS,EM_ACTION,EM_SOURCE,EM_THEME,EXL_GROUPS,exlGroups,emNextDate,emNextKind,exlPlaceText,exlSourceText,exlStatusText,exlCountsText,emCells,emPeopleGroups,emPersonText,emItemHead,emSessionsText,emDraft,emChanges,emChangeProblem,emHistoryText})');
const same = (a, b, msg) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);

const row = { key: '24부서', label: '24부서', n: 5, came: 3, onTime: 2, late: 1, excused: 1, absent: 1, rate: '60.0%' };
const item = { kind: '목사교', kindLabel: '목요사명자교육', meetingId: 'M1', title: '가짜 교육', date: '2026-11-19', sessions: ['오전', '저녁'], basis: 'full', basisLabel: '교육 대상 재적', scope: 'all', rows: [row], total: row };
const people = [
  { memberId: '1', name: '가짜일', sub: '가짜기획부', position: '', status: '지각', sessions: ['오전'], lateMin: [12] },
  { memberId: '2', name: '가짜이', sub: '가짜기획부', position: '', status: '공무', sessions: [], lateMin: [] },
  { memberId: '3', name: '가짜삼', sub: '', position: '', status: '참석', sessions: ['저녁'], lateMin: [] },
  { memberId: '4', name: '가짜사', sub: '3지역', position: '', status: '불참', sessions: [], lateMin: [] },
];
const scopePeople = [
  { memberId: '1', name: '가짜일', position: '부장', excused: true, source: 'dept', reason: '행사', followMethod: '영상', followResult: '', followDone: false, version: 2, updatedAt: null },
  { memberId: '2', name: '가짜이', position: '', excused: true, source: 'list', reason: '', followMethod: '', followResult: '', followDone: false, version: null, updatedAt: null },
  { memberId: '3', name: '가짜삼', position: '', excused: false, source: 'released', reason: '옛 사유', followMethod: '', followResult: '', followDone: false, version: 3, updatedAt: null },
  { memberId: '4', name: '가짜사', position: '', excused: false, source: '', reason: '', followMethod: '', followResult: '', followDone: false, version: null, updatedAt: null },
];

test('A·B 주간 표의 머리·칸·사람 묶음·문구가 같다', () => {
  same(A.EM_HEAD, B.EM_HEAD); same(A.EM_STATUS, B.EM_STATUS); same(A.EM_ACTION, B.EM_ACTION); same(A.EM_SOURCE, B.EM_SOURCE);
  same(A.emCells(row), B.emCells(row));
  assert.deepEqual(B.emCells(row), ['24부서', 5, 3, 2, 1, 1, 1, '60.0%']);
  same(A.emPeopleGroups(people), B.emPeopleGroups(people));
  assert.deepEqual(B.emPeopleGroups(people).map((g) => g.status), ['참석', '지각', '공무', '불참']);
  for (const p of people) assert.equal(A.emPersonText(p), B.emPersonText(p));
  assert.equal(B.emPersonText(people[0]), '가짜일(12분) · 가짜기획부');
  assert.equal(A.emItemHead(item), B.emItemHead(item));
  assert.equal(A.emSessionsText(item), B.emSessionsText(item));
  assert.equal(A.emSessionsText({ ...item, sessions: ['오전'] }), B.emSessionsText({ ...item, sessions: ['오전'] }));
});

test('A·B 공무 입력에서 같은 변경 목록·검사 문구를 만든다', () => {
  const drafts = (F) => Object.fromEntries(scopePeople.map((p) => [p.memberId, F.emDraft(p)]));
  const cases = [
    (d) => d,
    (d) => { d['4'].on = true; d['4'].reason = ' 출장 '; return d; },
    (d) => { d['4'].on = true; return d; },
    (d) => { d['1'].on = false; d['1'].cancelReason = '참석 가능'; return d; },
    (d) => { d['1'].reason = '행사(수정)'; d['2'].reason = '전체 명단 등록자 사유 보완'; d['3'].on = true; d['3'].reason = '다시 공무'; return d; },
    (d) => { d['4'].on = true; d['4'].reason = 'x'.repeat(301); return d; },
  ];
  for (const edit of cases) {
    const a = A.emChanges(scopePeople, edit(drafts(A))), b = B.emChanges(scopePeople, edit(drafts(B)));
    same(a, b); assert.equal(A.emChangeProblem(a), B.emChangeProblem(b));
  }
  assert.equal(B.emChangeProblem(B.emChanges(scopePeople, drafts(B))), '바뀐 내용이 없어요.');
  const d = drafts(B); d['2'].reason = '보완';
  assert.deepEqual(B.emChanges(scopePeople, d), [{ memberId: '2', op: 'register', reason: '보완', followMethod: '' }], '전체 명단 등록자에게 사유를 붙이면 등록(상세 추가)');
});

test('A·B 이력 문구가 같다', () => {
  const hist = [
    { id: 1, memberId: '1', name: '가짜일', action: 'register', actorName: '가짜장', actorRole: 'head', at: '2026-11-18T09:30:00+09:00', reason: '행사', cancelReason: '', followMethod: '', followResult: '', followDone: false },
    { id: 2, memberId: '1', name: '가짜일', action: 'followup', actorName: '가짜담당', actorRole: 'manager', at: '2026-11-20T10:00:00Z', reason: '행사', cancelReason: '', followMethod: '영상', followResult: '시청 완료', followDone: true },
    { id: 3, memberId: '1', name: '가짜일', action: 'cancel', actorName: '가짜장', actorRole: 'head', at: '2026-11-18T10:00:00Z', reason: '', cancelReason: '참석 가능', followMethod: '', followResult: '', followDone: false },
  ];
  for (const h of hist) assert.equal(A.emHistoryText(h), B.emHistoryText(h));
  assert.equal(B.emHistoryText(hist[1]), '2026-11-20 10:00 · 가짜담당(교육 담당) · 가짜일 교육 결과 — 영상 / 시청 완료 (완료)');
});

test('A·B 모두 관리자 "출석" 옆 "교육보고" 탭이고, 서버가 기능을 켜고 볼 권한을 줄 때만 보인다', () => {
  assert.match(html, /data-subtab="eduReport" onclick="adminSwitchSubTab\('eduReport'\)" style="display:none">공무결석현황<\/button>/);
  assert.match(html, /const ok = !!\(st\.access && st\.access\.enabled && st\.access\.visible\);\s*tab\.style\.display = ok \? '' : 'none';/);
  assert.match(html, /if \(isAdmin\(\)\) eduMgmt\.probe\(\);/);
  const tabs = [...html.matchAll(/data-subtab="(\w+)" onclick/g)].map((m) => m[1]);
  assert.deepEqual(tabs, ['dist', 'edu', 'connectAdmin', 'calAdmin', 'attend', 'eduReport', 'openfb', 'center', 'centerMgmt', 'rooms', 'cohort'], 'A: 출석 바로 다음');
  const frame = readFileSync(new URL('../next-app/components/presentation/ClassicAdminFrame.tsx', import.meta.url), 'utf8');
  const ids = [...frame.slice(frame.indexOf('const tabs='), frame.indexOf(';', frame.indexOf('const tabs='))).matchAll(/\['(\w+)','/g)].map((m) => m[1]);
  assert.deepEqual(ids.slice(ids.indexOf('attendance'), ids.indexOf('attendance') + 2), ['attendance', 'eduReport'], 'B: 출석 바로 다음');
  assert.match(frame, /id!=='eduReport'\|\|!!\(em\.data\?\.enabled&&em\.data\.visible\)/);
  const page = readFileSync(new URL('../next-app/app/(member)/admin/edu-report/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /em\.data\.enabled&&em\.data\.visible\?<EduMgmt/);
  const paths = readFileSync(new URL('../shared/pilot-paths.mjs', import.meta.url), 'utf8');
  assert.match(paths, /'\/admin\/edu-report'/, 'A/B 경로에 교육보고 포함');
  const edu = readFileSync(new URL('../next-app/components/education/Education.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(edu, /EduMgmt/, '교육 관리(과정) 화면은 원래대로');
});

test('A 화면 쓰기 요청은 자동 재시도 대상(get/list/check/search)이 아니다', () => {
  const read = /^(get|list|check|search)/;
  for (const w of ['applyEduExcusedScope', 'saveEduExcusedFollowup', 'setEduDeptHead', 'exportEduWeekly', 'eduMgmtAccess']) assert.ok(!read.test(w), w);
});

test('A·B 공무 본인 신고 카드 문구와 사람 표시(본인 신고 사유)가 같다', () => {
  const xb = html.slice(html.indexOf('/* EXS-VIEW-START */'), html.indexOf('/* EXS-VIEW-END */'));
  const AX = vm.runInNewContext(xb + ';({exsGroupText,exsLine,exsWindowText})');
  for (const k of ['화전단', '목사교', '기타']) assert.equal(AX.exsWindowText(k), BX.exsWindowText(k));
  assert.equal(BX.exsWindowText('화전단'), '⏰ 보고 가능시간 월 09:00 ~ 화 19:30'); assert.equal(BX.exsWindowText('목사교'), '⏰ 보고 가능시간 수 09:00 ~ 목 19:30');
  for (const d of [{ group: '장년회', region: '03지역' }, { group: '교역자', region: '' }]) assert.equal(AX.exsGroupText(d), BX.exsGroupText(d));
  for (const x of [{ date: 'd', label: 'l' }, { date: 'd', label: 'l', mine: { reason: '공무' } }, { date: 'd', label: 'l', mine: { reason: '병원' } }]) assert.equal(AX.exsLine(x), BX.exsLine(x));
  assert.equal(BX.exsLine({ date: 'd', label: 'l', mine: { reason: '병원' } }), '✅ 공무 결석 신고됨 · 병원');
  const p = { memberId: '7', name: '가짜칠', sub: '3지역', position: '', status: '공무', sessions: [], lateMin: [], selfReason: '병원' };
  assert.equal(A.emPersonText(p), B.emPersonText(p)); assert.equal(B.emPersonText(p), '가짜칠 · 3지역 · 본인 신고: 병원');
  assert.match(html, /const ACT_PAGES = \[\['targets', '내 활동 보고'\], \['rooms', '피드백방'\], \['attend', '공무 결석 보고'\]\];/, 'A: 내 활동 보고 · 피드백방 · 공무 결석 보고');
  assert.match(html, /<div data-ap="attend">\$\{excusedSelfPageHtml\(\)\}<\/div>/);
  const hdr = readFileSync(new URL('../next-app/components/presentation/ClassroomHeader.tsx', import.meta.url), 'utf8');
  assert.deepEqual([...hdr.matchAll(/>([^<>{}]+)<\/button>/g)].map((m) => m[1]), ['내 활동 보고', '피드백방', '공무 결석 보고'], 'B: 같은 순서');
  const act = readFileSync(new URL('../next-app/components/activities/Activities.tsx', import.meta.url), 'utf8');
  assert.match(act, /params\.get\('view'\)==='attend'\)return <section id="sec-activity"><ClassroomHeader attend\/><ExcusedSelfCard\/>/);
});

test('A·B 공무자 관리 줄 문구와 두 교육 테마가 같다', () => {
  same(A.EM_THEME, B.EM_THEME);
  assert.deepEqual(Object.values(B.EM_THEME).map((t) => t.title), ['화요 전도단', '목요 사명자 교육', '금요 교사 교육']);
  const rows = [
    { memberId: '1', name: '가', group: '교역자', place: '신학', source: '본인 신고', registeredBy: '', reason: '수업', attended: false },
    { memberId: '2', name: '나', group: '24부서', place: '기획부', source: '도우미연결 명단', registeredBy: '', reason: '', attended: true },
    { memberId: '3', name: '다', group: '장년회', place: '', source: '관리자 등록', registeredBy: '관리', reason: '병원', attended: null }];
  for (const r of rows) { assert.equal(A.exlPlaceText(r), B.exlPlaceText(r)); assert.equal(A.exlSourceText(r), B.exlSourceText(r)); assert.equal(A.exlStatusText(r), B.exlStatusText(r)); }
  const L = { counts: { total: 3, self: 1, admin: 1, list: 1, attended: 1 }, meeting: { title: 't', date: 'd' } };
  assert.equal(A.exlCountsText(L), B.exlCountsText(L)); assert.equal(A.exlCountsText({ ...L, meeting: null }), B.exlCountsText({ ...L, meeting: null }));
  assert.match(html, /const tabs = \[\['list', '공무자 관리'\], \['week', '주간 출석 현황'\]\];/);
  const em = readFileSync(new URL('../next-app/components/education/EduMgmt.tsx', import.meta.url), 'utf8');
  assert.match(em, /\[\['list','공무자 관리'\],\['week','주간 출석 현황'\]\]/);
});

test('A·B 공무자 명단을 교자장부청·24부서로 같게 묶고, 가까운 교육 날짜를 같게 고른다', () => {
  same(A.EXL_GROUPS, B.EXL_GROUPS);
  assert.deepEqual(B.EXL_GROUPS.map((g) => g[1]), ['교', '자', '장', '부', '청', '24부서']);
  const rows = ['장년회', '교역자', '24부서', '부녀회', '청년회', '장로·자문회', '장년회', '협력'].map((group, i) => ({ memberId: String(i), name: 'n' + i, group, place: '', source: '본인 신고', registeredBy: '', reason: '', attended: null }));
  same(A.exlGroups(rows), B.exlGroups(rows));
  assert.deepEqual(B.exlGroups(rows).map((g) => [g.key, g.rows.length]), [['교역자', 1], ['장로·자문회', 1], ['장년회', 2], ['부녀회', 1], ['청년회', 1], ['24부서', 1], ['기타', 1]]);
  for (const today of ['2026-11-16', '2026-11-17', '2026-11-19', '2026-11-20', '2026-11-22'])
    for (const kind of ['화전단', '목사교']) assert.equal(A.emNextDate(kind, today), B.emNextDate(kind, today), kind + today);
  assert.equal(B.emNextDate('화전단', '2026-11-18'), '2026-11-24'); assert.equal(B.emNextDate('목사교', '2026-11-19'), '2026-11-19');
  for (const today of ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-22']) assert.equal(A.emNextKind(today), B.emNextKind(today), today);
  assert.deepEqual(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-20'].map(B.emNextKind), ['화전단', '화전단', '목사교', '금요교사']);
});
