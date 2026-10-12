// 교사관리 엑셀을 화면과 같은 방법(roster-excel.js)으로 읽어, 지금 DB 의 명단과 얼마나 다른지 본다(아무것도 바꾸지 않는다).
//   node --env-file=.env tools/check-roster-excel.mjs "<엑셀 경로>" [탭 이름]
import { createRequire } from 'node:module';
import { db, selectAll } from '../server/lib/db.js';
import { normId } from '../server/lib/util.js';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
await import('../roster-excel.js');
const { monthTabs, parse } = globalThis.RosterExcel;

const book = XLSX.readFile(process.argv[2]);
const tab = process.argv[3] || monthTabs(book.SheetNames)[0];
const rowsOf = (name) => (book.Sheets[name] ? XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, defval: '', raw: true }) : null);
const parsed = parse(rowsOf, tab);
console.log(`탭 "${tab}" — ${parsed.rows.length}명, 휴면 ${parsed.dormant}명`, parsed.problems.length ? '\n문제: ' + parsed.problems.join(' / ') : '');

const teachers = await selectAll(() => db().from('teachers').select('*').order('sort_order'), 3);
const current = new Map(teachers.map((t) => [t.nid, t]));
const inExcel = new Set(parsed.rows.map((r) => normId(r.memberId)));
const diffs = {};
const note = (kind, text) => { (diffs[kind] ||= []).push(text); };
for (const r of parsed.rows) {
  const t = current.get(normId(r.memberId));
  if (!t) { note('엑셀에만 있음', `${r.name} ${r.dept} ${r.region}`); continue; }
  const pairs = [['이름', t.name, r.name], ['부서', t.dept, r.dept], ['지역', t.region, r.region], ['소속', t.affiliation, r.note], ['등급', t.tier, r.tier],
    ['센터등록', t.reg_leads, r.regLeads], ['센터미등록', t.unreg_leads, r.unregLeads], ['상담', t.counsel, r.counsel],
    ['복음방', t.gospel_room, r.gospelRoom], ['동행교사', t.companion, r.companion], ['활동상태', t.active_state, r.activeState]];
  for (const [label, a, b] of pairs) if (a !== b) note(label + ' 다름', `${r.name}: DB=${a} 엑셀=${b}`);
}
for (const t of teachers) if (!inExcel.has(t.nid)) note('DB에만 있음', `${t.name} ${t.dept} ${t.region} ${t.position}`);
const kinds = Object.keys(diffs);
if (!kinds.length) console.log('DB 와 완전히 같습니다.');
for (const k of kinds) console.log(`${k}: ${diffs[k].length}건 — 예) ${diffs[k].slice(0, 3).join(' | ')}`);
