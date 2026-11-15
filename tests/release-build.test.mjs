import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {verifyPilotBuild} from '../tools/build-release-next.mjs';
const routes={'/page':'/','/(site)/activities/page':'/activities','/(site)/admin/pilot/page':'/admin/pilot'};
function fixture(modern){
 const root=mkdtempSync(path.join(tmpdir(),'teacher-build-'));const dist=path.join(root,'.next');mkdirSync(dist);
 const write=(file,text)=>{const target=path.join(dist,file);mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,text);};
 write('required-server-files.json',JSON.stringify({config:{adapterPath:modern?'fixture-adapter':null}}));
 write('BUILD_ID','fixture');write('app-path-routes-manifest.json',JSON.stringify(routes));write('prerender-manifest.json',JSON.stringify({routes:Object.fromEntries(Object.values(routes).map(r=>[r,{dataRoute:r+'.rsc'}]))}));
 const files=Object.entries(routes).map(([source,r])=>modern?'server/route-cache/APP_PAGE/'+createHash('sha256').update(source).digest('hex')+'/$'+(r==='/'?'/index':r)+'.html':'server/app'+(r==='/'?'/index':r)+'.html');
 for(const file of files)write(file,'<script src="/pilot-bridge.js"></script>');return {root,write,files};
}
test('어댑터의 캐시 산출물과 기존 산출물 모두 실제 세 페이지를 확인',()=>{
 for(const modern of [true,false]){const f=fixture(modern);try{const r=verifyPilotBuild(f.root);assert.equal(r.checked.length,3);assert.ok(r.checked.every(x=>x.artifact.startsWith(modern?'server/route-cache/':'server/app/')));}finally{rmSync(f.root,{recursive:true});}}
});
test('새 산출물의 브리지 누락/파일 누락을 오래된 HTML로 통과시키지 않음',()=>{
 const f=fixture(true);try{
  for(const r of Object.values(routes))f.write('server/app'+(r==='/'?'/index':r)+'.html','<script src="/pilot-bridge.js"></script>');
  f.write(f.files[1],'<p>브리지 없음</p>');assert.throws(()=>verifyPilotBuild(f.root),/브리지 누락/);
  rmSync(path.join(f.root,'.next',f.files[1]));assert.throws(()=>verifyPilotBuild(f.root),/ENOENT/);
 }finally{rmSync(f.root,{recursive:true});}
});
