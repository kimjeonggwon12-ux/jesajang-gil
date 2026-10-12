// 출석 마감 엑셀을 옛 서버와 새 코드로 각각 만들어(보내지 않는 dryRun) 내용이 같은지 비교한다.
//   node --env-file=.env tools/parity-closing.mjs
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import { db, run, selectAll } from '../server/lib/db.js';
import { actions } from '../server/registry.js';

const XLSX = createRequire(import.meta.url)('xlsx');

async function legacy(payload) {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(process.env.LEGACY_URL, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(process.env.MAINT_KEY ? { ...payload, maint: process.env.MAINT_KEY } : payload), redirect: 'follow',
      });
      return JSON.parse(await r.text());
    } catch (e) { if (attempt >= 3) throw e; }
  }
}

/** 엑셀의 모든 칸 값(첫 두 줄 가운데 마감 시각이 든 둘째 줄은 뺀다)과 병합·열 너비. */
function contents(base64) {
  const book = XLSX.read(Buffer.from(base64, 'base64'), { cellStyles: true });
  const sheet = book.Sheets[book.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
  rows.splice(1, 1);
  const styles = Object.keys(sheet).filter((k) => !k.startsWith('!')).map((k) => `${k}:${JSON.stringify(sheet[k].s?.fgColor || '')}`);
  return { name: book.SheetNames[0], rows, merges: sheet['!merges'], cols: sheet['!cols']?.map((c) => c.width), styles };
}

const [admin] = await run(db().from('admins').select('member_id').order('id').limit(1));
const counts = new Map();
for (const r of await selectAll(() => db().from('attend_records').select('meeting_id').order('id'))) counts.set(r.meeting_id, (counts.get(r.meeting_id) || 0) + 1);
const meetings = [...counts].sort((a, b) => b[1] - a[1]).map(([id]) => id);

let failed = 0;
for (const meetingId of meetings) {
  const payload = { action: 'attSendClosing', memberId: admin.member_id, meetingId, dryRun: true };
  const [oldR, newR] = await Promise.all([legacy(payload), actions.attSendClosing(payload)]);
  const problems = [];
  if (oldR.error || newR.error) { if (oldR.error !== newR.error) problems.push(`오류: 옛=${oldR.error} 새=${newR.error}`); }
  else {
    if (oldR.fileName !== newR.fileName) problems.push(`파일 이름: 옛=${oldR.fileName} 새=${newR.fileName}`);
    if (oldR.caption !== newR.caption) problems.push(`설명 글:\n      옛=${JSON.stringify(oldR.caption)}\n      새=${JSON.stringify(newR.caption)}`);
    const a = contents(oldR.base64);
    const b = contents(newR.base64);
    for (const key of Object.keys(a)) {
      if (isDeepStrictEqual(a[key], b[key])) continue;
      if (key !== 'rows') { problems.push(`${key} 다름`); continue; }
      const at = a.rows.findIndex((row, i) => !isDeepStrictEqual(row, b.rows[i]));
      problems.push(`${at + 1}번째 줄: 옛=${JSON.stringify(a.rows[at])?.slice(0, 200)}\n      새=${JSON.stringify(b.rows[at])?.slice(0, 200)}`);
    }
  }
  if (problems.length) failed++;
  console.log(`${problems.length ? '✗' : '✓'} ${meetingId} (${counts.get(meetingId)}명)${problems.length ? '\n    ' + problems.join('\n    ') : ''}`);
}
process.exit(failed ? 1 : 0);
