// DB 집계 결과 대조용: 2026-11-12 최적화 전 읽기 계산을 고정한다. 실행은 가짜 DB에서만.
import {db,run,selectAll} from '../../server/lib/db.js';
import {normId,str,kstDate,kstDateTime,fmtTs} from '../../server/lib/util.js';
import {loadRoster,fixActivityNids} from '../../server/actions/roster.js';
const REST_MONTHS=1,LEAD_WINDOW_MONTHS=12,REVIEW_MONTHS=12,PROMO_ACTIVE_MIN_LEADS=1,PROMO_EXCELLENT_MIN_LEADS=2;
const REST_ACTIVITY_TYPES = new Set([
  '전도 섭외', '전도 대상자 만남', '피드백', '상담 교육', '복음방 교사 교육',
  '복음방 이전 상담 활동', '동행 교사', '선교센터 섬김이', '선교센터 교사로 출석', '선교센터 인도자',
  '섭외', '친분', '만남1', '만남2', '상담1', '상담2', '복음방', '센터소개', '센터수강', '동행교사',
  '동아리', '잎사귀', '만남 동행', '밭보기', '육상담', '부스담당', '은사', '멘토교사', '식구 복음방', '전도 행사 지원',
]);
// 11/1(사용자): 교사광장 일일보고 항목으로 묶어 센다 — 소분류는 그대로 두고 맞는 묶음에 들어간다. 순서 = 명단 열 순서.
const ACTIVITY_GROUPS = [
  ['피드백', ['피드백']],                                   // 사랑이 피드백
  ['섭외', ['섭외', '전도 섭외']],                          // 찾기 활동 · 전단지 · 좌판
  ['만남·교육', ['친분', '만남1', '만남2', '상담1', '상담2', '복음방', '전도 대상자 만남', '상담 교육', '상담 활동', '복음방 교사 교육', '복음방 이전 상담 활동']],
  ['동행 복음방', ['동행교사', '동행 교사']],
  ['식구 복음방', ['식구 복음방']],                          // 내부 복음방
  ['동호회', ['동아리']],                                   // 외부·내부
  ['협력', ['잎사귀', '만남 동행', '밭보기', '육상담', '부스담당', '은사', '멘토교사', '교육 지원', '특강']],   // 11/3: 교육 지원·특강
  ['센터 관리', ['센터소개', '센터수강', '선교센터 섬김이', '선교센터 교사로 출석', '선교센터 인도자']],
  ['전도 행사 지원', ['전도 행사 지원']],
];
const GROUP_OF = new Map(ACTIVITY_GROUPS.flatMap(([g, items]) => items.map((i) => [i, g])));
// 2026-09-04 개편 이전 활동 이름 → 지금 이름
const ACTIVITY_TYPE_ALIASES = {
  '상담': '상담 활동',
  '복음방 교육': '복음방 교사 교육',
  '동행 복음방': '동행 교사',
  '센터 수강 (인도자)': '선교센터 인도자',
  '센터 수강 (섬김이)': '선교센터 섬김이',
  '센터 수강 (교사)': '선교센터 교사로 출석',
};

function addMonths(base, months) {
  const d = new Date(base.getTime());
  d.setMonth(d.getMonth() + months);
  return d;
}
const monthsAgo = (base, months) => addMonths(base, -months);

function monthBounds(d) {
  return {
    start: new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0),
    end: new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59),
  };
}

const fmtDate = (d) => (d ? kstDate(d) : '');
const fmtMonth = (d) => kstDate(d).slice(0, 7);

async function loadActivities() {
  // 11/3: 번호를 잘못 넣고 남긴 기록도 그 교사 것으로 센다(이름이 명단에 한 명일 때)
  return fixActivityNids(await selectAll(() => db().from('activities').select('member_id, nid, name, submitted_at, activities, roles').order('id')));
}

