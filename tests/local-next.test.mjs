import {before,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {seedRemaining} from './helpers/remaining-fixture.mjs';
import {ids,sql,PIN} from './helpers/local-db.mjs';
import {PUBLIC_ACTIONS} from '../server/lib/auth.js';
import {actions} from '../server/registry.js';
import {LEGACY_ENTRIES} from '../next-app/lib/legacy-entry.mjs';
import {nextManifest} from '../tools/prepare-next-legacy.mjs';
const old='http://127.0.0.1:58433',next='http://127.0.0.1:58434';
async function request(base,action,body={},token){const r=await fetch(base+'/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...body,...(token?{_tk:token}:{})})});return {status:r.status,body:await r.json(),cache:r.headers.get('cache-control')};}
let token,admin;
before(async()=>{seedRemaining();token=(await request(next,'verifyLogin',{memberId:ids.member,name:'테스트교사',dept:'청년회',pin:PIN})).body.token;admin=(await request(next,'verifyLogin',{memberId:ids.evangel,name:'테스트전도',dept:'전도부',pin:PIN})).body.token;assert.ok(token&&admin);});
test('Next와 기존 API는 같은 세션으로 최적화된 개인·목록·집계 전체 응답을 반환한다',async()=>{
 for(const [action,body]of [['checkAdmin',{}],['getMyTierStatus',{}],['getMyActivities',{summary:true,aggregate:true}],['getSettlementReport',{summary:true}],['getNonParticipants',{summary:true}],['getOrgSummary',{}],['getDistrictReport',{dept:'청년회',analysis:true,analysisMonth:'2026-11'}],['getActivityItemDistribution',{}]]){
  assert.deepEqual(await request(next,action,body,token),await request(old,action,body,token),action);
 }
 assert.deepEqual(await request(next,'searchRoster',{query:'테스트'},admin),await request(old,'searchRoster',{query:'테스트'},admin));
});
test('등록된 모든 비공개·예약 API가 Next에서도 인증 없이 실행되지 않는다',async()=>{
 const checked=[];
 for(const action of Object.keys(actions)){
  if(PUBLIC_ACTIONS.has(action))continue;
  const result=await request(next,action);assert.equal(result.status,401,action);checked.push(action);
 }
 writeFileSync('../artifacts/next-phase1-20261112/api-boundary.json',JSON.stringify({checked:checked.length,publicActions:[...PUBLIC_ACTIONS],productionTouched:false},null,2));
});
test('Next는 타인 번호 대입·손님 범위 초과·명단 관리 권한 초과를 기존처럼 거절한다',async()=>{
 assert.equal((await request(next,'getMyTierStatus',{memberId:ids.other},token)).status,403);
 assert.ok((await request(next,'searchRoster',{query:'테스트'},token)).body.error);
 sql("insert into target_room_invites(code,target_id,expires_at,max_uses) values('NEXTTEST','LIST-1','2099-01-01',10) on conflict(code) do update set revoked=false,uses=0");
 const guest=(await request(next,'guestLogin',{memberId:'99000999',name:'가짜손님',dept:'청년회',code:'NEXTTEST'})).body.token;assert.ok(guest);
 assert.equal((await request(next,'getMyTierStatus',{},guest)).status,403);
 assert.equal((await request(next,'getTargetRoom',{targetId:'OTHER-ROOM'},guest)).status,403);
});
test('API 메서드·비정상 JSON·알 수 없는 기능과 no-store 응답을 보존한다',async()=>{
 for(const [method,body]of [['GET',null],['OPTIONS',null],['PUT','{}'],['POST',''],['POST','{'],['POST','[]'],['POST','null'],['POST','{"action":"toString"}']]){
  const fetchOne=async base=>{const r=await fetch(base+'/api',{method,...(body!==null?{body}:{}),headers:{'content-type':'text/plain'}});return {status:r.status,text:await r.text(),cache:r.headers.get('cache-control')};};
  assert.deepEqual(await fetchOne(next),await fetchOne(old),method+' '+body);
 }
});
test('정적 자원 원본을 보존하고 이전 업무 링크는 개인 정보 없는 React 진입 화면을 제공한다',async()=>{
 for(const file of ['display.html','vendor/xlsx.full.min.js','assets/optimized/icon-192.png']){
  const r=await fetch(next+'/'+file);assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),readFileSync(new URL('../'+file,import.meta.url)));
 }
 for(const file of Object.keys(LEGACY_ENTRIES)){
  const r=await fetch(next+'/'+file+'?name=PRIVATE_HINT&memberId=9900000000001');assert.equal(r.status,200,file);const html=await r.text();assert.ok(html.includes('화면을 여는 중이에요.'),file);assert.doesNotMatch(html,/PRIVATE_HINT|9900000000001|id="sec-activity"/,file);
 }
 const manifest=await fetch(next+'/manifest.json');assert.deepEqual(await manifest.json(),nextManifest(JSON.parse(readFileSync(new URL('../manifest.json',import.meta.url),'utf8'))));
 for(const file of ['.env','AGENTS.md','server/lib/auth.js','api/index.js','package.json','tools/local-auth-server.mjs'])assert.equal((await fetch(next+'/'+file)).status,404,file);
 const root=await fetch(next);assert.equal(root.status,200);assert.ok((await root.text()).includes('lang="ko"'));
});
test('설치 앱 워커는 갱신 가능한 헤더와 개인 자료 없는 오프라인 안내를 제공한다',async()=>{
 const r=await fetch(next+'/service-worker.js');assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-cache.*no-store/);assert.equal(r.headers.get('service-worker-allowed'),'/');assert.equal(await r.text(),readFileSync(new URL('../next-app/worker/service-worker.js',import.meta.url),'utf8'));
 const offline=await fetch(next+'/offline.html');assert.equal(offline.status,200);assert.equal(await offline.text(),readFileSync(new URL('../next-app/worker/offline.html',import.meta.url),'utf8'));
});
test('웹훅의 비밀 확인은 Next에서도 유지되고 외부 봇 설정은 호출하지 않는다',async()=>{
 const r=await fetch(next+'/api/tg',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(r.status,401);assert.deepEqual(await r.json(),{ok:false});
});
test('PIN 상태가 바뀌면 기존·새 경로의 이전 세션이 함께 무효가 된다',async()=>{
 sql(`update member_pins set ver='next-revoked' where nid='${ids.member}'`);
 for(const base of [next,old])assert.equal((await request(base,'getMyTierStatus',{},token)).status,401);
});
