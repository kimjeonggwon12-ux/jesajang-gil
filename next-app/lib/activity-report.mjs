// 기존 보고의 순수 표시·전송 계약. 이전 HTML과 회귀 비교하며 전역 상태/DOM/외부 전송은 사용하지 않는다.
const ROLE_OPTIONS = ['인도자', '교사', '섬김이', '협력교사'];
    const ROLE_ACTIVITY_ALL = ['피드백', '섭외', '친분', '만남1', '만남2', '상담1', '상담2', '복음방', '센터소개', '센터수강'];
    const ROLE_ACTIVITY_OPTIONS = ['피드백', '섭외', '만남1', '상담1', '상담2', '복음방', '센터수강'];
    const TEACHER_EXTRA_ACTIVITY = '동행교사';
    const ROLES_WITH_EXTRA_ACTIVITY = ['교사'];
    const COOP_ROLE = '협력교사';
    const EXTRA_ACTIVITY_OPTIONS = ['동아리', '식구 복음방', '전도 행사 지원'];
    const COOP_ACTIVITY_OPTIONS = ['피드백', '동아리', '잎사귀', '만남 동행', '밭보기', '은사', '멘토교사', '동행교사', '식구 복음방', '전도 행사 지원', '교육 지원', '특강'];   // 11/3(사용자): 교육 지원·특강 추가
    function activityOptionsForRoles(roles) {
      if (roles.includes(COOP_ROLE)) return COOP_ACTIVITY_OPTIONS;
      return (roles.some(r => ROLES_WITH_EXTRA_ACTIVITY.includes(r)) ? ROLE_ACTIVITY_OPTIONS.concat([TEACHER_EXTRA_ACTIVITY]) : ROLE_ACTIVITY_OPTIONS).concat(EXTRA_ACTIVITY_OPTIONS);
    }
    const ACT_CHIP_LABEL = { '피드백': '섭외자피드백', '섭외': '섭외찾기(전단지)', '만남1': '만남', '센터수강': '센터수강생관리', '동아리': '동호회활동', '동행교사': '동행 복음방' };
    const ROLE_SHORT_LABEL = { '인도자': '인도', '교사': '교사', '섬김이': '섬김', '협력교사': '협력' };
    function roleShortLabel(role) { return ROLE_SHORT_LABEL[role] || role; }
    const REACTION_OPTIONS = ['긍정적', '중립', '부정적'];
    const GENDER_OPTIONS = ['남', '여'];
    const AGE_GROUP_OPTIONS = ['10대', '20대', '30대', '40대', '50대', '60대', '70대이상'];
    const TARGET_STAGES_FALLBACK = ['섭외', '친분', '만남1', '만남2', '상담1', '상담2', '복음방', '센터소개', '센터수강'];
    const ACTIVITY_TO_STAGE = {
      '섭외': '섭외', '친분': '친분', '만남1': '만남1', '만남2': '만남2',
      '상담1': '상담1', '상담2': '상담2', '복음방': '복음방', '센터소개': '센터소개', '센터수강': '센터수강'
    };

