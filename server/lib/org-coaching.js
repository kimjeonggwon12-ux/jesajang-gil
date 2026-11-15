// 현재 HTML 전체 현황 AI 입력의 수치·원문 번호 매칭·선택적 결산 계약.
const ORG_MAIN_DEPTS = ['교역자', '자문회', '장년회', '부녀회', '청년회'];
const ORG_DEPTS = [...ORG_MAIN_DEPTS, '기타'];
const orgBucket = dept => ORG_MAIN_DEPTS.includes(dept) ? dept : '기타';
function daysDiff(a, b) {
  return (new Date(b) - new Date(a)) / (1000 * 60 * 60);
}

// "전체 현황"의 핵심 지표 4개를 임의의 rows 부분집합에 대해 계산 — 전체 합계와 부서별 분해에 공용.
function computeFeedbackStats(subRows) {
  const total = subRows.length;
  if (total === 0) return { total: 0, answeredCount: 0, aiPct: 0, escPct: 0, avgHours: '-' };
  const aiDone = subRows.filter(r => r.source === 'AI셀프코칭' && r.status === '완료').length;
  const escalated = subRows.filter(r => r.source === '사람에스컬레이션').length;
  const answered = subRows.filter(r => r.source === '사람에스컬레이션' && r.status === '완료' && r.answeredAt);
  const answeredCount = subRows.filter(r => r.status === '완료').length; // 2026-09-15: "답변 완료" 컬럼용(부서별 현황)
  const avgHours = answered.length
    ? (answered.reduce((sum, r) => sum + daysDiff(r.submittedAt, r.answeredAt), 0) / answered.length).toFixed(1)
    : '-';
  return { total, answeredCount, aiPct: Math.round(aiDone / total * 100), escPct: Math.round(escalated / total * 100), avgHours };
}
function buildRosterStats(roster, rosterTiers) {
  // 부서는 교역자/자문회/장년회/부녀회/청년회/기타 6개 조직 버킷으로 묶어서 집계
  // (district-dashboard.html/백엔드 _orgBucket_ 과 동일 규칙 — 원본 '부서' 값이 그대로 노출되지 않게).
  const deptCounts = {};
  roster.forEach(r => {
    const d = orgBucket(r.dept);
    deptCounts[d] = (deptCounts[d] || 0) + 1;
  });
  const deptLabels = Object.keys(deptCounts).sort((a, b) => deptCounts[b] - deptCounts[a]);

  // 교사구분: 백엔드가 내려준 참고 목록 순서를 우선 사용 (하드코딩 방지),
  // 목록에 없는 값이 실제로 존재하면 뒤에 추가로 붙임.
  const tierCounts = {};
  roster.forEach(r => {
    const t = r.tier || '(미분류)';
    tierCounts[t] = (tierCounts[t] || 0) + 1;
  });
  const tierLabels = rosterTiers.slice();
  Object.keys(tierCounts).forEach(t => { if (!tierLabels.includes(t)) tierLabels.push(t); });

  // 부서(버킷) × 교사구분 교차 집계 — "부서별 등록 교사 수" 누적 막대그래프용.
  const deptTierCounts = {};
  deptLabels.forEach(d => { deptTierCounts[d] = {}; });
  roster.forEach(r => {
    const d = orgBucket(r.dept);
    const t = r.tier || '(미분류)';
    deptTierCounts[d][t] = (deptTierCounts[d][t] || 0) + 1;
  });

  return { deptLabels, deptCounts, deptTierCounts, tierLabels, tierCounts };
}
function buildOrgSnapshot(roster, rosterTiers, rows, settlement = null) {
  const s = buildRosterStats(roster, rosterTiers);
  const snapshot = {
    총교사수: roster.length,
    부서별_교사수: s.deptLabels.map(d => ({ 부서: d, 인원: s.deptCounts[d] })),
    부서별_등급분포: s.deptLabels.map(d => ({ 부서: d, ...s.deptTierCounts[d] }))
  };
  if (settlement && !settlement.error) {
    snapshot.이번달_결산 = {
      승급대상: settlement.promotionsTotal || 0, 강등대상: settlement.demotionsTotal || 0,
      허가대기: settlement.pendingApprovalCount || 0, 비활동자: settlement.inactiveTotal || 0,
      센터인도_상위: (settlement.leaders || []).slice(0, 10).map(l => ({ 이름: l.name, 지역: l.region, 건수: l.leadCount }))
    };
  }
  if (rows.length > 0) {
    const memberDeptMap = {};
    roster.forEach(r => { memberDeptMap[String(r.memberId).trim()] = orgBucket(r.dept); });
    snapshot.피드백_전체 = computeFeedbackStats(rows);
    snapshot.피드백_부서별 = ORG_DEPTS.map(d => {
      const subRows = rows.filter(r => memberDeptMap[String(r.memberId).trim()] === d);
      return { 부서: d, ...computeFeedbackStats(subRows) };
    });
  }
  return snapshot;
}
export {computeFeedbackStats,buildRosterStats,buildOrgSnapshot};
