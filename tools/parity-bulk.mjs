// 옛 서버 응답과 새 코드(이 PC에서 직접 실행, DB 는 Supabase)를 여러 건 한꺼번에 비교한다.
// 읽기 전용 요청만 다룬다.
//   node --env-file=.env tools/parity-bulk.mjs <묶음이름>
import { isDeepStrictEqual } from 'node:util';
import { db, selectAll } from '../server/lib/db.js';
import { actions } from '../server/registry.js';

const LEGACY = process.env.LEGACY_URL;

async function legacy(payload) {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(LEGACY, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload), redirect: 'follow',
      });
      return JSON.parse(await r.text());
    } catch (e) {
      if (attempt >= 3) throw e;   // Apps Script 가 가끔 HTML 오류를 돌려준다 — 몇 번 다시 시도
    }
  }
}

function firstDiff(a, b, path = '') {
  if (isDeepStrictEqual(a, b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = firstDiff(a[k], b[k], `${path}/${k}`);
      if (d) return d;
    }
  }
  return `${path || '/'}: 옛=${JSON.stringify(a)?.slice(0, 90)} 새=${JSON.stringify(b)?.slice(0, 90)}`;
}

const distinct = async (table, column) =>
  [...new Set((await selectAll(() => db().from(table).select(column).order('id'))).map((r) => r[column]).filter(Boolean))];

