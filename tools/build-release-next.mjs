// 배포 실행 기능 없음. A/B 후보의 잘못된 빌드 설정을 먼저 거절한다.
import {spawnSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';
const repo=fileURLToPath(new URL('../',import.meta.url)),app=path.join(repo,'next-app');
const requireNext=createRequire(path.join(app,'package.json'));
// Next의 실제 빌드 목록과 현재 설치 버전의 캐시 키를 사용한다.
// 어댑터 빌드에는 예전 server/app/*.html 호환 사본이 없을 수 있다.
export function verifyPilotBuild(appDir=app){
 const dist=path.join(appDir,'.next');
 const routes=JSON.parse(readFileSync(path.join(dist,'app-path-routes-manifest.json'),'utf8'));
 const prerender=JSON.parse(readFileSync(path.join(dist,'prerender-manifest.json'),'utf8'));
 const {getRouteCacheKey}=requireNext('next/dist/server/lib/route-cache-key.js');
 const config=JSON.parse(readFileSync(path.join(dist,'required-server-files.json'),'utf8')).config;
 const checked=[];
 for(const route of ['/','/activities','/admin/pilot']){
  assert.ok(prerender.routes[route]?.dataRoute?.endsWith('.rsc'),'정적 A/B 페이지 누락: '+route);
  const sources=Object.entries(routes).filter(([source,url])=>url===route&&source.endsWith('/page'));
  assert.equal(sources.length,1,'A/B 페이지 소스가 모호하거나 누락됨: '+route);
  const sourceRoute=sources[0][0];
  const cacheFile='server'+getRouteCacheKey(route,{kind:'APP_PAGE',sourceRoute})+'.html';
  const usesRouteCache=Boolean(config.adapterPath)||existsSync(path.join(dist,cacheFile));
  const relative=usesRouteCache
   ? cacheFile
   : 'server/app'+(route==='/'?'/index':route)+'.html';
  assert.ok(readFileSync(path.join(dist,relative),'utf8').includes('/pilot-bridge.js'),'A/B 브리지 누락: '+route);
  checked.push({route,sourceRoute,artifact:relative});
 }
 return {buildId:readFileSync(path.join(dist,'BUILD_ID'),'utf8').trim(),checked};
}
function main(){
assert.equal(process.env.PILOT_ROUTING_ENABLED,'1','A/B 빌드·실행 환경 모두 PILOT_ROUTING_ENABLED=1 필요');
assert.equal(Number(process.versions.node.split('.')[0]),24,'검증한 Node.js 24.x 사용');
assert.ok(process.argv.length===2||(process.argv.length===3&&process.argv[2]==='--verify-only'));
if(process.argv[2]!=='--verify-only'){
 for(const args of [[path.join(repo,'tools/prepare-next-legacy.mjs')],[path.join(app,'node_modules/next/dist/bin/next'),'build','--webpack']]){
  const result=spawnSync(process.execPath,args,{cwd:app,stdio:'inherit',env:process.env});
  if(result.error)throw result.error;if(result.status!==0)process.exit(result.status||1);
 }
}
console.log('A/B 빌드 확인 완료: '+JSON.stringify(verifyPilotBuild()));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
