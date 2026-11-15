// 브라우저 인증 코드의 상태 전환을 격리 실행한다. 실제 브라우저 배치·네트워크 검증은 별도다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html = fs.readFileSync(new URL('../app.html',import.meta.url),'utf8');
function between(start,end) { const a=html.indexOf(start),b=html.indexOf(end,a); assert.ok(a>=0 && b>a); return html.slice(a,b); }
function storage(initial={}) {
  const values={...initial};
  Object.defineProperties(values,{
    getItem:{value:k=>values[k]??null}, setItem:{value:(k,v)=>{values[k]=String(v);}}, removeItem:{value:k=>{delete values[k];}},
  }); return values;
}
function context(extra={}) {
  const events=[];
  return vm.createContext({Event,events,window:{dispatchEvent:event=>{events.push(event.type);return true;}},App:{PROXY_URL:'/api'},localStorage:storage(),sessionStorage:storage(),atob:s=>Buffer.from(s,'base64').toString('binary'),setTimeout,clearTimeout,PD_KEY:'test-account',location:{pathname:'/app.html',replace(){}},...extra});
}
const authCode=between("    const PD_TK =",'    function toast(');
const pinCode=between("    const PD_PIN_KEY =",'    function pinCover(');
const guardCode=between('    async function pinGuard(', '    function pinAsk(');
const token = (kind='m',exp=Math.floor(Date.now()/1000)+300) => kind+'9900000000001.'+Buffer.from(JSON.stringify({v:3,exp})).toString('base64url')+'.test-signature';
const response = out=>({headers:{get:()=> 'application/json'},json:async()=>out});
test('메인 화면의 모든 인라인 스크립트를 문법 검사한다',()=>{
  let count=0;
  for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if(/\bsrc=/.test(match[1])||/application\//.test(match[1])) continue;
    new vm.Script(match[2],{filename:'app-inline-'+(++count)});
  }
  assert.ok(count>0);
});
test('기존 PIN 평문은 제거하고 새 PIN도 기기에 저장하지 않는다',()=>{
  const c=context({localStorage:storage({podo_pin:JSON.stringify({id:'9900000000001',ver:'old',pin:'5829'})})});
  vm.runInContext(pinCode,c);
  assert.equal(JSON.parse(c.localStorage.getItem('podo_pin')).pin,undefined);
  vm.runInContext("pinRemember('9900000000001','new','6938')",c);
  assert.deepEqual(JSON.parse(c.localStorage.getItem('podo_pin')),{id:'9900000000001',ver:'new'});
});
test('이전 응답 캐시를 지우고 다른 계정의 저장된 권한을 재사용하지 않는다',async()=>{
  const c=context({localStorage:storage({'swr1:old':'{"isAdmin":true}'}),fetch:async()=>response({isAdmin:false})});
  vm.runInContext(authCode,c); assert.equal(c.localStorage.getItem('swr1:old'),null);
  c.seen=[]; await vm.runInContext("apiSWR({action:'checkAdmin'},(v,cached)=>seen.push([v.isAdmin,cached]))",c);
  assert.equal(JSON.stringify(c.seen),'[[false,false]]');
  assert.equal(Object.keys(c.localStorage).filter(k=>k.startsWith('swr1:')).length,0);
});
test('만료·이전 형식의 표를 미리 읽기에 사용하지 않는다',()=>{
  const c=context();vm.runInContext(authCode,c);
  for(const value of ['m9900000000001.old',token('m',1),'malformed']) {c.localStorage.setItem('pd_tk_v1',value);assert.equal(vm.runInContext('pdTokenNow()',c),'');}
  c.localStorage.setItem('pd_tk_v1',token());assert.equal(vm.runInContext("pdTokenFor('9900000000001')",c),token());
});
test('PIN 변경 응답의 새 표를 저장하고 이전 요청의 결과는 적용하지 않는다',async()=>{
  const old=token(), next=token()+'new';
  const c=context({fetch:async()=>response({ok:true,token:next})});vm.runInContext(authCode,c);c.localStorage.setItem('pd_tk_v1',old);
  await vm.runInContext("callApiOnce({action:'setPin'})",c);assert.equal(c.localStorage.getItem('pd_tk_v1'),next);
  assert.deepEqual(c.events,['ts-session-change']);
  let finish;c.fetch=()=>new Promise(resolve=>{finish=resolve;});
  const pending=vm.runInContext("callApiOnce({action:'getRoster'})",c);
  c.localStorage.setItem('pd_tk_v1',old);finish(response({rows:['이전 계정 자료']}));
  assert.ok((await pending).error);
});
test('PIN 조회 실패는 잠금 안내를 유지하고 공개 QR 출석은 가리지 않는다',async()=>{
  let uncovered=0,covered=0,requests=0;
  const c=context({pinLocal:()=>null,pinNid:v=>v,pinCover:()=>{covered++;return{querySelector:()=>({})};},pinUncover:()=>{uncovered++;},pinRemember(){},pinAsk(){},goToCover(){},callApi:async()=>{requests++;return{error:'temporary'};}});
  vm.runInContext(guardCode,c);await vm.runInContext("pinGuard('9900000000001','테스트')",c);
  assert.ok(covered>0);assert.equal(uncovered,0);
  c.App.guest=true;c.App.qrOnly=true;await vm.runInContext("pinGuard('9900000000001','테스트')",c);
  assert.equal(uncovered,1);assert.equal(requests,1);
});
test('공개 QR의 제한된 중복 출석 응답은 상세 답변 없이 표시된다',()=>{
  const start=html.indexOf('    function attRenderForm()');const end=html.indexOf('      if (!m.open)',start);
  const code=html.slice(start,end)+'\n}';
  const host={innerHTML:''};
  const c=context({document:{getElementById:()=>host},attSt:{cur:{meeting:{title:'테스트모임'},mine:{limited:true}}},esc:String,attMeetLabel:()=>'',attOrgTag:()=>'',attWhen:()=>''});
  vm.runInContext(code+'\nattRenderForm();',c);assert.ok(host.innerHTML.includes('이미 출석했어요.'));
});

