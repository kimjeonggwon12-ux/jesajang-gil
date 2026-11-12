// 교육별 재적(edu_roster) 올리기 — 2026-11-12 목요 사명자 교육(부구역장 이상 사명자 엑셀)
//   node --env-file=.env tools/import-edu-roster.mjs "<엑셀>" [roster_key=목요사명자] [시트 이름=첫 시트] [--dry]
//   엑셀 첫 시트: 번호·부서·지역·구역·소속·고유번호·이름·직책 (A~H, 고유번호가 있는 줄만). 그 roster_key 명단을 통째로 바꾼다.
import XLSX from 'xlsx';
import { db, run } from '../server/lib/db.js';
import { normId, kstDateTime } from '../server/lib/util.js';

const [file, key = '목요사명자', sheetName] = process.argv.slice(2).filter((a) => a !== '--dry');
const dry = process.argv.includes('--dry');
if (!file) { console.log('사용: import-edu-roster.mjs "<엑셀>" [roster_key] [시트]'); process.exit(1); }
const wb = XLSX.readFile(file);
const ws = wb.Sheets[sheetName || wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
const now = kstDateTime();
const seen = new Set();
const out = [];
for (const r of rows) {
  const id = String(r[5] || '').trim();
  if (!/^\d{6,8}-?\d{4,5}$/.test(id)) continue;
  const nid = normId(id);
  if (seen.has(nid)) { console.log('중복 건너뜀', id, r[6]); continue; }
  seen.add(nid);
  out.push({ roster_key: key, member_id: id, name: String(r[6]).trim(), dept: String(r[1]).trim(), region: String(r[2]).trim(),
    district: String(r[3]).trim(), affiliation: String(r[4]).trim(), position: String(r[7]).trim(), sort_order: out.length + 1, updated_at: now });
}
const c = {};
for (const x of out) c[x.dept] = (c[x.dept] || 0) + 1;
console.log(`${key}: ${out.length}명`, c);
if (dry) process.exit(0);
await run(db().from('edu_roster').delete().eq('roster_key', key));
for (let i = 0; i < out.length; i += 500) await run(db().from('edu_roster').insert(out.slice(i, i + 500)));
console.log('올림 완료');
