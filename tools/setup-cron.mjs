// Supabase 의 예약 기능(pg_cron + pg_net)으로 새 서버의 주기 작업을 건다. 다시 돌려도 같은 이름의 예약을 덮어쓴다.
// ⚠️ 최종 전환 때 한 번 실행한다 — 그 전에 걸면 옛 서버의 서머리와 두 번 나간다.
//   node --env-file=.env tools/setup-cron.mjs          예약 걸기
//   node --env-file=.env tools/setup-cron.mjs remove   예약 지우기
// 예약 시각은 UTC 로 적는다(한국 시간 - 9시간).
import { writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const API = 'https://jesajang-gil.vercel.app/api';
const key = process.env.TEACHERSQUARE_CRON_KEY;
if (!key) { console.error('TEACHERSQUARE_CRON_KEY 가 없습니다.'); process.exit(1); }

const JOBS = [
  ['ts-daily-summary', '0 22 * * *', { action: 'tsDailySummary' }],       // 매일 아침 7시: 어제 활동 서머리
  ['ts-evening-summary', '0 12 * * *', { action: 'tsEveningSummary' }],   // 매일 저녁 9시: 참여율·등급 서머리
  ['video-package', '7,37 * * * *', { action: 'vtAuto' }],                // 30분마다: 밀린 영상 녹취·자료
  ['attendance-closing', '*/5 * * * *', { action: 'attAutoSummary' }],    // 5분마다: 끝난 출석 모임 마감 집계
];

const quote = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const unschedule = JOBS.map(([name]) => `select cron.unschedule(jobid) from cron.job where jobname = ${quote(name)};`).join('\n');
const schedule = JOBS.map(([name, when, body]) => {
  const call = `select net.http_post(url := ${quote(API)}, body := ${quote(JSON.stringify({ ...body, key }))}::jsonb, ` +
    `headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 300000)`;
  return `select cron.schedule(${quote(name)}, ${quote(when)}, ${quote(call)});`;
}).join('\n');

const sql = process.argv[2] === 'remove'
  ? unschedule
  : `create extension if not exists pg_cron;\ncreate extension if not exists pg_net;\n${unschedule}\n${schedule}\nselect jobname, schedule from cron.job order by jobname;`;

// 키가 든 SQL 은 임시 파일로만 넘기고 바로 지운다.
const file = join(tmpdir(), `cron-${Date.now()}.sql`);
writeFileSync(file, sql);
try {
  console.log(execFileSync('supabase', ['db', 'query', '--linked', '-f', file], { encoding: 'utf8', shell: true }));
} finally {
  rmSync(file, { force: true });
}
