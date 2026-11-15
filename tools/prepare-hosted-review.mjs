// 고정 후보의 별도 검토 사본. 기존 소스/운영 DB/배포/환경 설정 변경 기능 없음.
import {mkdirSync,readFileSync,writeFileSync,copyFileSync,existsSync,readdirSync} from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const repo=fileURLToPath(new URL('../',import.meta.url)),workspace=path.dirname(repo.replace(/\/$/,''));
const run=path.join(workspace,'.hosted-review-20261115'),source=path.join(run,'source'),out=path.join(workspace,'artifacts/hosted-review-20261115');
assert.ok(!existsSync(run),'기존 검토 사본/비밀값 보존');mkdirSync(run,{mode:0o700});mkdirSync(source);mkdirSync(out,{recursive:true});
const candidate=JSON.parse(readFileSync(path.join(workspace,'artifacts/release-prep-20261115/candidate-final.json'),'utf8'));
const archive=path.join(workspace,'artifacts/release-prep-20261115/candidate-source-final.tar.gz');
assert.equal(createHash('sha256').update(readFileSync(archive)).digest('hex'),candidate.archiveSha256);
execFileSync('/usr/bin/tar',['-xzf',archive,'-C',source]);
const changed=[];
const blocked="const blocked=()=>Response.json({error:'검토용 주소에서는 로그인·저장·전송을 실행하지 않습니다.',readOnly:true},{status:503,headers:{'Cache-Control':'private, no-store'}});\n";
for(const file of ['next-app/app/api/route.ts','next-app/app/api/tg/route.ts','next-app/app/api/room-attachment/route.ts','next-app/app/api/pilot-session/route.ts','next-app/app/api/pilot-page/route.ts']){
 writeFileSync(path.join(source,file),"export const runtime='nodejs';\nexport const dynamic='force-dynamic';\n"+blocked+'export {blocked as GET,blocked as POST,blocked as PUT,blocked as PATCH,blocked as DELETE,blocked as OPTIONS,blocked as HEAD};\n');changed.push(file);
}
// 임의의 쿠키를 받더라도 업무 DB를 조회하거나 A/B 배정을 실행하지 않는다.
writeFileSync(path.join(source,'next-app/proxy.ts'),"import {NextResponse} from 'next/server';\nexport function proxy(){return NextResponse.next();}\n");changed.push('next-app/proxy.ts');
copyFileSync(path.join(repo,'tools/hosted-review-probe.mjs'),path.join(source,'server/lib/hosted-review-probe.mjs'));changed.push('server/lib/hosted-review-probe.mjs');
mkdirSync(path.join(source,'next-app/app/api/deployment-check'),{recursive:true});
writeFileSync(path.join(source,'next-app/app/api/deployment-check/route.ts'),"import {deploymentProbe} from '../../../../server/lib/hosted-review-probe.mjs';\nexport const runtime='nodejs';\nexport const dynamic='force-dynamic';\nexport const maxDuration=60;\nexport const GET=deploymentProbe;\n");changed.push('next-app/app/api/deployment-check/route.ts');
const conf=path.join(source,'next-app/next.config.mjs');let content=readFileSync(conf,'utf8');content=content.replace("outputFileTracingIncludes: {","outputFileTracingIncludes: {'/api/deployment-check':['../server/assets/fonts/NanumGothic-Regular.ttf'],");writeFileSync(conf,content);changed.push('next-app/next.config.mjs');
const token=randomBytes(32).toString('hex'),expires=String(Date.now()+4*60*60*1000);
writeFileSync(path.join(run,'review-access.json'),JSON.stringify({token,expires}),{mode:0o600});
const all=[];function walk(folder,prefix=''){for(const e of readdirSync(folder,{withFileTypes:true})){const file=path.posix.join(prefix,e.name);assert.ok(!e.isSymbolicLink());if(e.isDirectory())walk(path.join(folder,e.name),file);else all.push(file);}}walk(source);
for(const file of all){assert.ok(!file.startsWith('.')&&!/node_modules|\.env|\.dump$|review-access/.test(file));if(!changed.includes(file))assert.equal(createHash('sha256').update(readFileSync(path.join(source,file))).digest('hex'),candidate.sourceHashes[file]);}
writeFileSync(path.join(out,'review-source.json'),JSON.stringify({createdAt:new Date().toISOString(),source,baseArchiveSha256:candidate.archiveSha256,files:all.length,unchangedFiles:all.filter(f=>!changed.includes(f)).length,changedFiles:changed,readOnlyOverlay:true,fullApplicationVerification:false,productionChanged:false},null,2)+'\n');
console.log(JSON.stringify({prepared:true,source,files:all.length,changedFiles:changed.length,productionChanged:false}));