/** 묶음별 비교 대상 요청 목록. */
const suites = {
  async activities() {
    const members = await distinct('activities', 'member_id');
    const targets = await selectAll(() => db().from('targets').select('target_id, creator_id').order('id'));
    const owners = [...new Set(targets.map((t) => t.creator_id))];
    return [
      { action: 'getAllActivities' },
      ...members.map((memberId) => ({ action: 'getMyActivities', memberId })),
      ...[...new Set([...members, ...owners])].flatMap((memberId) => [
        { action: 'getTargets', memberId },
        { action: 'getMyEncouragements', memberId },
        { action: 'getMyGospelLeads', memberId },
      ]),
      ...targets.map((t) => ({ action: 'getTargetJournal', memberId: t.creator_id, targetId: t.target_id })),
    ];
  },
  async tiers() {
    const members = await distinct('activities', 'member_id');
    const leadMembers = await distinct('center_leads', 'member_id');
    const teachers = await selectAll(() => db().from('teachers').select('member_id, name, position, dept, region').order('sort_order'));
    const leaders = teachers.filter((t) => t.position.includes('지역장')).slice(0, 3);
    const everyNth = teachers.filter((_, i) => i % 250 === 0);
    const depts = ['교역자', '자문회', '장년회', '부녀회', '청년회', '기타'];
    return [
      { action: 'checkTierChanges' },
      { action: 'checkTierChanges', asOf: '2026-09-30' },
      { action: 'checkTierChanges', year: 2026, month: 8 },
      { action: 'getSettlementReport' },
      { action: 'getSettlementReport', asOf: '2026-09-30' },
      { action: 'getOrgSummary' },
      { action: 'getChurchTopRegions' },
      { action: 'getAllCenterLeads' },
      { action: 'applyTierChange', memberId: 'x', newTier: '정교사' },
      { action: 'approveTierChange', memberId: 'x' },
      ...depts.map((dept) => ({ action: 'getDistrictReport', dept })),
      { action: 'getDistrictReport', dept: '부녀회', region: '11지역' },
      { action: 'getDistrictReport', dept: '없는부서' },
      ...depts.slice(0, 5).flatMap((dept) => [
        { action: 'getTopRegions', dept },
        { action: 'getTopRegions', dept, aspect: '상담' },
        { action: 'getTopRegions', dept, role: '인도자' },
      ]),
      ...[...leaders, ...everyNth.slice(0, 2)].map((t) => ({ action: 'getDistrictView', memberId: t.member_id, name: t.name })),
      { action: 'getDistrictView', memberId: everyNth[0].member_id, name: '틀린이름' },
      ...[...new Set([...members, ...leadMembers, ...everyNth.map((t) => t.member_id)])]
        .map((memberId) => ({ action: 'getMyTierStatus', memberId })),
      ...[...leadMembers, everyNth[1].member_id].map((memberId) => ({ action: 'getMyCenterLeads', memberId })),
    ];
  },
  async misc() {
    const chats = await selectAll(() => db().from('chat_messages').select('chat_id, from_id, to_id').order('id'));
    const chatters = [...new Set(chats.flatMap((c) => [c.from_id, c.to_id]))];
    const feedbackMembers = (await distinct('feedbacks', 'member_id')).slice(0, 12);
    const eduMembers = await distinct('required_education', 'member_id');
    return [
      { action: 'getCourseList' },
      ...['복음방', '상담', '밭갈기', '없는분류'].map((category) => ({ action: 'getCourseList', category })),
      { action: 'getRequiredEducationLog' },
      ...[...eduMembers, '00230901-00011', ''].map((memberId) => ({ action: 'getRequiredEducation', memberId })),
      { action: 'getAllFeedback' },
      ...feedbackMembers.flatMap((memberId) => [{ action: 'getHistory', memberId }, { action: 'getMyCoachRequests', memberId }]),
      ...[...new Set(chats.map((c) => c.chat_id))].map((chatId) => ({ action: 'getMessages', chatId })),
      ...chatters.flatMap((memberId) => [{ action: 'getChatList', memberId }, { action: 'getConnectUnread', memberId }]),
      { action: 'getConnectStats' },
      { action: 'getKeyStageCount' },
      ...['', '인도자', '교사', '섬김이', '협력', '협력교사', '없는역할'].map((role) => ({ action: 'getTargetStageDistribution', role })),
      { action: 'getTeacherListReport' },
    ];
  },
  async plaza() {
    const posts = await selectAll(() => db().from('plaza_posts').select('post_id, member_id, status').order('id'));
    const cards = await distinct('connect_cards', 'member_id');
    const staff = await selectAll(() => db().from('event_staff').select('event_id, member_id').order('id'));
    const attendees = await selectAll(() => db().from('event_attendees').select('event_id, applicant_id').order('id'));
    const ads = await distinct('calendar_ads', 'ad_id');
    const teachers = await selectAll(() => db().from('teachers').select('member_id').order('sort_order'));
    const admins = (await distinct('admins', 'member_id')).slice(0, 3);
    const viewers = [...new Set([posts[0].member_id, ...admins, ...teachers.filter((_, i) => i % 400 === 7).map((t) => t.member_id)])];
    return [
      { action: 'listPlazaPosts' },
      { action: 'listPlazaPosts', offset: 20, limit: 5 },
      { action: 'listPlazaPosts', keyword: '전도' },
      ...['사례', '질문', '나눔', '불편신고', '전도부'].map((category) => ({ action: 'listPlazaPosts', category, memberId: viewers[0] })),
      ...posts.map((p) => ({ action: 'getPlazaPost', postId: p.post_id, memberId: viewers[0] })),
      { action: 'getPlazaMonthly' },
      { action: 'getPlazaMonthly', month: '2026-09', memberId: viewers[0] },
      { action: 'getCalendarEvents' },
      ...viewers.map((memberId) => ({ action: 'getCalendarEvents', memberId })),
      { action: 'getCalendarReport' },
      ...[...new Set(staff.map((s) => s.event_id))].map((eventId) => ({ action: 'getCalendarReport', eventId })),
      ...staff.map((s) => ({ action: 'getMyEventSignups', eventId: s.event_id, memberId: s.member_id })),
      ...attendees.map((s) => ({ action: 'getMyEventSignups', eventId: s.event_id, memberId: s.applicant_id })),
      { action: 'getCalendarAds' },
      { action: 'getAdQuestions' },
      ...ads.map((adId) => ({ action: 'getAdQuestions', adId })),
      ...cards.map((memberId) => ({ action: 'getConnectCard', memberId })),
      { action: 'getConnectCard', memberId: teachers[5].member_id },
      { action: 'searchConnectCards' },
      { action: 'searchConnectCards', memberId: cards[0], role: '교사' },
      { action: 'searchConnectCards', schedule: '등록' },
      { action: 'searchConnectCards', schedule: '언제나', limit: 5, offset: 2 },
      { action: 'searchConnectCards', keyword: '상담' },
      { action: 'searchConnectCards', tag: '청년 대상' },
      { action: 'getHelpPosts' },
      { action: 'getHelpPosts', includeClosed: true, memberId: viewers[0] },
      { action: 'getConnectAdminOverview' },
      { action: 'getCoachList' },
    ];
  },
};

const suite = suites[process.argv[2]];
if (!suite) { console.error('묶음 이름:', Object.keys(suites).join(', ')); process.exit(1); }

const cases = await suite();
const failed = {};
let done = 0;
const queue = [...cases];
await Promise.all(Array.from({ length: 6 }, async () => {
  for (let c; (c = queue.shift());) {
    const [oldR, newR] = await Promise.all([legacy(c), actions[c.action](c)]);
    const diff = firstDiff(oldR, JSON.parse(JSON.stringify(newR)));
    if (diff) (failed[c.action] ||= []).push(diff);
    if (++done % 40 === 0) console.log(`${done}/${cases.length}`);
  }
}));

const byAction = {};
for (const c of cases) byAction[c.action] = (byAction[c.action] || 0) + 1;
for (const [action, n] of Object.entries(byAction)) {
  const bad = failed[action] || [];
  console.log(`${bad.length ? '✗' : '✓'} ${action}: ${n - bad.length}/${n} 일치`);
  bad.slice(0, 4).forEach((d) => console.log('    ' + d));
}
process.exit(Object.keys(failed).length ? 1 : 0);
