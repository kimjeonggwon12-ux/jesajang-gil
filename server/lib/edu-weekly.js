// 화요전도단·목요사명자교육 주간 현황 계산(2026-11-16). 순수 함수 — A(HTML)·B(Next.js)는 서버가 만든 숫자를 그대로 그린다.
// 기존 기준 보존(EDUCATION.md):
//  - 참석 = 어느 타임이든 출석(오전·저녁 두 번 와도 1명). 지각은 참석의 일부 → 정시 = 참석 − 지각.
//  - 실제 참석이 공무보다 우선. 공무 = 미참석 + 공무 명단(#excused). 불참 = 재적 − 참석 − 공무.
//  - 참석률 = 참석 ÷ 재적(공무도 분모에 포함). 네 칸(정시·지각·공무·불참)의 합 = 재적.
import { CARD_ROWS } from './edu-attendance.js';

const isLate = (r) => !!r && /지각/.test(r.late || '');
const lateMin = (r) => Number((String(r?.late || '').match(/(\d+)분/) || [])[1]) || 0;
export const pct = (a, b) => (b ? (Math.round((a / b) * 1000) / 10).toFixed(1) + '%' : '-');

export function statusOf(p, sessions, ex) {
  const came = sessions.filter((s) => p.att[s]);
  if (came.length) {
    const late = came.filter((s) => isLate(p.att[s]));
    return { status: late.length ? '지각' : '참석', sessions: came, lateMin: late.map((s) => lateMin(p.att[s])) };
  }
  return { status: ex.has(p.nid) ? '공무' : '불참', sessions: [], lateMin: [] };
}

export function tally(key, label, list, sessions, ex) {
  const t = { key, label, n: list.length, came: 0, onTime: 0, late: 0, excused: 0, absent: 0, by: {} };
  for (const s of sessions) t.by[s] = list.filter((p) => p.att[s]).length;
  for (const p of list) {
    const st = statusOf(p, sessions, ex).status;
    if (st === '참석') { t.came++; t.onTime++; }
    else if (st === '지각') { t.came++; t.late++; }
    else if (st === '공무') t.excused++;
    else t.absent++;
  }
  t.rate = pct(t.came, t.n);
  return t;
}

const DEPT_SUB = ['자문회', '장년회', '부녀회', '청년회'];
const regionKey = (r) => { const s = String(r || '').trim(); const m = s.match(/^0*(\d+)지역$/); return m ? Number(m[1]) + '지역' : (s || '기타'); };
const regionNum = (k) => Number((k.match(/^(\d+)지역$/) || [])[1]) || 99;
const affOf = (p) => p.affiliation || '기타';

/** 조직(묶음) 정의. basis 'full' = 교육 재적 전체(기존 카드 순서), '24' = 24부서 재적만(소속 부서별). */
export function groupDefs(people, basis) {
  if (basis === 'full') return CARD_ROWS.map(([label, depts]) => ({ key: label, label, test: (p) => depts.includes(p.dept) }));
  return affiliations(people).map((a) => ({ key: '24부서/' + a.name, label: a.name, test: (p) => p.dept === '24부서' && affOf(p) === a.name }));
}

/** 24부서 소속 목록(부서 번호 = 구역 칸 순, 기존 deptDefs 와 같은 정렬). */
export function affiliations(people) {
  const list = people.filter((p) => p.dept === '24부서');
  const num = (a) => Number(list.find((p) => affOf(p) === a)?.district) || 99;
  return [...new Set(list.map(affOf))].sort((a, b) => num(a) - num(b) || (a < b ? -1 : 1)).map((name) => ({ name, no: num(name) }));
}

/** 한 묶음의 하위 줄(24부서 → 소속, 자문·장년·부녀·청년 → 지역, 그 외 → 없음). */
export function subDefs(people, group) {
  const list = people.filter(group.test);
  if (list.every((p) => p.dept === '24부서') && list.length) return affiliations(list).map((a) => ({ key: '24부서/' + a.name, label: a.name, test: (p) => affOf(p) === a.name }));
  if (list.length && list.every((p) => DEPT_SUB.includes(p.dept))) {
    const keys = [...new Set(list.map((p) => p.dept + '/' + regionKey(p.region)))].sort((a, b) => {
      const [da, ra] = a.split('/'), [db, rb] = b.split('/');
      return DEPT_SUB.indexOf(da) - DEPT_SUB.indexOf(db) || regionNum(ra) - regionNum(rb) || (ra < rb ? -1 : 1);
    });
    const multi = new Set(list.map((p) => p.dept)).size > 1;
    return keys.map((k) => ({ key: k, label: multi ? k.replace('/', ' ') : k.split('/')[1], test: (p) => p.dept + '/' + regionKey(p.region) === k }));
  }
  return [];
}

/** 화면·내보내기 공통 요약. people 는 eduPeople() 결과(제외 직책 빠지고 att 붙은 재적). */
export function weeklySummary(people, sessions, ex, basis) {
  const rows = groupDefs(people, basis).map((g) => tally(g.key, g.label, people.filter(g.test), sessions, ex)).filter((r) => r.n);
  return { rows, total: tally('total', '종합', people, sessions, ex) };
}

export function weeklyDetail(people, sessions, ex, group) {
  const list = people.filter(group.test);
  const subs = subDefs(people, group);
  return {
    rows: subs.map((s) => tally(s.key, s.label, list.filter(s.test), sessions, ex)).filter((r) => r.n),
    total: tally(group.key, group.label, list, sessions, ex),
    people: list.map((p) => ({ memberId: p.nid, name: p.name, dept: p.dept, sub: p.dept === '24부서' ? affOf(p) : regionKey(p.region), position: p.position || '', ...statusOf(p, sessions, ex) })),
  };
}

const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
/** 주간 요약 CSV(엑셀에서 열림). 이름 없이 숫자만 — 개인 명단은 기존 교육 보고 엑셀을 쓴다. */
export function weeklyCsv(week, items) {
  const L = [['교육', '날짜', '교육명', '기준', '조직', '재적', '참석', '정시', '지각', '공무', '불참', '참석률']];
  for (const it of items) for (const r of [...it.rows, it.total]) L.push([it.kind === '화전단' ? '화요전도단' : '목요사명자교육', it.date, it.title, it.basisLabel, r.label, r.n, r.came, r.onTime, r.late, r.excused, r.absent, r.rate]);
  return '﻿' + `주간 교육 출석 현황 ${week.from}~${week.to}\n` + L.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}
