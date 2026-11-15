// 로컬 소스만 확인한다. 외부 통신·DB·배포는 실행하지 않는다.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const repo=fileURLToPath(new URL('../',import.meta.url));
process.chdir(repo);
assert.equal(Number(process.versions.node.split('.')[0]),24,'Node.js 24.x를 사용하세요.');
const branch=execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim();
assert.ok(branch&&!['main','vercel-supabase'].includes(branch),'공유/기능 브랜치에서 실행하세요.');
for(const file of ['vercel.json','next-app/vercel.json'])assert.equal(JSON.parse(readFileSync(file,'utf8')).git?.deploymentEnabled,false,file+' 자동 배포 차단 필요');
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const forbidden=files.filter(f=>/(^|\/)(\.env[^/]*|\.local-[^/]*|\.hosted-[^/]*|\.vercel|node_modules|artifacts|backups)(\/|$)|\.(dump|sql\.gz|tar\.gz|log)$/.test(f)||f.startsWith('next-app/public/')||f==='next-app/next-env.d.ts'||f.includes('/.next/'));
assert.deepEqual(forbidden,[],'개인 환경/생성물은 Git에서 제외하세요.');
assert.match(readFileSync('server/lib/system-owner.js','utf8'),/TEACHERSQUARE_SYSTEM_OWNER_ID\?\?''/,'실제 책임자 번호 기본값을 소스에 넣지 마세요.');
assert.match(readFileSync('next-app/app/api/route.ts','utf8'),/api\/index\.js/,'A/B 공통 API 연결을 유지하세요.');
for(const file of ['AGENTS.md','CLAUDE.md','docs/handoff/START_HERE.md','docs/handoff/EDUCATION.md','docs/handoff/BOUNDARIES.md'])assert.ok(readFileSync(file,'utf8').length>0);
console.log(JSON.stringify({ok:true,branch,trackedFiles:files.length,gitDeploymentEnabled:false,externalCalls:0,databaseChanges:0}));
