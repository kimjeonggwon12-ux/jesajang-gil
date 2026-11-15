// 2026-11-12 최적화 전 읽기 결과 비교용. 격리 DB 검사에서만 사용.
// 등급 심사 엔진 — 승급·강등 제안, 일괄 승인, 결산, 부서·지역 현황
import { db, run, selectAll } from '../../server/lib/db.js';
import { normId, str, kstDate, kstDateTime, fmtTs, byDesc } from '../../server/lib/util.js';
import { TEACHER_TIERS, toRosterRow, findTeacher, loadRoster, rosterCounts, teachersByNid, forgetRoster, fixActivityNids } from '../../server/actions/roster.js';
import { ROLE_OPTIONS, emptyRoleCounts } from '../../server/actions/activities.js';
import { isEvangelism } from '../../server/actions/roster.js';
import { requireActor, AccessError } from '../../server/lib/request-context.js';
import { TARGET_STAGES } from '../../server/actions/targets.js';

// ── 휴교사 ↔ 활동교사 ── 11/1(사용자): "기록을 하면 활동교사로 전환, 한 달 동안 기록이 없으면 휴교사로 강등" — 승인 없이 자동.
//   (옛 규칙: 최근 3개월 5건 미만 → 휴교사 제안 + 승인.) 정교사·우수교사는 센터인도 1년 심사 그대로.
//   출석(QR)은 '잠재 활동'으로 명단에만 보이고 등급에는 안 친다.
//   11/2(사용자): 휴교사 → 활동교사는 "내 활동 기록이 4회 이상"이면(최근 한 달 기록 건수, 지금부터 적용). 강등(한 달 기록 없음)은 그대로.
const REST_MONTHS = 1;
const REST_MIN_TOTAL = 1;
export const ACTIVE_MIN_RECORDS = 4;
const AUTO_RULE_START = '2026-11-05';   // 11/4(사용자): 11/5부터 휴·활·정·우 시작 — 이 날부터 기록을 센다
// 11/4(사용자): "내일부터 기록한 것이 달에 4건이면 활동교사, 4건 미만이면 휴교사" — 달력의 한 달(1일~말일) 단위.
//   휴교사: 이번 달(11월은 5일부터) 기록이 4건이 되면 그 자리에서 활동교사.
//   활동교사: 지난달 기록이 4건 미만이면 새 달 첫날 휴교사(지난달 중에 등급이 바뀐 사람은 그다음 달부터 본다).
//   정교사·우수교사는 센터인도 1년 심사 그대로(이 규칙으로 내리지 않음). 기록 1건 = 활동 기록 한 번(항목 수와 상관없이).
const ymd = (s) => String(s || '').slice(0, 10);
const maxDay = (a, b) => (a > b ? a : b);
/** 그 날이 든 달의 [시작, 끝] 'YYYY-MM-DD' — 시작은 규칙 시작일보다 앞서지 않는다. */
function ruleMonth(day) {
  const [y, m] = day.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { start: maxDay(`${y}-${mm}-01`, AUTO_RULE_START), end: `${y}-${mm}-${String(last).padStart(2, '0')}` };
}
// 11/4(김논 서무님): 엑셀 구분 '기타'(293명)는 휴교사로 두고, 11/5 이후 출석(QR) 2번이면 활동교사 — 한 번만(그 뒤엔 일반 규칙).
export const OTHER_ATTEND_GOAL = 2;
const isOther = (t) => !!(t && t.month_stats && t.month_stats.tierRaw === '기타');
// 11/5: 이제 등급 자체가 '기타'(예전처럼 휴교사로 들어간 기타도 같이 본다)
const otherPending = (t) => !!t && (t.tier === '기타' || (isOther(t) && t.tier === '휴교사' && (!t.tier_changed_at || ymd(t.tier_changed_at) <= AUTO_RULE_START)));
/** 11/5 이후 출석한 모임 수(같은 모임 두 번은 한 번). */
async function otherAttendCount(nid) {
  const rows = await run(db().from('attend_records').select('meeting_id').eq('nid', nid).gte('at', `${AUTO_RULE_START} 00:00:00`).limit(50));
  return new Set(rows.map((r) => r.meeting_id)).size;
}
const prevMonthDay = (day) => { const [y, m] = day.split('-').map(Number); const d = new Date(Date.UTC(y, m - 2, 15)); return d.toISOString().slice(0, 10); };
// ⚠️ app.html 의 활동 항목 목록과 같이 맞출 것.
const ROLE_ACTIVITY_OPTIONS = ['피드백', '섭외', '친분', '만남1', '만남2', '상담1', '상담2', '복음방', '센터소개', '센터수강'];
const TEACHER_ONLY_ACTIVITY = '동행교사';
// 11/1(사용자): 소분류에 없던 교사 활동 — 내부(식구) 복음방 · 전도 행사 지원. 동호회는 협력의 '동아리'를 모든 역할에 연다.
const COOP_ACTIVITY_OPTIONS = ['동아리', '잎사귀', '만남 동행', '밭보기', '육상담', '부스담당', '은사', '멘토교사', '동행교사', '식구 복음방', '전도 행사 지원'];
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