test('개인 캐시 제거 후에도 나의 교실 첫 화면 조회가 끝난다',async()=>{
  let renders=0;
  const c=context({home:{},memberId:'9900000000001',renderHome:()=>renders++,maybeShowTierStart(){},renderMeChips(){},loadCoachReplyNotif(){},TARGET_STAGES_FALLBACK:[],setTimeout(){},apiSWR:async(p,apply)=>{const r={rows:[]};apply(r,false);return r;}});
  vm.runInContext(between('    const activityPages =', '    async function fullActivity(') + between('    async function loadHomeDashboard()', '    function _coachReplySeenKey_'),c);
  await vm.runInContext('loadHomeDashboard()',c);
  assert.equal(c.home.loading,false);assert.equal(c.home.error,'');assert.equal(renders,2);
});

test('최초 등록·복구 화면은 입력 정보를 해당 API로 전달한다',async()=>{
  for(const mode of ['register','recover']) {
    const fields={memberId:'9900000000006',name:'테스트등록',pdDept:'청년회',pdPhone:'01000000006',pdRecovery:'2345-6789-ABCD-EFGH',pdNewPin:'582946',pdNewPin2:'582946'};
    const elements=Object.fromEntries(Object.entries(fields).map(([k,value])=>[k,{value,style:{},classList:{add(){},remove(){}},focus(){}}]));
    for(const id of ['pdEnterBtn','pdLoading','pdLoadingText'])elements[id]={style:{},classList:{add(){},remove(){}}};
    let sent;
    const c=context({document:{getElementById:id=>elements[id]||null},pdAuthMode:mode,pdFixId:v=>v,pdLoginMsg(){},location:{hash:''},callApiOnce:async data=>{sent=data;return {error:'검증용 중단'};},setTimeout(){}});
    vm.runInContext(between('    function startSession()', "    let pdAuthMode = 'login';"),c);
    vm.runInContext('startSession()',c);await new Promise(setImmediate);
    assert.equal(sent.action,mode==='register'?'registerPin':'recoverPin');
    assert.equal(sent.pin,'582946');assert.equal(sent.memberId,fields.memberId);
    assert.equal(sent[mode==='register'?'phone':'code'],fields[mode==='register'?'pdPhone':'pdRecovery']);
  }
});

test('일반 계정의 PIN 없는 응답은 화면 잠금을 풀지 않는다',async()=>{
  let lost=0,uncovered=0;
  const c=context({pinLocal:()=>null,pinNid:v=>v,pinCover:()=>({querySelector:()=>({})}),pinUncover:()=>uncovered++,pdAuthLost:()=>lost++,callApi:async()=>({hasPin:false})});
  vm.runInContext(guardCode,c);await vm.runInContext("pinGuard('9900000000001','테스트')",c);
  assert.equal(lost,1);assert.equal(uncovered,0);
});
test('담당자 복구 화면은 등록 번호를 표시하고 대상 변경 시 확인 상태와 이전 응답을 버린다',async()=>{
  const elements=Object.fromEntries(['pinRid','pinContactInfo','pinContactLoad','pinConfirmed','pinReason','pinRGo'].map(id=>[id,{value:'',textContent:'',innerHTML:'',checked:false}]));
  let finish,sent;
  const c=context({document:{getElementById:id=>elements[id]},openSheet(){},esc:String,callApi:input=>{sent=input;return new Promise(resolve=>{finish=resolve;});}});
  vm.runInContext(between('    function pinOpenReset()', '    /**\n     * [홈으로]'),c);
  vm.runInContext('pinOpenReset()',c);
  elements.pinRid.value='9900000000007';
  let pending=elements.pinContactLoad.onclick();
  assert.equal(sent.action,'getPinRecoveryContact');assert.equal(sent.targetId,elements.pinRid.value);
  const response={ok:true,name:'테스트미등록',depts:['청년회'],contacts:[{phone:'01000000007',source:'self_reported',disputed:false}]};
  finish(response);await pending;assert.ok(elements.pinContactInfo.innerHTML.includes('01000000007'));
  elements.pinConfirmed.checked=true;elements.pinReason.onchange();assert.equal(elements.pinConfirmed.checked,false);
  pending=elements.pinContactLoad.onclick();elements.pinConfirmed.checked=true;
  elements.pinRid.value='9900000000006';elements.pinRid.oninput();assert.equal(elements.pinConfirmed.checked,false);
  elements.pinContactInfo.innerHTML='새 대상';finish(response);await pending;
  assert.equal(elements.pinContactInfo.innerHTML,'새 대상');
});
