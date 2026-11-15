// 최적화 전 지역 표·그래프 계산 결과의 독립 비교 기준.
export function legacyStatusCharts(report, allActivities, now = new Date()) {
const ACTIVITY_OPTIONS = [
  '전도 섭외', '전도 대상자 만남', '복음방 이전 상담 활동', '상담 활동', '상담 교육',
  '복음방 교사 교육', '동행 교사', '피드백', '선교센터 섬김이', '선교센터 교사로 출석', '선교센터 인도자'
];
const ROLE_PARTS_DASH = ['인도자', '교사', '섬김이', '협력교사'];
// 2026-10-02: 협력교사는 전용 9항목(나의 교실 COOP_ACTIVITY_OPTIONS와 동일) — 역할별 표는 roleItemsDash(role),
// 역할 무관 합산(강세 항목·AI 분석)은 두 체계를 합친 ROLE_ACTIVITY_ITEMS_DASH를 쓴다.
const BASE_ACTIVITY_ITEMS_DASH = ['피드백', '섭외', '친분', '만남1', '만남2', '상담1', '상담2', '복음방', '동행교사', '센터소개', '센터수강'];
const COOP_ACTIVITY_ITEMS_DASH = ['동아리', '잎사귀', '만남 동행', '밭보기', '육상담', '부스담당', '은사', '멘토교사', '동행교사', '식구 복음방', '전도 행사 지원'];
const ROLE_ACTIVITY_ITEMS_DASH = BASE_ACTIVITY_ITEMS_DASH.concat(COOP_ACTIVITY_ITEMS_DASH.filter(i => !BASE_ACTIVITY_ITEMS_DASH.includes(i)));
function roleItemsDash(role) { return role === '협력교사' ? COOP_ACTIVITY_ITEMS_DASH : BASE_ACTIVITY_ITEMS_DASH; }
function _emptyRoleCounts() {
  const o = {};
  ROLE_PARTS_DASH.forEach(r => { o[r] = 0; });
  return o;
}

function isThisMonth(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d)) return false;

  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

// report: 현재 부서의 getDistrictReport 캐시(지역 필터와 무관하게 항상 부서 전체 rows 기준).
function buildActivityAnalysis(report) {
  if (!report || !allActivities) return null;
  const regionOf = {};
  const teacherCountByRegion = {};
  report.rows.forEach(r => {
    regionOf[String(r.memberId).trim()] = r.region || '';
    teacherCountByRegion[r.region || ''] = (teacherCountByRegion[r.region || ''] || 0) + 1;
  });

  const countsByRegion = {}; // region -> { type -> count }
  const totalByRegion = {};
  allActivities.forEach(a => {
    const region = regionOf[String(a.memberId).trim()];
    if (region === undefined) return; // 이 부서 소속 교사가 아님
    if (!isThisMonth(a.submittedAt)) return;
    (a.activities || []).forEach(type => {
      if (!type) return;
      if (!countsByRegion[region]) countsByRegion[region] = {};
      countsByRegion[region][type] = (countsByRegion[region][type] || 0) + 1;
      totalByRegion[region] = (totalByRegion[region] || 0) + 1;
    });
  });

  const regions = Object.keys(teacherCountByRegion);
  const seenTypes = new Set();
  Object.values(countsByRegion).forEach(m => Object.keys(m).forEach(t => seenTypes.add(t)));
  const types = ACTIVITY_OPTIONS.filter(t => seenTypes.has(t))
    .concat([...seenTypes].filter(t => !ACTIVITY_OPTIONS.includes(t)));

  const regionStats = regions.map(region => {
    const total = totalByRegion[region] || 0;
    const teacherCount = teacherCountByRegion[region] || 0;
    return {
      region, total, teacherCount,
      perTeacher: teacherCount > 0 ? total / teacherCount : 0,
      counts: countsByRegion[region] || {}
    };
  }).sort((a, b) => b.total - a.total);

  // 상/중/하 평가 — 교사 1인당 이번 달 활동 건수 기준, 부서 내 지역 순위를 3분위로 나눔.
  const rankOrder = [...regionStats].sort((a, b) => b.perTeacher - a.perTeacher);
  const rankMap = {};
  rankOrder.forEach((r, i) => { rankMap[r.region] = i; });
  const n = rankOrder.length;
  regionStats.forEach(r => {
    if (n <= 1) { r.grade = '-'; return; }
    const i = rankMap[r.region];
    const third = n / 3;
    r.grade = i < third ? '상' : (i < third * 2 ? '중' : '하');
  });

  return { types, regionStats };
}

function buildRoleActivityBreakdown(report) {
  if (!report || !allActivities) return null;
  const regionOf = {};
  report.rows.forEach(r => { regionOf[String(r.memberId).trim()] = r.region || ''; });

  const counts = {}; // counts[region][role][item] = count
  const itemGrandTotal = {};
  let grandTotal = 0;

  allActivities.forEach(a => {
    const region = regionOf[String(a.memberId).trim()];
    if (region === undefined) return; // 이 부서 소속 교사가 아님
    if (!isThisMonth(a.submittedAt)) return;
    const roles = (a.roles || []).filter(r => ROLE_PARTS_DASH.includes(r));
    if (!roles.length) return; // 옛 방식 기록(역할 없음)은 이 표 대상 아님
    roles.forEach(role => {
      (a.activities || []).forEach(item => {
        if (!item) return;
        if (!counts[region]) counts[region] = {};
        if (!counts[region][role]) counts[region][role] = {};
        counts[region][role][item] = (counts[region][role][item] || 0) + 1;
        itemGrandTotal[item] = (itemGrandTotal[item] || 0) + 1;
        grandTotal++;
      });
    });
  });

  const allRegions = report.byRegion.map(r => r.region);

  const regionRoleTotal = {}; // regionRoleTotal[region][role] = 그 지역·역할의 활동 총 건수(그래프1용)
  const regionItemTotal = {}; // regionItemTotal[region][item] = 역할 무관 그 지역·항목 총 건수(그래프2용)
  allRegions.forEach(region => {
    regionRoleTotal[region] = {};
    regionItemTotal[region] = {};
    ROLE_PARTS_DASH.forEach(role => {
      const m = (counts[region] && counts[region][role]) || {};
      regionRoleTotal[region][role] = Object.values(m).reduce((s, v) => s + v, 0);
    });
    ROLE_ACTIVITY_ITEMS_DASH.forEach(item => {
      let sum = 0;
      ROLE_PARTS_DASH.forEach(role => { sum += ((counts[region] && counts[region][role] && counts[region][role][item]) || 0); });
      regionItemTotal[region][item] = sum;
    });
  });

  return { counts, allRegions, regionRoleTotal, regionItemTotal, itemGrandTotal, grandTotal };
}


return [buildActivityAnalysis(report),buildRoleActivityBreakdown(report)];
}