// ── 센터인도 기준 승급: 최근 1년 1명 → 정교사, 2명 → 우수교사. 정교사·우수교사는 1년마다 심사 ──
const LEAD_WINDOW_MONTHS = 12;
const PROMO_ACTIVE_MIN_LEADS = 1;
const PROMO_EXCELLENT_MIN_LEADS = 2;
const REVIEW_MONTHS = 12;

const LEAVE_REASONS = ['질병', '출산', '병간호', '군대'];
const REQUIRED_APPROVALS = 2;
const INACTIVE_WARN_MONTHS = 2;
const INACTIVE_DANGER_MONTHS = 3;
const SETTLEMENT_LIST_CAP = 500;
const INACTIVE_LIST_CAP = 400;

const ORG_MAIN_DEPTS = ['교역자', '자문회', '장년회', '부녀회', '청년회'];
const ORG_DEPTS = [...ORG_MAIN_DEPTS, '기타'];
const orgBucket = (dept) => (ORG_MAIN_DEPTS.includes(str(dept)) ? str(dept) : '기타');

const tierRank = (tier) => TEACHER_TIERS.indexOf(tier);
const emptyTierCounts = () => Object.fromEntries(TEACHER_TIERS.map((t) => [t, 0]));

// ── 날짜 ── (서버 시간대는 lib/util.js 에서 서울로 고정)

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

/** 결산 기준일: asOf('yyyy-MM-dd') 또는 year+month(그 달 말일), 없으면 지금. */
function settlementDate(body) {
  if (body.asOf) {
    const p = new Date(String(body.asOf) + 'T23:59:59');
    if (!isNaN(p.getTime())) return p;
  }
  const y = Number(body.year);
  const m = Number(body.month);
  if (y && m >= 1 && m <= 12) return new Date(y, m, 0, 23, 59, 59);
  return new Date();
}

