// 공유 가능한 순수/모의 검사만 실행한다. 기존 로컬 DB 검사는 포함하지 않는다.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const repo=fileURLToPath(new URL('../',import.meta.url));
const suite=JSON.parse(readFileSync(new URL('../tests/collaboration-suite.json',import.meta.url),'utf8'));
assert.equal(Number(process.versions.node.split('.')[0]),24,'Node.js 24.x 필요');
assert.ok(suite.tests.every(f=>/^[a-z0-9-]+\.test\.mjs$/.test(f)&&!f.startsWith('local-')));
const env={...process.env};
for(const key of Object.keys(env))if(/SUPABASE|TEACHERSQUARE|TEACHER_EXPORT|TELEGRAM|GEMINI|R2_|ATTEND_|ATT_BOT|BOT_TOKEN|AUTH_SIGNING|PILOT_|NEXT_PUBLIC_|BACKUP_WATCH/.test(key))delete env[key];
env.NEXT_TELEMETRY_DISABLED='1';
const result=spawnSync(process.execPath,['--experimental-test-module-mocks','--import',new URL('../tests/helpers/collaboration-network-guard.mjs',import.meta.url).href,'--test','--test-concurrency=1',...suite.tests.map(f=>'tests/'+f)],{cwd:repo,env,stdio:'inherit'});
if(result.error)throw result.error;
process.exit(result.status??1);