export {roleShortLabel,ROLE_OPTIONS,ROLE_ACTIVITY_ALL,COOP_ROLE,COOP_ACTIVITY_OPTIONS,ACT_CHIP_LABEL,ACTIVITY_TO_STAGE,REACTION_OPTIONS,GENDER_OPTIONS,AGE_GROUP_OPTIONS,TARGET_STAGES_FALLBACK,activityOptionsForRoles};
export function createReportTools(context) {
const todayStr=()=>context.today;
const RP_TIER = { '만남1': 'meet', '만남2': 'meet', '상담1': 'edu', '상담2': 'edu', '복음방': 'edu', '센터소개': 'center', '센터수강': 'center' };
const rpTier = item => RP_TIER[item] || 'basic';
function rpTitle(item) {
  if (item === '식구 복음방' || item === '전도 행사 지원') return `${item} 보고`;
  if (item === '동아리') return '동호회 활동 보고';
  if (COOP_ACTIVITY_OPTIONS.includes(item)) return `협력 활동 보고(${item})`;
  if (item === '센터수강') return '센터 수강 관리 보고';
  if (item === '센터소개') return '센터 소개 보고';
  return rpTier(item) === 'edu' ? '상담/복음방 교육 보고' : '일반 전도 보고';
}
const RP_TIER_NOTE = {
  basic: '섭외 단계 보고예요. 아는 칸만 채우고 나머지는 비워 둬도 보고 틀에는 다 표시돼요.',
  meet: '만남 단계 보고예요. 함께한 팀과 연락처 뒷자리까지 적어 주세요.',
  center: '센터 단계 보고예요. 확인 사항과 센터보내기 플랜을 꼭 적어 주세요.',
  edu: '교육 보고예요(클래스 운영처럼) — 교육 제목·횟수·누적 교육까지 적어 주세요.'
};
function rpPrimary(items) {
  const rank = i => ROLE_ACTIVITY_ALL.indexOf(i);
  return items.slice().sort((a, b) => rank(b) - rank(a))[0] || '';
}
const rpTag = v => { const s = String(v || '').trim(); const m = s.match(/^([^\s(（]+)\s*(.*)$/); return !s ? '' : m && /^[가-힣A-Za-z]/.test(m[1]) ? `#${m[1]}${m[2] ? ' ' + m[2] : ''}`.replace(/^#(\S+) \(/, '#$1(') : s; };
const RP_STAGE_MARKS = ['상1', '상2', '복', '확'];
const RP_STAGE_MARK_OF = { '상담1': '상1', '상담2': '상2', '복음방': '복' };
const RP_CHECKS = [['affil', '소속 여부'], ['mapal', '마팔 등록 여부'], ['bible', '성경 오픈 여부'], ['record', '녹음본 제출']];
const RP_TEAM = [['leader', '인도자', '🔸'], ['mentor', '멘토교사', '🔸'], ['teacher', '교사', '🔸'], ['counselor', '상담사', '🔸'], ['helper', '섬김이', '🔸'], ['leaf', '잎사귀', '🔸'], ['comm', '소통자', '🫂']];
const RP_TEAM_MEET = ['leader', 'teacher', 'helper'];
const RP_ROLE_TEAM = { '인도자': 'leader', '교사': 'teacher', '섬김이': 'helper' };
const RP_PLAN = [['mapal', '마팔등록일'], ['teacherIntro', '교사소개'], ['bibleRoom', '성경으로 복음방'], ['centerIntro', '센터소개'], ['interview', '인터뷰/수강카드작성']];
const RP_FAITH = ['무교', '기신', '입탈', '타종교', '천주교', '불교'];
const RP_RECRUIT = ['가족', '친척', '지인', '직장', '이웃', '학교', '길거리', 'SNS', '기타'];
const RP_WEEKLY = ['주 1회', '주 2회', '주 3회'];
function rpEmpty() { return { center: '', enroll: '', cohortNo: '', course: '', age: '', phone4: '', faith: '', recruitType: '', stageMark: '', checks: {}, team: {}, time: '', eduTotal: '', eduWeekly: '', nextDate: '', request: '', plan: {}, lessons: [] }; }
function rpFromTarget(t) {
  const p = (t && t.reportProfile) || {};
  return { ...rpEmpty(), center: p.center || '', enroll: p.enroll || (t && t.goalCohort ? String(Number(t.goalCohort.slice(5))) : ''), cohortNo: p.cohortNo || '', course: p.course || '', age: p.age || '', phone4: p.phone4 || '', faith: p.faith || '', recruitType: p.recruitType || '',
    stageMark: p.stageMark || '', checks: { ...(p.checks || {}) }, team: { ...(p.team || {}) }, eduWeekly: p.eduWeekly || '',
    plan: { ...(p.plan || {}) }, lessons: Array.isArray(p.lessons) ? p.lessons.slice() : [] };
}
const rpSelf = () => { const nm = String(context.name || '').trim(), id = context.memberId; return nm ? `${nm}(${id})` : id; };
function rpSyncSelf(f) {
  const auto = f.rpAuto || (f.rpAuto = {});
  Object.entries(RP_ROLE_TEAM).forEach(([role, k]) => {
    const on = f.roles.includes(role);
    if (on && !f.rp.team[k] && !auto[k]) { f.rp.team[k] = rpSelf(); auto[k] = true; }
    if (!on && auto[k] && f.rp.team[k] === rpSelf()) { f.rp.team[k] = ''; auto[k] = false; }
  });
}
function rpAgeGroup(n) {
  n = Number(n); if (!n) return '';
  return n >= 70 ? '70대이상' : n < 20 ? '10대' : `${Math.floor(n / 10) * 10}대`;
}
const RP_WD = ['일', '월', '화', '수', '목', '금', '토'];
function rpDateText(d, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) return time || '';
  const x = new Date(d + 'T00:00:00');
  return `${x.getMonth() + 1}월 ${x.getDate()}일(${RP_WD[x.getDay()]}요일)${time ? ' ' + time : ''}`;
}
const rpIsEnrolled = f => f.activityItem === '센터수강';
const rpSent = f => rpIsEnrolled(f) || f.targetStage === '센터수강';   // 이미 센터에 보낸 사람
function rpEnrollMonths() {   // 이번 달부터 거꾸로 12달: '10', '9', … (수강 중인 기수는 지난 달들)
  const m = Number(todayStr().slice(5, 7));
  return Array.from({ length: 12 }, (_, k) => String((m - 1 - k + 12) % 12 + 1));
}
const rpEnrollText = v => v === 'none' ? '해당 없음' : v ? `${v}월 수강자` : '';
const RP_COURSES = ['초등', '중등', '고등', '수료'];
const rpCenterName = c => { const v = String(c || '').trim(); return !v ? '' : /센터$/.test(v) ? v : v + '센터'; };
function rpEnrollLine(p, withCourse = true) {
  p = p || {};
  const parts = [p.enroll && p.enroll !== 'none' ? `${p.enroll}월 개강` : '', rpCenterName(p.center), p.cohortNo ? `${String(p.cohortNo).replace(/기$/, '')}기` : ''].filter(Boolean);
  if (!parts.length) return '';
  return `${parts.join(' ')} 수강 중${withCourse && p.course ? ` (${p.course}${p.course === '수료' ? '' : ' 과정'})` : ''}`;
}
const rpMD = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? `${Number(d.slice(5, 7))}월 ${Number(d.slice(8))}일` : '';
const rpSlash = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? `${Number(d.slice(5, 7))}/${Number(d.slice(8))}` : '';
const rpDash = v => { const ls = String(v || '').split('\n').map(x => x.trim()).filter(Boolean); return ls.length ? ls.map(x => '-' + x).join('\n') : '-'; };
function rpDept() {
  const d = String(context.dept || '').trim();
  return !d ? '' : /(회|부)$/.test(d) ? d : d + '회';
}
const rpTitleOf = l => String(typeof l === 'string' ? l : l?.title || '').trim();
const rpTodayAt = f => { const n = (f.rp.lessons || []).length; return f.rpTodayAt == null ? n : Math.min(f.rpTodayAt, n); };
function rpLessonSlots(f) {
  const ls = f.rp.lessons || [], at = rpTodayAt(f), cur = String(f.extraTitle || '').trim();
  const before = ls.slice(0, at).map((l, i) => ({ i })), after = ls.slice(at).map((l, k) => ({ i: at + k }));
  const lastBefore = [...ls.slice(0, at)].reverse().map(rpTitleOf).find(Boolean);
  return before.concat(cur && lastBefore !== cur ? [{ today: true }] : [], after);
}
function rpLessons(f) {
  return rpLessonSlots(f).map(x => x.today ? String(f.extraTitle || '').trim() : rpTitleOf(f.rp.lessons[x.i])).filter(Boolean);
}
function rpAutoChecks(f) {
  const nm = f.targetName.trim(); if (!nm) return null;
  const t = (context.targets || []).find(x => String(x.targetName || '').trim() === nm);
  const fbN = context.overview?.people.find(p => p.name === nm)?.feedbackCount || 0;
  const goal = (t && t.goalCohort) || (!rpIsEnrolled(f) && f.goalCohort) || '';
  return { fb: fbN > 0, fbN, plan: !!(t && t.goalPlan), goal: goal ? `${Number(goal.slice(5))}월 개강` : '' };
}
function rpReportText(f) {
  const r = f.rp, item = f.activityItem, ck = k => (r.checks || {})[k] || '';
  const gm = Number((f.goalCohort || f.date || todayStr()).slice(5, 7));
  const head = rpIsEnrolled(f) ? `수강 : ${rpEnrollLine(r) || rpEnrollText(r.enroll)}` : `${gm}월 목표 센터 : ${r.center || ''}`;
  const lessons = rpLessons(f);
  const line = '━━━━━━━━━━━━━━';
  const li = (k, v) => `• ${k} : ${v == null ? '' : v}`;
  const dash = v => rpDash(v).split('\n').map(x => '   ' + x);
  const items = (f.items && f.items.length ? f.items : [item]).filter(Boolean);
  return [
    `🗓 날짜 : ${rpDateText(f.date, r.time)}`, '',
    `📋 ${rpTitle(item)}`, `🏛 ${rpDept() || '부서'}  |  ${head}`,
    `🔖 역할 · 활동 : ${(f.roles || []).join('·') || '-'} / ${items.join(', ') || '-'}`, line, '',
    '✅ 확인 사항',
    li('① 소속 여부', ck('affil')), li('② 단계 여부 (상1·상2 / 복·확)', r.stageMark || ''), li('③ 마팔 등록 여부', ck('mapal')),
    li('④ 성경 오픈 여부', ck('bible')), li('⑤ 녹음본 제출', ck('record')),
    ...(ac => [li('⑥ 단상 피백 여부', ac ? (ac.fb ? `O (${ac.fbN}회)` : 'X') : ''), li('⑦ 개강 피백 여부', ac ? (ac.plan ? 'O' : 'X') : ''),
      li('⑧ 개강 목표', ac ? ac.goal || 'X' : '')])(rpAutoChecks(f)), '',
    '👤 수강생',
    li('이름', `${rpTag(f.targetName)} (${f.targetGender || '-'} / ${r.age ? r.age + '세' : f.targetAgeGroup || '-'})`),
    li('전화번호 뒷자리', r.phone4 || ''), li('신앙', r.faith || ''), li('섭외유형', r.recruitType || ''), '',
    '🤝 함께하는 팀', ...RP_TEAM.map(([k, l]) => li(l, k === 'comm' ? (r.team || {})[k] || '' : rpTag((r.team || {})[k]))), '',
    '📖 교육',
    li('총횟수', r.eduTotal ? r.eduTotal + '회' : ''), li('주중횟수', r.eduWeekly || ''), li('제목', f.extraTitle.trim()),
    '• 내용', ...dash(f.todayWork), '• 반응', ...dash([f.reaction, f.reactionNote.trim()].filter(Boolean).join(' — ')), '',
    '➡️ 다음 계획',
    li('차후 교육 주제', f.nextWork.trim()), li('다음 교육 날짜', rpSlash(r.nextDate)), li('요청사항', r.request.trim()), '',
    '📚 누적 교육 제목', ...Array.from({ length: Math.max(5, lessons.length + 1) }, (_, i) => `${i + 1}. ${lessons[i] || ''}`), '',
    `🏁 센터보내기 플랜${rpSent(f) ? '' : ' (예정)'}`, ...RP_PLAN.map(([k, l]) => li(l, rpMD((r.plan || {})[k]))),
    '※ 위 항목 외에 필요한 사항은 섭외자에 맞게 계획 세우기', line,   // 보고자는 보고방에 올릴 때 서버가 맨 위에 굵게 붙인다(report-room.js)
  ].join('\n');
}
function rpPayload(f) {
  const r = f.rp, tier = rpTier(f.activityItem);
  const p = { tier, title: rpTitle(f.activityItem), age: r.age, faith: r.faith, recruitType: r.recruitType, time: r.time, nextDate: r.nextDate, request: r.request.trim(),
    phone4: r.phone4, team: r.team, checks: r.checks, stageMark: r.stageMark, plan: r.plan, eduTotal: r.eduTotal, eduWeekly: r.eduWeekly, lesson: f.extraTitle.trim() };
  if (f.rpLessonsEdited) p.lessons = rpLessonSlots(f).map(x => x.today ? { date: f.date, title: String(f.extraTitle || '').trim() } : { date: (r.lessons[x.i] && r.lessons[x.i].date) || f.date, title: rpTitleOf(r.lessons[x.i]) }).filter(l => l.title);   // 11/10: 오늘 제목도 그 자리에
  if (rpIsEnrolled(f)) Object.assign(p, { enroll: r.enroll, center: r.center, cohortNo: r.cohortNo, course: r.course }); else p.center = r.center;
  return p;
}

return {RP_TIER_NOTE,rpEmpty,rpFromTarget,rpSyncSelf,rpAgeGroup,rpTitle,rpTier,rpPrimary,rpIsEnrolled,rpSent,rpEnrollMonths,rpEnrollLine,rpLessonSlots,rpTodayAt,rpLessons,rpPayload,rpReportText,rpAutoChecks,RP_CHECKS,RP_TEAM,RP_PLAN,RP_FAITH,RP_RECRUIT,RP_WEEKLY,RP_COURSES,RP_STAGE_MARKS,RP_STAGE_MARK_OF};
}
