// 최종 전환용: 시트에서 옮겨 온 표를 모두 비우고, 방금 내려받은 엑셀(tools/export/data.xlsx)로 전체를 다시 옮긴다.
// ⚠️ 옛 서버의 쓰기를 멈춘 뒤(안내 화면 + 서버 점검 모드) 한 번만 실행한다. 새 서버에서 생긴 기록(명단 변경 기록·스냅샷)은 지우지 않는다.
//   node --env-file=.env tools/import-all.mjs --fresh
import { writeFileSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db } from '../server/lib/db.js';

if (process.argv[2] !== '--fresh') { console.error('표를 비우고 다시 옮깁니다. 확인했으면 --fresh 를 붙여 실행하세요.'); process.exit(1); }

// 시트에서 옮겨 오는 표(이 표들만 비운다)
const TABLES = ['teachers', 'admins', 'activities', 'encouragements', 'center_leads', 'gospel_leads', 'targets', 'target_history',
  'tier_approvals', 'tier_history', 'chat_messages', 'courses', 'required_education', 'required_education_log', 'feedbacks',
  'teacher_profiles', 'coop_requests', 'boards', 'board_applies', 'plaza_posts', 'plaza_comments', 'calendar_events',
  'event_staff', 'event_attendees', 'calendar_ads', 'ad_questions', 'connect_cards', 'help_posts', 'matches',
  'videos', 'video_transcripts', 'textbook_wishes', 'request_comments', 'alert_log', 'attend_meetings', 'attend_records'];
const IMPORTERS = ['teachers', 'admins', 'activities', 'tiers', 'misc', 'plaza', 'videos', 'attendance'];

const age = (Date.now() - statSync(new URL('./export/data.xlsx', import.meta.url)).mtimeMs) / 60000;
console.log(`엑셀은 ${Math.round(age)}분 전에 받은 파일입니다.`);
if (age > 30) { console.error('받은 지 30분이 넘었습니다. 시트를 다시 내려받아 주세요.'); process.exit(1); }

const sqlFile = join(tmpdir(), `truncate-${Date.now()}.sql`);
writeFileSync(sqlFile, `truncate table ${TABLES.join(', ')} restart identity;`);
try { execFileSync('supabase', ['db', 'query', '--linked', '-f', sqlFile], { encoding: 'utf8', shell: true }); } finally { rmSync(sqlFile, { force: true }); }
console.log(`표 ${TABLES.length}개를 비웠습니다.`);

for (const name of IMPORTERS) {
  const out = execFileSync(process.execPath, ['--env-file=.env', `tools/import-${name}.mjs`], { encoding: 'utf8' });
  process.stdout.write(out);
}

console.log('── 옮긴 뒤 줄 수 ──');
for (const table of TABLES) {
  const { count } = await db().from(table).select('*', { count: 'exact', head: true });
  console.log(`${table}: ${count}`);
}
