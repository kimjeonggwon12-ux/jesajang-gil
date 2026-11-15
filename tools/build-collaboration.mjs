// 로컬 빌드만 수행한다. 실제 환경값을 전달하거나 배포를 실행하지 않는다.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const env={...process.env};
for(const key of Object.keys(env))if(/SUPABASE|TEACHERSQUARE|TEACHER_EXPORT|TELEGRAM|GEMINI|R2_|ATTEND_|ATT_BOT|BOT_TOKEN|AUTH_SIGNING|PILOT_|NEXT_PUBLIC_|BACKUP_WATCH|VERCEL/.test(key))delete env[key];
Object.assign(env,{PILOT_ROUTING_ENABLED:'1',NEXT_TELEMETRY_DISABLED:'1'});
const result=spawnSync(process.execPath,[fileURLToPath(new URL('./build-release-next.mjs',import.meta.url))],{cwd:fileURLToPath(new URL('../next-app/',import.meta.url)),env,stdio:'inherit'});
if(result.error)throw result.error;
process.exit(result.status??1);