/** 교사별 활동 [{type, date}] — 한 기록에 항목이 여럿이면 항목마다 한 건. */
function indexActivities(activities) {
  const index = new Map();
  for (const a of activities) {
    if (a.nid === '0' || !a.submitted_at) continue;
    const date = new Date(a.submitted_at);
    if (isNaN(date.getTime())) continue;
    if (!index.has(a.nid)) index.set(a.nid, []);
    for (const raw of a.activities) {
      const type = ACTIVITY_TYPE_ALIASES[raw.trim()] || raw.trim();
      if (type) index.get(a.nid).push({ type, date });
    }
  }
  return index;
}

/** 교사별 센터인도 날짜. */
async function loadLeadIndex() {
  const rows = await selectAll(() => db().from('center_leads').select('nid, lead_date').order('id'));
  const index = new Map();
  for (const l of rows) {
    if (l.nid === '0' || !l.lead_date) continue;
    if (!index.has(l.nid)) index.set(l.nid, []);
    index.get(l.nid).push(new Date(l.lead_date + 'T00:00:00'));
  }
  return index;
}

const pendingApprovals = () =>
  run(db().from('tier_approvals').select('*').eq('status', '대기').neq('member_id', '').order('id'));

/** "고유번호::제안등급" → 대기 중인 승인 줄(같은 키가 여럿이면 나중 것). */
function indexApprovals(rows) {
  return new Map(rows.map((r) => [`${r.nid}::${r.suggested_tier.trim()}`, r]));
}

/**
 * 심사에 필요한 자료를 한꺼번에.
 * scope 로 명단 범위를 좁힌다: { dept } / { region } / false(명단 없이 활동·인도·승인 자료만).
 */
async function loadTierData(scope = {}) {
  const [roster, activities, leads, approvals] = await Promise.all([
    scope ? loadRoster(scope) : [], loadActivities(), loadLeadIndex(), pendingApprovals(),
  ]);
  return { roster, activities, acts: indexActivities(activities), leads, approvals: indexApprovals(approvals), approvalRows: approvals };
}

