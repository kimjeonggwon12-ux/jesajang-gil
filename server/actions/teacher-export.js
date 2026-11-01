// 교사 명단 엑셀 받기(11/1) — 사용자: "부서별·지역별 또는 부서 전체를 한 엑셀 파일로, 다운로드는 비밀번호 — 김논 서무님 1명만"
//   비밀번호는 Vercel 환경값 TEACHER_EXPORT_PW(코드·저장소에 두지 않음). 하루 5번 틀리면 그날은 잠김. 받을 때마다 alert_log 에 남는다.
import { db, run } from '../lib/db.js';
import { kstDate, kstDateTime } from '../lib/util.js';
import { zip } from '../lib/zip.js';
import { workbookFiles } from '../lib/xlsx-multi.js';
import { loadRoster } from './roster.js';
import tiers from './tiers.js';

const MAX_FAILS = 5;
const DEPT_ORDER = ['교역자', '자문회', '장년회', '부녀회', '청년회', '기타'];
const bucket = (d) => (DEPT_ORDER.slice(0, 5).includes(String(d || '').trim()) ? String(d).trim() : '기타');
const STYLE = { head: 1, cell: 2, title: 3, total: 7, text: 8 };
const cell = (v, s = STYLE.cell) => ({ v, s });
const byRegion = (a, b) => String(a).localeCompare(String(b), 'ko', { numeric: true });

const logRow = (summary, ok, key) => run(db().from('alert_log').insert({ sent_at: kstDateTime().slice(0, 16), kind: '명단엑셀', summary, ok, dedup_key: key }));

async function checkPassword(body) {
  const pw = process.env.TEACHER_EXPORT_PW;
  if (!pw) return '다운로드 비밀번호가 아직 설정되지 않았어요.';
  const failKey = 'exportFail:' + kstDate();
  const fails = await run(db().from('alert_log').select('id').eq('dedup_key', failKey));
  if (fails.length >= MAX_FAILS) return '오늘은 비밀번호를 너무 많이 틀려서 잠겼어요. 내일 다시 해 주세요.';
  if (String(body.password || '') !== pw) {
    await logRow(`비밀번호 틀림 · ${String(body.name || '')} ${String(body.memberId || '')}`, false, failKey);
    return `비밀번호가 맞지 않아요. (오늘 ${MAX_FAILS - fails.length - 1}번 더 할 수 있어요)`;
  }
  return '';
}

// 활동 항목 칸의 기간: this = 이번 달, prev = 지난 달, all = 누적
const PERIODS = { this: ['이번 달', 'monthlyCount', 'groupsMonth'], prev: ['지난 달', 'prevCount', 'groupsPrev'], all: ['누적', 'actTotal', 'groups'] };

function sheet(title, people, groups, period) {
  const [plabel, countKey, groupKey] = PERIODS[period];
  const head = ['번호', '부서', '지역', '이름', '고유번호', '등급', '직책', '명함', `활동 기록(${plabel})`, ...groups, '사례', '접속', '출석(최근 1개월)', '누적 기록', '마지막 활동일', '센터 등록(1년)'];
  const rows = [[cell(title, STYLE.title)], [cell(`${kstDateTime().slice(0, 16)} 기준 · ${people.length}명 · 활동 항목 칸은 ${plabel} 건수`, STYLE.text)], [],
    head.map((h) => cell(h, STYLE.head))];
  const sum = new Array(head.length).fill(0);
  people.forEach((p, i) => {
    const r = p.rep || {};
    const nums = [r[countKey] || 0, ...groups.map((g) => (r[groupKey] || {})[g] || 0), r.cases || 0, r.visits || 0, r.attend1m || 0, r.actTotal || 0];
    nums.forEach((n, k) => { sum[8 + k] += n; });
    rows.push([cell(i + 1), cell(p.dept || ''), cell(p.region || ''), cell(p.name || ''), cell(p.memberId || ''), cell(p.tier || ''), cell(p.position || ''),
      cell(r.card ? '등록' : ''), ...nums.map((n) => cell(n)), cell(r.lastActivityDate || ''), cell(p.regLeads != null && p.regLeads !== '' ? Number(p.regLeads) || 0 : (r.leads1y || 0))]);
  });
  rows.push([cell('합계', STYLE.total), ...new Array(7).fill(0).map(() => cell('', STYLE.total)), ...sum.slice(8, 8 + 5 + groups.length).map((n) => cell(n, STYLE.total))]);
  const last = String.fromCharCode(64 + head.length);
  return { rows, opts: { widths: [6, 8, 9, 10, 17, 9, 12, 7, 10, ...groups.map(() => 8), 7, 7, 9, 9, 12, 9], merges: [`A1:${last}1`, `A2:${last}2`], freezeRow: 4, heights: { 0: 26 } } };
}

/** { action:'exportTeacherList', password, dept('' = 전체), region('' = 부서 전체 + 지역별 시트) } → { fileName, base64 } */
async function exportTeacherList(body) {
  const err = await checkPassword(body);
  if (err) return { error: err };
  const dept = String(body.dept || '').trim(), region = String(body.region || '').trim();
  const period = PERIODS[body.period] ? body.period : 'this';
  const [roster, report] = await Promise.all([loadRoster(), tiers.getTeacherListReport()]);
  const repOf = new Map(report.rows.map((r) => [String(r.memberId), r]));
  const groups = report.groups || [];
  const all = roster.map((p) => ({ ...p, rep: repOf.get(String(p.memberId)) }));
  const inDept = dept ? all.filter((p) => bucket(p.dept) === dept) : all;
  const sheets = [];
  if (!dept) {
    sheets.push({ name: '전체', ...sheet('교사 명단 — 전체', all, groups, period) });
    for (const d of DEPT_ORDER) { const ps = all.filter((p) => bucket(p.dept) === d); if (ps.length) sheets.push({ name: d, ...sheet(`교사 명단 — ${d}`, ps, groups, period) }); }
  } else if (!region) {
    sheets.push({ name: `${dept} 전체`, ...sheet(`교사 명단 — ${dept} 전체`, inDept, groups, period) });
    const regions = [...new Set(inDept.map((p) => p.region || '지역 없음'))].sort(byRegion);
    for (const g of regions) sheets.push({ name: g, ...sheet(`교사 명단 — ${dept} ${g}`, inDept.filter((p) => (p.region || '지역 없음') === g), groups, period) });
  } else {
    sheets.push({ name: region, ...sheet(`교사 명단 — ${dept} ${region}`, inDept.filter((p) => (p.region || '지역 없음') === region), groups, period) });
  }
  if (!sheets[0].rows.length || (region && sheets[0].rows.length <= 5)) return { error: '그 조건에 맞는 교사가 없어요.' };
  const fileName = `교사명단_${dept || '전체'}${region ? '_' + region : ''}_${PERIODS[period][0].replace(' ', '')}_${kstDate()}.xlsx`;
  const bytes = zip(workbookFiles(sheets), fileName);
  await logRow(`받음 · ${fileName} · ${String(body.name || '')} ${String(body.memberId || '')}`, true, 'exportOk:' + Date.now());
  return { ok: true, fileName, base64: Buffer.from(bytes).toString('base64') };
}

export default { exportTeacherList };
