// 명단 화면 전용: 기존 보고 계산·정렬·필터를 그대로 서버로 옮긴다.
// 전역 사례 순위/등급 제안은 전체 자료로 계산해야 하므로 DB 집계 전환은 별도 단계다.
import { loadRoster, forgetRoster, TEACHER_TIERS } from './roster.js';
import tiers from './tiers.js';
import { directorySnapshot } from '../lib/directory-cache.js';
import { requireActor, AccessError } from '../lib/request-context.js';
const MAIN = ['교역자', '자문회', '장년회', '부녀회', '청년회'];
const ADMIN = ['회장', '총무', '지역장', '섭외 교관', '복음방 교관', '교육부장', '전도부장', '전도과장', '전도팀장', '서기', '전도 과장', '교육 과장', '교관', '총교관', '교육부'];
const bucket = d => MAIN.includes(d) ? d : '기타';
const admin = t => ADMIN.includes(String(t.position || '').trim());
const compare = (a, b) => (a.dept || '').localeCompare(b.dept || '', 'ko')
  || (a.region || '').localeCompare(b.region || '', 'ko', { numeric: true })
  || (a.name || '').localeCompare(b.name || '', 'ko')
  || (a.memberId || '').localeCompare(b.memberId || '');
async function snapshot() {
  const [roster, report] = await Promise.all([loadRoster(), tiers.getTeacherListReport()]);
  const reports = new Map(report.rows.map(r => [String(r.memberId), r]));
  return roster.map(t => {
    const r = reports.get(String(t.memberId));
    return r ? { ...t, ...r, affilSel: r.affil, genderSel: r.gender, _rep: true } : t;
  }).sort(compare);
}
export async function getTeacherDirectory(body = {}) {
  requireActor(); // getRoster/getTeacherListReport와 동일한 전체 조회 범위. 수정 권한과 무관.
  const query = String(body.query || '').trim().toLowerCase();
  if (query.length > 120) throw new AccessError('검색어는 120자까지 입력해 주세요.', 400);
  const limit = body.all === true ? 0 : Number(body.limit ?? 20);
  const requestedPage = Number(body.page ?? 1);
  if ((limit !== 0 && ![20, 50].includes(limit)) || (limit === 0 && body.all !== true)
    || !Number.isSafeInteger(requestedPage) || requestedPage < 1) throw new AccessError('페이지 정보를 확인해 주세요.', 400);
  if (body.refresh === true) forgetRoster();
  const all = await directorySnapshot(snapshot, body.refresh === true);
  const scope = all.filter(t => !body.dept || bucket(t.dept) === body.dept);
  const rows = scope.filter(t => (!query || [t.name, t.memberId, t.region, t.dept, t.position, t.tier].some(v => String(v || '').toLowerCase().includes(query)))
    && (!body.region || t.region === body.region)
    && (!body.adminOnly || admin(t)) && (!body.tier || t.tier === body.tier)
    && (body.apply !== 'yes' || (t._rep && !!t.apply)) && (body.apply !== 'no' || (t._rep && !t.apply))
    && (!body.pendingOnly || !!t.suggestion)
    && (!(Number(body.minLeads) > 0) || (t._rep && (t.leads1y || 0) >= Number(body.minLeads))));
  const total = rows.length, pages = limit ? Math.max(1, Math.ceil(total / limit)) : 1;
  const page = Math.min(requestedPage, pages), offset = limit ? (page - 1) * limit : 0;
  const regionsByDept = {};
  for (const t of all) (regionsByDept[bucket(t.dept)] ||= new Set()).add(t.region || '지역 없음');
  for (const d of Object.keys(regionsByDept)) regionsByDept[d] = [...regionsByDept[d]].sort((a,b) => a.localeCompare(b, 'ko', { numeric: true }));
  return { rows: limit ? rows.slice(offset, offset + limit) : rows, total, page, pages, limit, tiers: TEACHER_TIERS,
    regionsByDept, adminCount: scope.filter(admin).length, pendingTotal: scope.filter(t => t.suggestion).length };
}
export default { getTeacherDirectory };