function changedAtOf(person) {
  if (!person.tierChangedAt) return null;
  const d = new Date(person.tierChangedAt + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
}

// ── 판정 ──

/**
 * 한 사람의 등급 제안. 바꿀 것이 없으면 null.
 * 정교사·우수교사의 1년 심사 결과가 "유지"면 지금 등급과 같은 tier 를 돌려준다(심사 완료 표시용).
 */
function evalTier(currentTier, acts, leads, changedAt, asOf) {
  const yearAgo = monthsAgo(asOf, LEAD_WINDOW_MONTHS);
  const recentLeads = leads.filter((d) => d >= yearAgo && d <= asOf).length;
  /** 심사 주기가 돌아왔으면 그 기간의 신규 센터인도 수, 아니면 null. */
  const reviewLeads = () => {
    const due = !changedAt || asOf.getTime() >= addMonths(changedAt, REVIEW_MONTHS).getTime();
    if (!due) return null;
    const from = changedAt || monthsAgo(asOf, REVIEW_MONTHS);
    const to = changedAt ? addMonths(changedAt, REVIEW_MONTHS) : asOf;
    return leads.filter((d) => d >= from && d <= to).length;
  };
  const toExcellent = { tier: '우수교사', reason: `최근 1년 센터인도 ${recentLeads}명 → 우수교사 승급` };

  if (currentTier === '활동교사') {
    if (recentLeads >= PROMO_EXCELLENT_MIN_LEADS) return toExcellent;
    if (recentLeads >= PROMO_ACTIVE_MIN_LEADS) return { tier: '정교사', reason: `최근 1년 센터인도 ${recentLeads}명 → 정교사 승급` };
    return null;   // 휴교사 전환은 autoRestTiers 가 승인 없이 한다
  }
  if (currentTier === '정교사') {
    if (recentLeads >= PROMO_EXCELLENT_MIN_LEADS) return toExcellent;
    const n = reviewLeads();
    if (n === null) return null;
    if (n >= 1) return { tier: '정교사', reason: `1년 심사: 신규 센터인도 ${n}명 → 정교사 유지` };
    return { tier: '활동교사', reason: '1년 심사: 신규 센터인도 0명 → 활동교사로 강등' };
  }
  if (currentTier === '우수교사') {
    const n = reviewLeads();
    if (n === null) return null;
    if (n >= 2) return { tier: '우수교사', reason: `1년 심사: 신규 센터인도 ${n}명 → 우수교사 유지` };
    if (n === 1) return { tier: '정교사', reason: '1년 심사: 신규 센터인도 1명 → 정교사로 강등' };
    return { tier: '활동교사', reason: '1년 심사: 신규 센터인도 0명 → 활동교사로 강등' };
  }
  return null;   // 휴교사(기록하면 바로 활동교사 — autoRestTiers)·알 수 없는 등급값은 제안 없음
}

/** 한 사람의 심사 재료 + 제안. */
function review(person, data, asOf) {
  const nid = normId(person.memberId);
  const tier = person.tier || '활동교사';
  const acts = data.acts.get(nid) || [];
  const leads = data.leads.get(nid) || [];
  const result = evalTier(tier, acts, leads, changedAtOf(person), asOf);
  const pending = result ? data.approvals.get(`${nid}::${result.tier}`) : null;
  return { nid, tier, acts, leads, result, pending };
}

/** 승인 진행 상태(제안 옆에 붙는 공통 필드). */
function approvalState(pending) {
  const coach = pending ? pending.coach_approver : '';
  const leader = pending ? pending.leader_approver : '';
  return {
    approvalCount: (coach ? 1 : 0) + (leader ? 1 : 0),
    approvers: [coach, leader].filter(Boolean),
    coachApprover: coach, leaderApprover: leader,
    pendingType: pending ? (pending.type || 'auto') : null,
  };
}

/** 사유자로 등록된 대기 줄이 있으면 사유를 덧붙인다. */
const reasonWithLeave = (result, pending) =>
  (pending && pending.type === 'reason' && pending.reason ? `${result.reason} / 사유자(${pending.reason})` : result.reason);

const suggestionOf = ({ result, pending }) => (result
  ? { suggestedTier: result.tier, reason: reasonWithLeave(result, pending), ...approvalState(pending) }
  : null);

const countIn = (acts, { start, end }) => acts.filter((a) => a.date >= start && a.date <= end).length;
const latest = (acts, until) => acts.reduce((last, a) => ((!until || a.date <= until) && (!last || a.date > last) ? a.date : last), null);
const byName = (a, b) => (a.name < b.name ? -1 : (a.name > b.name ? 1 : 0));

function conditionText(acts, leads, asOf) {
  const from3 = monthsAgo(asOf, REST_MONTHS);
  const n = acts.filter((a) => a.date >= from3 && REST_ACTIVITY_TYPES.has(a.type)).length;
  const fromYear = monthsAgo(asOf, LEAD_WINDOW_MONTHS);
  const leadCount = leads.filter((d) => d >= fromYear).length;
  return `최근 ${REST_MONTHS}개월 활동 ${n === 0 ? '無' : n + '건'} · 최근 ${LEAD_WINDOW_MONTHS}개월 센터인도 ${leadCount}명`;
}

const stillAvailable = (p, today) => p.available && !(p.schedule_type === '직접' && p.avail_to && p.avail_to < today);

const CASE_CATEGORIES = ['사례', '성공사례', '실패사례'];   // plaza.js CATEGORY_ALIASES.사례 와 같게
const CASE_RANK_DEPTS = ['장년회', '부녀회', '청년회'];
/** 관리자 교사 명단: 명단 순서 그대로 교사별 활동·제안·명함 정보. */
export async function legacyTeacherReport(now = new Date()) {
  const bounds = monthBounds(now);
  const today = kstDate(now);
  const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  const monthAgo = monthsAgo(now, REST_MONTHS);
  const [data, profiles, visits, cards, cases, attends] = await Promise.all([
    loadTierData(),
    selectAll(() => db().from('teacher_profiles').select('*').order('id')),
    selectAll(() => db().from('app_visits').select('nid, visits, last_at').order('nid')),
    selectAll(() => db().from('connect_cards').select('id, nid').neq('member_id', '').order('id')),
    selectAll(() => db().from('plaza_posts').select('id, member_id').in('category', CASE_CATEGORIES).neq('status', '삭제').order('id')),
    // 11/1(사용자): 출석은 '잠재 활동' — 활동 기록·등급에는 안 치고 명단에만 최근 한 달 출석 수
    selectAll(() => db().from('attend_records').select('id, nid, at').gte('at', kstDateTime(monthAgo)).order('id')),
  ]);
  const attendOf = new Map();
  for (const a of attends) attendOf.set(a.nid, (attendOf.get(a.nid) || 0) + 1);
  const profileOf = new Map(profiles.map((p) => [p.nid, p]));
  const visitOf = new Map(visits.map((v) => [v.nid, v]));   // 2026-10-20 앱 접속 횟수
  // 10/30(사용자): 명함 등록 여부 · 사례 남긴 수 · 장부청 부서별 사례 1~3위
  const hasCard = new Set(cards.map((c) => c.nid));
  const caseCount = new Map();
  for (const p of cases) { const k = normId(p.member_id); caseCount.set(k, (caseCount.get(k) || 0) + 1); }
  const caseRank = new Map();
  for (const dept of CASE_RANK_DEPTS) {
    const ns = data.roster.filter((t) => String(t.dept || '').trim() === dept).map((t) => [normId(t.memberId), caseCount.get(normId(t.memberId)) || 0])
      .filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    // 건수가 같으면 같은 순위(1·1·3), 3위 안만
    ns.forEach(([nid, n], i) => { const rank = ns.findIndex(([, m]) => m === n) + 1; if (rank <= 3) caseRank.set(nid, rank); });
  }

  const rows = data.roster.map((person) => {
    const r = review(person, data, now);
    const p = profileOf.get(r.nid);
    const actTypes = {};
    const groups = {}, groupsMonth = {}, groupsPrev = {};   // 교사광장 일일보고 묶음(ACTIVITY_GROUPS)별 누적 · 이번 달 · 지난 달(엑셀용)
    const prev = monthBounds(new Date(now.getFullYear(), now.getMonth() - 1, 15));
    let prevCount = 0;
    for (const a of r.acts) {
      actTypes[a.type] = (actTypes[a.type] || 0) + 1;
      const inPrev = a.date >= prev.start && a.date <= prev.end;
      if (inPrev) prevCount++;
      const g = GROUP_OF.get(a.type);
      if (!g) continue;
      groups[g] = (groups[g] || 0) + 1;
      if (a.date >= bounds.start && a.date <= bounds.end) groupsMonth[g] = (groupsMonth[g] || 0) + 1;
      if (inPrev) groupsPrev[g] = (groupsPrev[g] || 0) + 1;
    }
    return {
      memberId: person.memberId, monthlyCount: countIn(r.acts, bounds),
      leads1y: r.leads.filter((d) => d >= oneYearAgo).length, actTotal: r.acts.length, actTypes,
      lastActivityDate: fmtDate(latest(r.acts)), conditionText: conditionText(r.acts, r.leads, now),
      suggestion: suggestionOf(r),
      apply: p && stillAvailable(p, today) ? {
        roles: p.avail_roles, scheduleType: p.schedule_type, from: p.avail_from, to: p.avail_to,
        days: p.avail_days, times: p.avail_times, hours: p.avail_hours,
      } : null,
      affil: p ? p.affil : '', gender: p ? p.gender : '',
      visits: visitOf.get(r.nid)?.visits || 0, lastVisit: fmtTs(visitOf.get(r.nid)?.last_at),
      card: hasCard.has(r.nid), cases: caseCount.get(r.nid) || 0, caseRank: caseRank.get(r.nid) || 0,
      groups, groupsMonth, groupsPrev, prevCount, attend1m: attendOf.get(r.nid) || 0,
    };
  });
  return { rows, groups: ACTIVITY_GROUPS.map(([g]) => g) };
}