// ── 자료 읽기 ──

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
function evalTier(currentTier, acts, leads, changedAt, asOf, counts = null) {
  const yearAgo = monthsAgo(asOf, LEAD_WINDOW_MONTHS);
  const recentLeads = counts ? counts.recentLeads : leads.filter((d) => d >= yearAgo && d <= asOf).length;
  /** 심사 주기가 돌아왔으면 그 기간의 신규 센터인도 수, 아니면 null. */
  const reviewLeads = () => {
    if (counts) return counts.reviewDue ? counts.reviewLeads : null;
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


/** 지역장 화면: 같은 지역 교사들의 이번 달 활동·등급·제안. */
export async function legacygetDistrictView(body, now = new Date()) {
  const mid = str(body.memberId);
  const name = str(body.name);
  if (!mid) return { error: 'memberId 가 필요합니다.' };
  const nid = normId(mid);
  const found = await findTeacher(mid);
  if (!found) return { error: '교사명단에서 고유번호를 찾을 수 없습니다.' };
  const leader = toRosterRow(found);
  if (name && leader.name && name !== leader.name) return { error: '고유번호와 이름이 일치하지 않습니다.' };

  const region = leader.region || '';
  if (!region || !leader.dept) return { error: '담당 부서와 지역을 먼저 등록해 주세요.' };
  const data = await loadTierData({ dept: leader.dept, region });   // 같은 지역만 읽는다
  const bounds = monthBounds(now);
  const teachers = data.roster
    .filter((p) => p.dept === leader.dept && (p.region || '') === region && normId(p.memberId) !== nid)
    .map((p) => {
      const r = review(p, data, now);
      return {
        memberId: p.memberId, name: p.name, affiliation: p.affiliation || '',
        tier: r.tier, tierChangedAt: p.tierChangedAt || '',
        monthlyCount: countIn(r.acts, bounds), lastActivityDate: fmtDate(latest(r.acts)),
        suggestion: suggestionOf(r),
      };
    })
    .sort(byName);
  return {
    leader: { memberId: mid, name: leader.name, region, isDistrictLeader: (leader.position || '').includes('지역장') },
    month: fmtMonth(bounds.start), asOf: fmtDate(now), teachers,
  };
}

/** 나의 교실: 내 등급과 다음 등급까지 남은 것. */
export async function legacygetMyTierStatus(body, now = new Date()) {
  const mid = str(body.memberId);
  if (!mid) return { error: 'memberId 가 필요합니다.' };
  const teacher = await findTeacher(mid);
  if (!teacher) return { error: '교사명단에서 고유번호를 찾을 수 없습니다.' };
  const person = toRosterRow(teacher);
  const nid = normId(mid);
  const [activities, leadRows] = await Promise.all([
    selectAll(() => db().from('activities').select('nid, submitted_at, activities').eq('nid', nid).order('id')),
    run(db().from('center_leads').select('lead_date').eq('nid', nid).order('id')),
  ]);
  const acts = indexActivities(activities).get(nid) || [];
  const leads = leadRows.filter((l) => l.lead_date).map((l) => new Date(l.lead_date + 'T00:00:00'));

  const yearAgo = monthsAgo(now, LEAD_WINDOW_MONTHS);
  const last = latest(acts);
  const tier = person.tier || '활동교사';
  const next = {
    휴교사: { nextTier: '활동교사', leadGoal: null },
    기타: { nextTier: '활동교사', leadGoal: null },
    활동교사: { nextTier: '정교사', leadGoal: PROMO_ACTIVE_MIN_LEADS },
    정교사: { nextTier: '우수교사', leadGoal: PROMO_EXCELLENT_MIN_LEADS },
  }[tier] || { nextTier: null, leadGoal: null };
  const result = evalTier(tier, acts, leads, changedAtOf(person), now);
  return {
    memberId: person.memberId, name: person.name, dept: person.dept || '', region: person.region || '',
    tier, tierChangedAt: person.tierChangedAt || '',
    monthlyCount: countIn(acts, monthBounds(now)), monthlyGoal: REST_MIN_TOTAL,
    // 11/2: 휴교사 → 활동교사 진행도(최근 한 달 기록 건수 / 4회), 활동교사 → 휴교사까지 남은 날
    // 11/4: 이번 달(11월은 5일부터) 기록 건수 / 4건, 이번 달 남은 날 — 활동교사도 이번 달 4건을 채워야 다음 달에 활동교사 유지
    recentRecords: activities.filter((a) => { const d = ymd(a.submitted_at); return d >= ruleMonth(kstDate(now)).start && d <= ruleMonth(kstDate(now)).end; }).length,
    activeGoal: ACTIVE_MIN_RECORDS, ruleStart: AUTO_RULE_START,
    otherPending: otherPending(teacher), otherAttend: otherPending(teacher) ? await otherAttendCount(nid) : null, otherGoal: OTHER_ATTEND_GOAL, monthStart: ruleMonth(kstDate(now)).start, monthEnd: ruleMonth(kstDate(now)).end,
    monthDaysLeft: Math.max(0, Math.round((new Date(ruleMonth(kstDate(now)).end + 'T00:00:00Z') - new Date(kstDate(now) + 'T00:00:00Z')) / 86400000) + 1),
    restInDays: null,
    leadCount: leads.filter((d) => d >= yearAgo && d <= now).length, leadGoal: next.leadGoal, nextTier: next.nextTier,
    lastActivityDate: fmtDate(last), daysSinceLastActivity: last ? Math.floor((now.getTime() - last.getTime()) / 86400000) : null,
    suggestion: result ? { suggestedTier: result.tier, reason: result.reason } : null,
  };
}


/** 여러 교사 줄의 합계(부서 전체·지역별 공용). */
function aggregate(rows) {
  const tierCounts = emptyTierCounts();
  let activeCount = 0, monthlyActivityCount = 0, promotionCount = 0;
  for (const r of rows) {
    tierCounts[r.tier] = (tierCounts[r.tier] || 0) + 1;
    if (r.monthlyCount > 0) { activeCount++; monthlyActivityCount += r.monthlyCount; }
    if (r.suggestion && tierRank(r.suggestion.suggestedTier) > tierRank(r.tier)) promotionCount++;
  }
  return { totalTeachers: rows.length, tierCounts, activeCount, monthlyActivityCount, promotionCount };
}

/** "최근 1개월 활동 n건 · 최근 12개월 센터인도 n명" */
function conditionText(acts, leads, asOf) {
  const from3 = monthsAgo(asOf, REST_MONTHS);
  const n = acts.filter((a) => a.date >= from3 && REST_ACTIVITY_TYPES.has(a.type)).length;
  const fromYear = monthsAgo(asOf, LEAD_WINDOW_MONTHS);
  const leadCount = leads.filter((d) => d >= fromYear).length;
  return `최근 ${REST_MONTHS}개월 활동 ${n === 0 ? '無' : n + '건'} · 최근 ${LEAD_WINDOW_MONTHS}개월 센터인도 ${leadCount}명`;
}

/** 이번 달 활동 기록만. */
const thisMonth = (activities, month) => activities.filter((a) => a.member_id && fmtTs(a.submitted_at).slice(0, 7) === month);

/** 부서별 교사 관리: 교사 목록(+지역 거르기), 부서 합계, 지역별 합계, 역할별 활동, 대상자 단계 분포. */
export async function legacygetDistrictReport(body, now = new Date()) {
  const dept = str(body.dept);
  if (!ORG_DEPTS.includes(dept)) return { error: `알 수 없는 부서: ${dept} (허용값: ${ORG_DEPTS.join(', ')})` };
  const region = str(body.region) === '전체' ? '' : str(body.region);
  const bounds = monthBounds(now);
  const month = fmtMonth(bounds.start);

  const [data, targets] = await Promise.all([
    loadTierData(dept === '기타' ? {} : { dept }),   // '기타'는 다섯 부서가 아닌 나머지라 전체에서 골라야 한다
    selectAll(() => db().from('targets').select('creator_nid, leader_nid, helper_nid, stage, completed').order('id')),
  ]);
  const members = data.roster.filter((p) => orgBucket(p.dept) === dept);
  const regions = [...new Set(members.map((p) => p.region).filter(Boolean))].sort();

  const allRows = members.map((p) => {
    const r = review(p, data, now);
    return {
      memberId: p.memberId, name: p.name, region: p.region || '', dept: p.dept || '',
      tier: r.tier, tierChangedAt: p.tierChangedAt || '',
      monthlyCount: countIn(r.acts, bounds), lastActivityDate: fmtDate(latest(r.acts)),
      conditionText: conditionText(r.acts, r.leads, now), suggestion: suggestionOf(r),
    };
  });

  const regionOf = new Map(members.map((p) => [normId(p.memberId), p.region || '']));
  const roleActivityCounts = emptyRoleCounts();
  const roleByRegion = Object.fromEntries(regions.map((r) => [r, emptyRoleCounts()]));
  for (const a of thisMonth(data.activities, month)) {
    if (!regionOf.has(a.nid)) continue;
    const reg = regionOf.get(a.nid);
    for (const role of a.roles) {
      if (roleActivityCounts[role] === undefined) continue;
      roleActivityCounts[role]++;
      if (roleByRegion[reg]) roleByRegion[reg][role]++;
    }
  }

  const byRegion = regions
    .map((r) => ({ ...aggregate(allRows.filter((row) => row.region === r)), region: r, roleActivityCounts: roleByRegion[r] }))
    .sort((a, b) => b.totalTeachers - a.totalTeachers);

  // 진행 중인 대상자의 단계 분포(담당자 중 한 명이라도 이 부서면 포함)
  const targetStageCounts = Object.fromEntries(TARGET_STAGES.map((s) => [s, 0]));
  for (const t of targets) {
    if (t.completed) continue;
    if (![t.creator_nid, t.leader_nid || '0', t.helper_nid || '0'].some((id) => regionOf.has(id))) continue;
    if (targetStageCounts[t.stage] !== undefined) targetStageCounts[t.stage]++;
  }

  const rows = (region ? allRows.filter((r) => r.region === region) : allRows).sort(byName);
  return {
    asOf: fmtDate(now), month, dept, region, regions, rows, total: rows.length,
    summary: aggregate(allRows), byRegion, roleActivityCounts, targetStageCounts,
  };
}

/** 통합 관리: 조직(부서)별 요약. */
export async function legacygetOrgSummary(now = new Date()) {
  const bounds = monthBounds(now);
  const month = fmtMonth(bounds.start);
  // 인원·등급 수는 DB 가 세고, 활동·승급은 활동이나 센터인도 기록이 있는 사람만 살핀다
  // (기록이 없는 사람은 이번 달 활동도, 승급 제안도 있을 수 없다).
  const [counts, data] = await Promise.all([rosterCounts(), loadTierData(false)]);
  const byDept = Object.fromEntries(ORG_DEPTS.map((d) => [d, {
    dept: d, totalTeachers: 0, tierCounts: emptyTierCounts(), activeCount: 0, monthlyActivityCount: 0,
    promotionCount: 0, roleActivityCounts: emptyRoleCounts(),
  }]));
  const tierCounts = emptyTierCounts();
  let totalTeachers = 0;
  for (const c of counts) {
    const bucket = byDept[orgBucket(c.dept)];
    const tier = c.tier || '활동교사';
    bucket.totalTeachers += c.n;
    bucket.tierCounts[tier] = (bucket.tierCounts[tier] || 0) + c.n;
    tierCounts[tier] = (tierCounts[tier] || 0) + c.n;
    totalTeachers += c.n;
  }

  const withRecords = await teachersByNid([...data.acts.keys(), ...data.leads.keys()]);
  const deptOf = new Map();
  for (const p of withRecords.values()) {
    const bucket = byDept[orgBucket(p.dept)];
    const r = review(p, data, now);
    deptOf.set(r.nid, bucket.dept);
    const monthly = countIn(r.acts, bounds);
    if (monthly > 0) { bucket.activeCount++; bucket.monthlyActivityCount += monthly; }
    if (r.result && tierRank(r.result.tier) > tierRank(r.tier)) bucket.promotionCount++;
  }

  const roleActivityCounts = emptyRoleCounts();
  for (const a of thisMonth(data.activities, month)) {
    const d = deptOf.get(a.nid);
    if (!d) continue;
    for (const role of a.roles) {
      if (roleActivityCounts[role] === undefined) continue;
      byDept[d].roleActivityCounts[role]++;
      roleActivityCounts[role]++;
    }
  }
  return {
    asOf: fmtDate(now), month, orgs: ORG_DEPTS.map((d) => byDept[d]),
    totalTeachers, tierCounts, roleActivityCounts,
  };
}

async function checkTierChanges(body) {
  const asOf = settlementDate(body);
  const data = await loadTierData();
  const rows = [];
  for (const person of data.roster) {
    const r = review(person, data, asOf);
    if (!r.result) continue;
    rows.push({
      memberId: person.memberId, name: person.name, currentTier: r.tier,
      suggestedTier: r.result.tier, reason: reasonWithLeave(r.result, r.pending), ...approvalState(r.pending),
    });
  }
  return { asOf: fmtDate(asOf), month: fmtMonth(monthBounds(asOf).start), rows };
}

/** 마지막 활동일 기준 비활동 단계(표시용): 2개월 주의, 3개월 또는 기록 없음 위험. */
function inactivityLevel(last, asOf) {
  if (!last) return 'danger';
  const months = (asOf.getTime() - last.getTime()) / (1000 * 60 * 60 * 24 * 30.4375);
  if (months >= INACTIVE_DANGER_MONTHS) return 'danger';
  if (months >= INACTIVE_WARN_MONTHS) return 'warning';
  return null;
}

/** 월별 결산: 승급·강등 대상, 비활동자, 센터인도 순위, 승인 대기. */
async function getSettlementReport(body) {
  const asOf = settlementDate(body);
  const bounds = monthBounds(asOf);
  const data = await loadTierData();
  const yearAgo = monthsAgo(asOf, LEAD_WINDOW_MONTHS);
  const promotions = [], demotions = [], inactive = [], leaders = [];
  let promotionsTotal = 0, demotionsTotal = 0, inactiveTotal = 0, inactiveWarn = 0, inactiveDanger = 0;

  for (const p of data.roster) {
    const r = review(p, data, asOf);
    const last = latest(r.acts, asOf);
    const level = inactivityLevel(last, asOf);
    const who = { memberId: p.memberId, name: p.name, region: p.region || '', dept: p.dept || '' };

    if (level) {
      inactiveTotal++;
      if (level === 'warning') inactiveWarn++; else inactiveDanger++;
      if (inactive.length < INACTIVE_LIST_CAP) {
        inactive.push({ ...who, tier: r.tier, lastActivityDate: fmtDate(last), monthlyCount: countIn(r.acts, bounds), inactivity: level });
      }
    }
    const leadCount = r.leads.filter((d) => d >= yearAgo && d <= asOf).length;
    if (leadCount > 0) leaders.push({ memberId: p.memberId, name: p.name, region: p.region || '', tier: r.tier, leadCount });

    if (!r.result || r.result.tier === r.tier) continue;   // 변경 없음·"유지"는 결산 목록에서 뺀다
    const row = { ...who, currentTier: r.tier, suggestedTier: r.result.tier, reason: r.result.reason, ...approvalState(r.pending) };
    if (tierRank(r.result.tier) > tierRank(r.tier)) {
      promotionsTotal++;
      if (promotions.length < SETTLEMENT_LIST_CAP) promotions.push(row);
    } else {
      demotionsTotal++;
      if (demotions.length < SETTLEMENT_LIST_CAP) demotions.push({ ...row, inactivity: level, lastActivityDate: fmtDate(last) });
    }
  }
  leaders.sort((a, b) => b.leadCount - a.leadCount);

  const waiting = data.approvalRows.map((r) => ({ r, state: approvalState(r) }))
    .filter(({ state }) => state.approvalCount < REQUIRED_APPROVALS)
    .map(({ r, state }) => ({
      memberId: r.member_id, name: r.name, currentTier: r.current_tier, suggestedTier: r.suggested_tier,
      reason: r.reason, type: r.type || 'auto',
      approvalCount: state.approvalCount, approvers: state.approvers,
      coachApprover: state.coachApprover, leaderApprover: state.leaderApprover,
    }));

  return {
    asOf: fmtDate(asOf), month: fmtMonth(bounds.start),
    promotions, promotionsTotal, demotions, demotionsTotal,
    inactive, inactiveTotal, inactiveWarn, inactiveDanger,
    leaders, pendingApprovalCount: waiting.length, pendingApprovals: waiting,
  };
}

const TOP_REGION_ASPECTS = { 만남: ['만남1', '만남2'], 상담: ['상담1', '상담2'], 복음방: ['복음방'], 센터인도: ['센터소개', '센터수강'] };
const TOP_REGION_ASPECT_ORDER = ['만남', '상담', '복음방', '센터인도', '종합'];
const ALL_ITEMS = [...ROLE_ACTIVITY_OPTIONS, TEACHER_ONLY_ACTIVITY, ...COOP_ACTIVITY_OPTIONS.filter((i) => i !== TEACHER_ONLY_ACTIVITY)];
const aspectItems = (aspect) => (aspect === '종합' ? ALL_ITEMS : TOP_REGION_ASPECTS[aspect] || []);

/** counts[부서][역할][지역][항목] = 이번 달 건수 */
async function buildTopRegionCounts() {
  // 최근 기록부터 센다 — 건수가 같은 지역끼리는 먼저 센 쪽이 앞 순위가 된다.
  const recentFirst = thisMonth(await loadActivities(), kstDate().slice(0, 7)).sort(byDesc('submitted_at'));
  // 명단은 이번 달에 활동한 사람 것만 읽는다.
  const active = await teachersByNid(recentFirst.map((a) => a.nid));
  const info = new Map([...active].map(([nid, p]) => [nid, { region: p.region || '', dept: orgBucket(p.dept) }]));
  const counts = Object.fromEntries(ORG_MAIN_DEPTS.map((d) => [d, Object.fromEntries(ROLE_OPTIONS.map((r) => [r, {}]))]));
  for (const a of recentFirst) {
    const who = info.get(a.nid);
    if (!who || !who.region || !counts[who.dept]) continue;
    for (const role of a.roles) {
      if (!ROLE_OPTIONS.includes(role)) continue;
      const byRegion = counts[who.dept][role];
      for (const item of a.activities) {
        if (!item) continue;
        byRegion[who.region] ||= {};
        byRegion[who.region][item] = (byRegion[who.region][item] || 0) + 1;
      }
    }
  }
  return counts;
}

function regionSums(counts, dept, role, aspect) {
  const items = aspectItems(aspect);
  const sums = {};
  for (const r of role ? [role] : ROLE_OPTIONS) {
    const byRegion = counts[dept]?.[r] || {};
    for (const [region, itemMap] of Object.entries(byRegion)) {
      sums[region] = (sums[region] || 0) + items.reduce((s, it) => s + (itemMap[it] || 0), 0);
    }
  }
  return sums;
}

const top3 = (sums) => Object.entries(sums).map(([region, count]) => ({ region, count }))
  .filter((r) => r.count > 0).sort((a, b) => b.count - a.count).slice(0, 3);

// 이번 달 기록이 하나도 없을 때 화면이 비지 않게 보여 주는 예시 값(같은 입력이면 늘 같은 값).
const charSum = (s) => String(s).split('').reduce((sum, c) => sum + c.charCodeAt(0), 0);
const fraction = (seed) => seed - Math.floor(seed);

function sampleTop3(dept, role, aspect) {
  const base = charSum(`${dept}|${role || ''}|${aspect}`);
  return ['1지역', '2지역', '3지역', '4지역', '5지역']
    .map((region, i) => ({ region, count: Math.floor(fraction(Math.sin(base * 12.9898 + i * 78.233) * 43758.5453) * 20) + 5 }))
    .sort((a, b) => b.count - a.count).slice(0, 3);
}

function sampleChurchTop3(seedKey) {
  const base = charSum(seedKey);
  return [0, 1, 2].map((rank) => {
    const dept = ORG_MAIN_DEPTS[(base + rank) % ORG_MAIN_DEPTS.length];
    const f = fraction(Math.sin(base * 12.9898 + rank * 78.233) * 43758.5453);
    return { region: dept === '교역자' ? '전체' : `${Math.floor(f * 4) + 1}지역`, dept, count: Math.floor(f * 15) + (30 - rank * 8) };
  }).sort((a, b) => b.count - a.count);
}

async function getTopRegions(body) {
  const dept = String(body.dept || '');
  const role = body.role ? String(body.role) : '';
  if (!ORG_MAIN_DEPTS.includes(dept)) return { error: 'dept 가 필요합니다 (자문회/장년회/부녀회/청년회 중 하나).' };
  const counts = await buildTopRegionCounts();
  if (body.aspect) {
    const aspect = String(body.aspect);
    const rows = top3(regionSums(counts, dept, role, aspect));
    return rows.length ? { rows, isSample: false } : { rows: sampleTop3(dept, role, aspect), isSample: true };
  }
  const byAspect = {};
  let isSample = false;
  for (const aspect of TOP_REGION_ASPECT_ORDER) {
    let top = top3(regionSums(counts, dept, role, aspect));
    if (!top.length) { top = sampleTop3(dept, role, aspect); isSample = true; }
    byAspect[aspect] = top;
  }
  return { byAspect, isSample };
}

async function getChurchTopRegions() {
  const counts = await buildTopRegionCounts();
  const byAspect = {};
  let isSample = false;
  for (const aspect of TOP_REGION_ASPECT_ORDER) {
    let top = ORG_MAIN_DEPTS
      .flatMap((dept) => Object.entries(regionSums(counts, dept, '', aspect)).map(([region, count]) => ({ region, dept, count })))
      .filter((r) => r.count > 0).sort((a, b) => b.count - a.count).slice(0, 3);
    if (!top.length) { top = sampleChurchTop3(aspect); isSample = true; }
    byAspect[aspect] = top;
  }

  const byRole = ROLE_OPTIONS.map((role) => {
    const sums = {};
    for (const dept of ORG_MAIN_DEPTS) {
      for (const [region, count] of Object.entries(regionSums(counts, dept, role, '종합'))) sums[region] = (sums[region] || 0) + count;
    }
    const top = top3(sums);
    if (!top.length) {
      const sample = sampleChurchTop3(role + '|종합')[0];
      return { role, topRegion: sample.region, topDept: sample.dept, totalCount: sample.count, topItem: '섭외', isSample: true };
    }
    const topRegion = top[0].region;
    const itemTotals = {};
    const deptScore = {};
    for (const dept of ORG_MAIN_DEPTS) {
      const items = counts[dept]?.[role]?.[topRegion];
      if (!items) continue;
      deptScore[dept] = 0;
      for (const [item, n] of Object.entries(items)) { itemTotals[item] = (itemTotals[item] || 0) + n; deptScore[dept] += n; }
    }
    const best = (map, fallback) => Object.entries(map).reduce((b, [k, v]) => (v > b[1] ? [k, v] : b), [fallback, -1])[0];
    return { role, topRegion, topDept: best(deptScore, ORG_MAIN_DEPTS[0]), totalCount: top[0].count, topItem: best(itemTotals, '') || '-', isSample: false };
  });
  return { byAspect, byRole, isSample };
}

/**
 * 11/8(사용자): 관리자 전체 요약 맨 위 — 이번 달(1일~오늘) 활동 기록 0건인 교사(미활동) · 교육(QR 출석) 0번인 교사(교육 불참).
 * 활동은 부서별 참여 현황(getOrgSummary activeCount)과 같은 기준, 교육은 지운 모임을 뺀 출석 기록.
 */
async function getNonParticipants() {
  const now = new Date();
  const bounds = monthBounds(now);
  const from = kstDateTime(bounds.start);
  const [roster, activities, attends, meetings] = await Promise.all([
    loadRoster(),
    selectAll(() => db().from('activities').select('member_id, nid, name, submitted_at, activities, roles').gte('submitted_at', from).order('id')),
    selectAll(() => db().from('attend_records').select('id, nid, meeting_id').gte('at', from).order('id')),
    selectAll(() => db().from('attend_meetings').select('meeting_id, title, date, status').gte('date', from.slice(0, 10)).order('date')),
  ]);
  const acted = new Set();
  for (const a of await fixActivityNids(activities)) if (a.nid && a.nid !== '0') acted.add(a.nid);
  const live = new Map(meetings.filter((m) => m.status !== '삭제').map((m) => [m.meeting_id, m]));
  const attended = new Map();
  for (const r of attends) {
    if (!live.has(r.meeting_id)) continue;
    if (!attended.has(r.nid)) attended.set(r.nid, new Set());
    attended.get(r.nid).add(r.meeting_id);
  }
  const depts = Object.fromEntries(ORG_DEPTS.map((d) => [d, { dept: d, total: 0, inactive: 0, noEdu: 0, both: 0 }]));
  const rows = [];
  for (const p of roster) {
    const nid = normId(p.memberId);
    const d = depts[orgBucket(p.dept)];
    const act = acted.has(nid), edu = attended.has(nid) ? attended.get(nid).size : 0;
    d.total++;
    if (!act) d.inactive++;
    if (!edu) d.noEdu++;
    if (!act && !edu) d.both++;
    if (!act || !edu) rows.push({ memberId: p.memberId, name: p.name, dept: d.dept, region: p.region, tier: p.tier, inactive: !act, noEdu: !edu });
  }
  return {
    asOf: fmtDate(now), month: fmtMonth(bounds.start), from: from.slice(0, 10),
    meetings: [...live.values()].map((m) => ({ title: m.title, date: m.date })),
    depts: ORG_DEPTS.map((d) => depts[d]), rows,
  };
}


export default {checkTierChanges,getSettlementReport,getNonParticipants,getTopRegions,getChurchTopRegions};
