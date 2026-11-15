import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const appRoot=process.env.NEXT_VERIFY_APP_DIR?pathToFileURL(path.resolve(process.env.NEXT_VERIFY_APP_DIR)+'/'):new URL('../next-app/',import.meta.url);
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
import {callApi,readApi,SessionExpired} from '../next-app/lib/api.ts';
import {loadSession,saveSession,clearSession,TOKEN_KEY,MEMBER_KEY} from '../next-app/lib/session.ts';
import {resolveLegacyEntry} from '../next-app/lib/legacy-entry.mjs';
import {legacyFiles} from '../tools/prepare-next-legacy.mjs';
const store=()=>{const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};};
test('새 로그인은 기존 저장 형식·PIN 버전을 이어 쓰고 PIN 원문을 저장하지 않으며 로그아웃 시 지운다',()=>{
 globalThis.localStorage=store();globalThis.sessionStorage=store();
 const result=saveSession('m9900000000001.fake.signature',{memberId:'09900000000001',name:'가짜교사',dept:'청년회'},'fake-ver');
 assert.deepEqual(loadSession(),result);assert.equal(result.account.memberId,'9900000000001');
 assert.deepEqual(JSON.parse(localStorage.getItem('podo_pin')),{id:'9900000000001',ver:'fake-ver'});
 assert.equal(sessionStorage.getItem('pd_in'),'1');clearSession();assert.equal(loadSession(),null);assert.equal(localStorage.getItem('podo_pin'),null);
});
test('저장 차단·손상된 계정 정보는 잘못된 자동 입장으로 이어지지 않는다',()=>{
 globalThis.localStorage=store();globalThis.sessionStorage=store();localStorage.setItem(TOKEN_KEY,'old');localStorage.setItem(MEMBER_KEY,'{');assert.equal(loadSession(),null);
 const set=localStorage.setItem;localStorage.setItem=(key,value)=>{if(key===TOKEN_KEY)throw Error('blocked');return set(key,value);};
 assert.throws(()=>saveSession('m9900000000001.fake.signature',{memberId:'9900000000001',name:'가짜',dept:'청년회'}),/저장/);
 assert.equal(localStorage.getItem(TOKEN_KEY),null);assert.equal(localStorage.getItem(MEMBER_KEY),null);
});
test('같은 계정의 동시 읽기만 공유하고 다른 계정이나 완료 후 읽기는 분리한다',async()=>{
 const original=globalThis.fetch,calls=[];let release;const gate=new Promise(r=>{release=r;});
 globalThis.fetch=async(url,options)=>{calls.push(JSON.parse(options.body));await gate;return Response.json({isAdmin:false});};
 try {
  const p=[readApi('checkAdmin','fake-a'),readApi('checkAdmin','fake-a'),readApi('checkAdmin','fake-b')];assert.equal(calls.length,2);
  release();await Promise.all(p);await readApi('checkAdmin','fake-a');assert.equal(calls.length,3);assert.equal(calls[1]._tk,'fake-b');
 }finally{globalThis.fetch=original;}
});
test('세션 만료와 일시 장애를 구분하고 변경 요청은 자동 재시도하지 않는다',async()=>{
 const original=globalThis.fetch;let n=0;
 try {
  globalThis.fetch=async()=>{n++;return Response.json({auth:false,error:'다시 로그인해 주세요.'},{status:401});};
  await assert.rejects(callApi('registerPin',{}),SessionExpired);assert.equal(n,1);
  globalThis.fetch=async()=>Response.json({error:'잠시 후 다시 시도해 주세요.'},{status:503});
  await assert.rejects(callApi('checkAdmin'),e=>!(e instanceof SessionExpired)&&/잠시/.test(e.message));
  globalThis.fetch=async()=>new Response('<html>오류</html>');await assert.rejects(callApi('checkAdmin'),/연결/);
 }finally{globalThis.fetch=original;}
});
test('기존 QR·손님 초대·메뉴 주소는 허용된 React 경로로 연결한다',()=>{
 assert.equal(resolveLegacyEntry('/'),null);
 for(const [hash,href]of [['#attend=MTOPEN','/attend?meeting=MTOPEN'],['#room=READTEST','/rooms?code=READTEST'],['#admin','/admin'],['#activity','/activities']])assert.equal(resolveLegacyEntry('/app.html','?from=qr',hash).href,href);
 assert.equal(resolveLegacyEntry('/app.html','?next=https://example.invalid','#room=READTEST').href,'/rooms?code=READTEST');
});
test('기존 관리자 바로가기는 권한 확인을 기다리고 대기 중 다른 메뉴 선택을 덮어쓰지 않는다',async()=>{
 const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
 const source=html.slice(html.indexOf('function pdEnter('),html.indexOf('    // 2026-10-20: 앱 접속 횟수'));
 for(const [initial,changed,expected] of [['#admin',null,1],['#admin','#activity',0],['#activity',null,1]]){
  let ready,entered=0;const gate=new Promise(resolve=>{ready=resolve;});
  const ctx={App:{guest:false},location:{hash:initial},document:{querySelector:()=>({}),getElementById:()=>({style:{}})},sessionStorage:store(),Back:{enter(){}},pdFixId:id=>id,pdTokenFor:()=>true,pdIsGuestTok:()=>false,updateAdminTabVisibility(){},renderMeChips(){},loadMyRosterRow:()=>gate,logVisitOnce(){},enterFromHash(){entered++;},showInstallToastIfNeeded(){},setTimeout(){},pdWelcomeGuide(){},pinGuard(){}};
  vm.runInNewContext(source,ctx);ctx.pdEnter('9900000000003','가짜관리자');
  assert.equal(entered,initial==='#admin'?0:1);
  if(changed)ctx.location.hash=changed;ready();await gate;await Promise.resolve();assert.equal(entered,expected);
 }
});
test('공개 호환 파일은 명시한 화면·정적 자원만 포함하고 원본과 일치한다',()=>{
 for(const file of legacyFiles)assert.equal(sha(new URL('public/'+file,appRoot)),sha(new URL('../'+file,import.meta.url)),file);
 for(const forbidden of ['index.html','server','api','tests','AGENTS.md','.env','package.json'])assert.ok(!readdirSync(new URL('public/',appRoot)).includes(forbidden));
});
test('호환 서비스 워커는 React·API·다른 출처 응답을 캐시하거나 HTML로 대체하지 않는다',()=>{
 const listeners={},source=readFileSync(new URL('../next-app/worker/service-worker.js',import.meta.url),'utf8');
 const ctx={self:{location:{origin:'http://127.0.0.1:58434'},addEventListener:(name,fn)=>{listeners[name]=fn;}},URL,Set,fetch:()=>Promise.resolve({clone:()=>({})}),caches:{open:()=>Promise.resolve({put(){}})}};
 vm.runInNewContext(source,ctx);
 for(const path of ['/','/api','/api/tg','/_next/static/a.js','/future-screen','https://example.invalid/a.png']){
  let caught=false;listeners.fetch({request:{method:'GET',url:new URL(path,'http://127.0.0.1:58434').href,headers:new Headers()},respondWith(){caught=true;}});assert.equal(caught,false,path);
 }
 let caught=false;listeners.fetch({request:{method:'GET',mode:'navigate',url:'http://127.0.0.1:58434/app.html',headers:new Headers()},respondWith(){caught=true;}});assert.equal(caught,true);
});
test('클라이언트 빌드에는 DB 키·서명·PIN 해시 처리 코드가 들어가지 않는다',()=>{
 const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(new URL(e.name+'/',dir)):e.name.endsWith('.js')?[new URL(e.name,dir)]:[]);
 const files=walk(new URL('.next/static/',appRoot));assert.ok(files.length);
 for(const file of files)assert.doesNotMatch(readFileSync(file,'utf8'),/SUPABASE_SERVICE_ROLE_KEY|AUTH_SIGNING_KEY|pin_enrollment_attempts|pin_hash/);
});
