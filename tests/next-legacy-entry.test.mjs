import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LEGACY_ENTRIES,resolveLegacyEntry,decodeCarry} from '../next-app/lib/legacy-entry.mjs';
import {rememberEntry,takeEntry,clearEntry} from '../next-app/lib/entry-handoff.ts';
import {nextManifest} from '../tools/prepare-next-legacy.mjs';
const resolve=(search='',hash='',path='/app.html')=>resolveLegacyEntry(path,search,hash);
const carry=value=>'#carry='+Buffer.from(JSON.stringify(value)).toString('base64url');
const handoff={hints:{name:'가짜교사',memberId:'9900000000001',dept:'청년회'},chat:{id:'9900000000005',name:'가짜상대',text:'검토할 초안'},coaching:{stage:'소개',targetGroup:'청년',situationText:'검토할 상황'}};
test('이전 업무 주소 16개와 원본 앱 메뉴는 허용된 화면으로 연결하고 새 화면 주소는 건드리지 않는다',()=>{
 assert.equal(Object.keys(LEGACY_ENTRIES).length,16);
 for(const [file,href]of Object.entries(LEGACY_ENTRIES))assert.equal(resolve('','',`/${file}`).href,href);
 const original=readFileSync(new URL('../app.html',import.meta.url),'utf8'),tabs=original.match(/const TAB_IDS\s*=\s*\[([^\]]+)\]/)[1].match(/'[^']+'/g).map(v=>v.slice(1,-1));
 assert.deepEqual(tabs,['calendar','story','activity','connect','ai','textbook','join','admin']);
 const paths=['/calendar','/community?section=story','/activities','/connect','/coaching','/library','/community?section=yard','/admin'];
 tabs.forEach((tab,i)=>assert.equal(resolve('','#'+tab).href,paths[i]));
 assert.equal(resolve('','','/members'),null);assert.equal(resolve('','','/not-real.html'),null);
 assert.equal(resolve('?view=teachers','','/district-dashboard.html').href,'/members');
});
test('QR·초대 링크는 원래의 번호를 보존하며 손상된 코드는 자동 입장하지 않는다',()=>{
 for(const id of ['MT140001','RS140001','CH140001']){
  for(const [query,hash]of [['','#attend='+id],['?meeting='+id,''],['?attend='+id,'']])assert.equal(resolve(query,hash).href,'/attend?meeting='+id);
 }
 for(const code of ['READTEST','read-test'])assert.equal(resolve('','#room='+code).href,'/rooms?code=READTEST');
 for(const hash of ['#room=','#room=bad','#room=READTEST/other','#attend=','#attend=../../api','#attend=not-valid'])assert.ok(resolve('',hash).error,hash);
 assert.ok(resolve('?meeting=').error);assert.equal(resolve('?embed=plaza').href,'/calendar');
});
test('현재 홈 내부 주소는 유지하고 외부 이동·권한·토큰 입력은 새 주소로 넘기지 않는다',()=>{
 for(const [q,h]of [['',''],['','#notices'],['','#main-content'],['?view=notices','#notices']])assert.equal(resolve(q,h,'/'),null);
 const r=resolve('?next=https://example.invalid&role=admin&token=secret&owner=other','#activity');
 assert.equal(r.href,'/activities');assert.equal(JSON.stringify(r).includes('secret'),false);assert.equal(JSON.stringify(r).includes('other'),false);
 assert.equal(resolve('?view=notices&name=가짜','','/').href,'/');
});
test('이전 carry와 query는 이름·부서·번호 입력만 보조하고 잘못된 인코딩·비정상 번호는 버린다',()=>{
 const hash=carry({...handoff.hints,owner:'other',app:'external',token:'secret'}),hints=decodeCarry(hash);
 assert.deepEqual(hints,handoff.hints);assert.deepEqual(resolve('?name=무시',hash).hints,handoff.hints);
 assert.deepEqual(resolve('?name=가짜교사&dept=청년회&memberId=9900000000001').hints,handoff.hints);
 for(const hash of ['#carry=%%%','#carry='+Buffer.from('{').toString('base64url'),'#carry='+('a'.repeat(4097))])assert.equal(decodeCarry(hash),null);
 assert.equal(decodeCarry(carry({name:'가짜',memberId:'<script>'})).memberId,'');
});
test('개인 대화·상담 초안은 URL 실행 명령 대신 별도 입력 자료로 반환한다',()=>{
 const r=resolve('?chatWith=9900000000005&chatWithName=가짜상대&autoMsg='+encodeURIComponent('<script>초안</script>'),'','/connect-room.html');
 assert.equal(r.href,'/connect');assert.deepEqual(r.chat,{id:'9900000000005',name:'가짜상대',text:'<script>초안</script>'});assert.equal(r.href.includes('초안'),false);
 assert.ok(resolve('?chatWith=javascript:bad','','/connect-room.html').error);
 assert.equal(resolve('?tab=history','','/feedback-room.html').href,'/coaching/history');
 const c=resolve('?heartsStage=소개&targetGroup=청년&situation=검토할상황','','/feedback-room.html');assert.equal(c.href,'/coaching');assert.equal(c.coaching.situationText,'검토할상황');
});
test('구형 본인 이력은 AI 기록 포함 경로로 연결하며 다른 상담 메뉴·QR·대화 우선순위는 보존한다',()=>{
 for(const [tab,href]of [['history','/coaching/history'],['askCoach','/coaching?tab=requests'],['coachMode','/coaching?tab=inbox'],['coach','/coaching?tab=teacher'],['studentCoach','/coaching']]){
  const r=resolve('?tab='+tab+'&memberId=9900000000005&token=secret&role=admin','','/feedback-room.html');assert.equal(r.href,href);assert.doesNotMatch(r.href,/990000|secret|admin/);assert.equal(r.chat,null);
 }
 assert.equal(resolve('?tab=history','#attend=MT140001','/feedback-room.html').href,'/attend?meeting=MT140001');
 assert.equal(resolve('?tab=history','#room=READTEST','/feedback-room.html').href,'/rooms?code=READTEST');
 assert.equal(resolve('?tab=history&chatWith=9900000000005','','/feedback-room.html').href,'/connect');
 assert.equal(resolve('?tab=history','#ai','/app.html').href,'/coaching');
});
test('입력 보조는 한 번·5분 동안만 쓰고 로그아웃과 다른 계정 접근 때 폐기한다',()=>{
 const now=Date.now;let clock=1000;Date.now=()=>clock;
 try{
  rememberEntry(handoff,'');assert.deepEqual(takeEntry('hints'),handoff.hints);assert.equal(takeEntry('hints'),null);assert.deepEqual(takeEntry('chat','first-login'),handoff.chat);
  rememberEntry(handoff,'actor');assert.equal(takeEntry('hints','actor'),null);assert.equal(takeEntry('chat','other-actor'),null);assert.equal(takeEntry('chat','actor'),null);
  rememberEntry(handoff,'actor');clock+=300001;assert.equal(takeEntry('coaching','actor'),null);
  rememberEntry(handoff,'');clearEntry();assert.equal(takeEntry('chat'),null);
 }finally{Date.now=now;clearEntry();}
});
test('설치 앱 시작은 새 홈으로 옮기되 기존 앱 식별 주소와 아이콘 원본을 유지한다',()=>{
 const original=JSON.parse(readFileSync(new URL('../manifest.json',import.meta.url),'utf8')),copy=structuredClone(original),next=nextManifest(original),base='https://example.invalid/manifest.json';
 assert.equal(new URL(next.id,base).href,new URL(original.start_url,base).href);assert.equal(next.start_url,'/');assert.equal(next.scope,'/');assert.equal(next.name,original.name);assert.deepEqual(original,copy);
 next.icons.forEach((icon,i)=>assert.equal(new URL(icon.src,base).href,new URL(original.icons[i].src,base).href));
});
