// 교사 명단 엑셀: 서버에서 교육·전도 담당자 권한을 확인한다. 기존 다운로드 비밀번호는 추가 확인으로 유지한다.
//   비밀번호는 Vercel 환경값 TEACHER_EXPORT_PW(코드·저장소에 두지 않음). 계정별 하루 5번 틀리면 그날은 잠김. 파일 준비가 alert_log 에 남는다.
import { db, run } from '../lib/db.js';
import {sensitiveActor} from '../lib/sensitive-actor.js';
import { kstDate, kstDateTime } from '../lib/util.js';
import { zip } from '../lib/zip.js';
import { workbookFiles } from '../lib/xlsx-multi.js';
import { loadRoster, requireApprover } from './roster.js';
import tiers from './tiers.js';
import calendar from './calendar.js';
import {calendarCsv} from '../../shared/calendar-export.js';
import {nonParticipantSheets} from '../../shared/non-participant-export.js';

const DEPT_ORDER = ['교역자', '자문회', '장년회', '부녀회', '청년회', '기타'];
const bucket = (d) => (DEPT_ORDER.slice(0, 5).includes(String(d || '').trim()) ? String(d).trim() : '기타');
const STYLE = { head: 1, cell: 2, title: 3, total: 7, text: 8 };
const cell = (v, s = STYLE.cell) => ({ v, s });
const byRegion = (a, b) => String(a).localeCompare(String(b), 'ko', { numeric: true });

async function beginExport(body,action) {
  await requireApprover();
  const password=process.env.TEACHER_EXPORT_PW;
  if(!password)return {error:'다운로드 비밀번호가 아직 설정되지 않았어요.'};
  const identity=await sensitiveActor();
  const result=await run(db().rpc('teacher_export_guard',{p:{...identity,action,stage:'check',passwordOk:String(body.password||'')===password}}));
  return result.error?result:{identity,action};
}
async function readyExport(check,fileName,bytes,scope) {
  // 자료를 만드는 동안 보직/PIN이 바뀌면 파일 본문을 반환하지 않는다. 감사 기록 실패도 동일하다.
  const result=await run(db().rpc('teacher_export_guard',{p:{...check.identity,action:check.action,stage:'ready',passwordOk:true,
    summary:JSON.stringify({fileName,...scope})}}));
  return result.error?result:{ok:true,fileName,base64:Buffer.from(bytes).toString('base64')};
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
  const check=await beginExport(body,'exportTeacherList');if(check.error)return check;
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
  return readyExport(check,fileName,bytes,{dept,region,period,people:region?inDept.filter(p=>(p.region||'지역 없음')===region).length:inDept.length});
}

export default { exportTeacherList, exportRosterSheet, exportNonParticipants, exportCalendarAttendees };

/** 원본 명단의 15개 열. 검색/페이지와 무관하며 기존 관리자 엑셀과 같은 값을 담는다. */
async function exportRosterSheet(body) {
  const check=await beginExport(body,'exportRosterSheet');if(check.error)return check;
  const people = await loadRoster();
  const head = ['고유번호','이름','부서','지역','소속','직책','등급','소속 비고','등급 변경일','센터등록','센터미등록','상담','복음방','동행교사','활동 상태'];
  const rows = [head.map(h=>cell(h,STYLE.head)),...people.map(r=>[r.memberId,r.name,r.dept,r.region,r.affiliation,r.position,r.tier,r.note,r.tierChangedAt,r.regLeads,r.unregLeads,r.counsel,r.gospelRoom,r.companion,r.activeState].map(v=>cell(v??'')))];
  const fileName = `교사명단_${kstDate()}.xlsx`;
  const bytes = zip(workbookFiles([{name:'교사명단',rows,opts:{widths:[18,9,9,9,16,16,9,16,12,9,10,7,7,9,10],freezeRow:1}}]),fileName);
  return readyExport(check,fileName,bytes,{people:people.length});
}

/** 미활동/교육 불참/모두 0회: 화면 검색·페이지와 관계없이 선택 부서 전체를 받는다. */
async function exportNonParticipants(body) {
  const check=await beginExport(body,'exportNonParticipants');if(check.error)return check;
  const dept=String(body.dept||'');
  if(dept&&!DEPT_ORDER.includes(dept))return {error:'다운로드할 부서를 확인해 주세요.'};
  const report=await tiers.getNonParticipants({});
  const sheets=nonParticipantSheets(report,dept).map(({name,rows})=>({name,
    rows:rows.map((row,index)=>row.map(value=>cell(value,index===0?STYLE.title:index===2?STYLE.head:STYLE.cell))),
    opts:{widths:[6,10,9,9,10,12,12],freezeRow:3},
  }));
  const fileName=`미활동_교육불참_${dept||'전체'}_${report.asOf}.xlsx`;
  const bytes=zip(workbookFiles(sheets),fileName);
  return readyExport(check,fileName,bytes,{dept,asOf:report.asOf,sheets:sheets.map(s=>s.name)});
}

/** 행사 참석자 전체: 명단 엑셀과 같은 권한·비밀번호·감사 기록. */
async function exportCalendarAttendees(body) {
  const check=await beginExport(body,'exportCalendarAttendees');if(check.error)return check;
  const report = await calendar.getCalendarReport(body); if (report.error) return report;
  const fileName = '세미나_참석자_집계.csv';
  return readyExport(check,fileName,Buffer.from(calendarCsv(report.attendees),'utf8'),{eventId:body.eventId||'전체',people:report.total});
}
