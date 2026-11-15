import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {DialogHistory,DIALOG_HISTORY_KEY as DIALOG} from '../next-app/lib/dialog-history.ts';
import {RootHistory,ROOT_HISTORY_KEY as ROOT,EXIT_MESSAGE,EXIT_NOTICE_MS,isHistoryInteraction} from '../next-app/lib/root-history.ts';
const tick=async()=>{await Promise.resolve();await Promise.resolve();};
function browser(url='/community?section=story'){
 const entries=[{url:'/outside',state:null},{url,state:{__NA:true,tree:'next tree'}}];let index=1,session='fake-session-a',activeDialogs;const closed=[],messages=[],pending=[];
 const port={state:()=>entries[index].state,url:()=>entries[index].url,currentSession:()=>session,
  push:(state,url=port.url())=>{entries.splice(index+1);entries.push({state,url});index++;},replace:(state,url=port.url())=>{entries[index]={state,url};},
  go:delta=>pending.push(()=>{index=Math.max(0,Math.min(entries.length-1,index+delta));root.pop(activeDialogs.pop());})};
 const dialogs=new DialogHistory(port,'document-a'),root=new RootHistory(port,'document-a');activeDialogs=dialogs;root.subscribe(value=>messages.push(value));
 const mount=(key,address,busy=()=>false)=>dialogs.register({key,address:()=>address,busy,close:()=>closed.push(key)});
 const settle=async()=>{await tick();while(pending.length){pending.shift()();await tick();}};
 const travel=async delta=>{port.go(delta);await settle();};
 return {entries,port,root,dialogs,closed,messages,mount,settle,travel,useDialogs:value=>{activeDialogs=value;},setSession:v=>{session=v;root.sessionChanged();},get index(){return index;}};
}
test('첫 화면 지킴은 원본처럼 사용자 접촉 후 한 칸만 만들고 첫 뒤로에 안내한다',async()=>{
 const html=readFileSync(new URL('../app.html',import.meta.url),'utf8'),a=html.indexOf('    const Back = {'),b=html.indexOf("    window.addEventListener('popstate'",a),events={},oldEntries=[null];let oldIndex=0;const oldMessages=[];
 const ctx={EMBED_PLAZA:false,location:{href:'/app.html'},App:{memberId:'fake'},toast:x=>oldMessages.push(x),document:{addEventListener:(k,fn)=>{events[k]=fn;},removeEventListener:k=>{delete events[k];}},history:{get state(){return oldEntries[oldIndex];},replaceState:s=>{oldEntries[oldIndex]=s;},pushState:s=>{oldEntries[++oldIndex]=s;}},setTimeout:fn=>fn()};vm.createContext(ctx);vm.runInContext(html.slice(a,b)+';this.back=Back',ctx);ctx.back.enter();assert.equal(oldEntries.length,1);events.click();oldIndex--;ctx.back.onPop({state:oldEntries[oldIndex]});
 const modern=browser();modern.root.enter('fake-session-a');assert.equal(modern.entries.length,2);modern.root.touch();modern.root.touch();assert.equal(modern.entries.length,3);await modern.travel(-1);assert.equal(modern.messages.at(-1),oldMessages.at(-1));assert.equal(modern.messages.at(-1),EXIT_MESSAGE);await modern.travel(-1);assert.equal(modern.port.url(),'/outside');
});
test('Next 상태 보존·같은 로그인 재마운트·계정 교체·로그아웃 경계를 유지한다',async()=>{
 const b=browser();b.root.enter('fake-session-a');b.root.enter('fake-session-a');assert.equal(b.port.state().__NA,true);assert.equal(b.port.state().tree,'next tree');assert.ok(!JSON.stringify(b.port.state()).includes('fake-session-a'));b.root.touch();const count=b.entries.length;b.setSession(null);await b.travel(-1);b.root.touch();assert.equal(b.messages.at(-1),'');assert.equal(b.entries.length,count);
 b.setSession('fake-session-b');b.root.enter('fake-session-b');const owner=b.port.state()[ROOT].owner;assert.ok(owner.endsWith(':2'));b.root.touch();await b.travel(-1);assert.equal(b.messages.at(-1),EXIT_MESSAGE);
});
test('중간 업무 화면 뒤로는 이전 화면만 열고 첫 화면에서만 나가기 안내를 한다',async()=>{
 const b=browser();b.root.enter('fake-session-a');b.root.touch();b.port.push({__NA:true,tree:'activities'},'/activities');b.root.enter('fake-session-a');b.root.touch();assert.equal(b.entries.length,4);await b.travel(-1);assert.equal(b.port.url(),'/community?section=story');assert.equal(b.messages.at(-1),'');await b.travel(-1);assert.equal(b.messages.at(-1),EXIT_MESSAGE);b.root.touch();assert.equal(b.messages.at(-1),'');assert.equal(b.port.state()[ROOT].kind,'guard');
});
test('팝업 뒤로·저장 중 복원·프로그램 닫기는 나가기 안내와 충돌하지 않는다',async()=>{
 const b=browser();b.root.enter('fake-session-a');let busy=true;const off=b.mount('form',undefined,()=>busy);await b.settle();b.root.touch();assert.equal(b.entries.length,3);await b.travel(-1);assert.deepEqual(b.closed,[]);assert.equal(b.messages.at(-1),'');busy=false;off();await b.settle();assert.equal(b.messages.at(-1),'');b.root.touch();await b.travel(-1);assert.equal(b.messages.at(-1),EXIT_MESSAGE);
});
test('브라우저 이동 단축키나 막힌 history가 반복 지킴/예외를 만들지 않는다',()=>{
 for(const event of [{type:'keydown',key:'ArrowLeft',altKey:true},{type:'keydown',key:'[',metaKey:true},{type:'keydown',key:'BrowserBack'},{type:'keydown',key:'Escape'}])assert.equal(isHistoryInteraction(event),false);
 for(const event of [{type:'click'},{type:'pointerup'},{type:'keydown',key:'Enter'}])assert.equal(isHistoryInteraction(event),true);
 const b=browser();b.port.replace=()=>{throw Error('blocked');};assert.doesNotThrow(()=>b.root.enter('fake-session-a'));assert.doesNotThrow(()=>b.root.touch());
});
const address={base:'/community?section=story',open:'/community?section=story&post=FAKE-A'};
test('글 주소와 팝업은 한 칸만 만들고 뒤로/다음 뒤로에 글이 다시 열리지 않는다',async()=>{
 const b=browser();b.mount('post',address);await b.settle();assert.equal(b.entries.length,3);assert.equal(b.port.url(),address.open);assert.equal(b.entries[1].url,address.base);await b.travel(-1);assert.deepEqual(b.closed,['post']);assert.equal(b.port.url(),address.base);await b.travel(-1);assert.equal(b.port.url(),'/outside');
});
test('직접 글 링크·새로고침도 목록 바탕을 마련하고 앞으로는 읽기 상세만 다시 연다',async()=>{
 const b=browser(address.open);let off=b.mount('post',address);await b.settle();assert.equal(b.entries[1].url,address.base);off();await b.settle();assert.equal(b.port.url(),address.base);await b.travel(1);off=b.mount('post-again',address);await b.settle();assert.equal(b.entries.length,3);assert.equal(b.port.state()[DIALOG].depth,1);assert.equal(b.port.url(),address.open);
 const before=b.entries.length,reloaded=new DialogHistory(b.port,'new-document');reloaded.register({key:'reload',address:()=>address,close:()=>{},busy:()=>false});await tick();assert.equal(b.port.url(),address.open);assert.equal(b.entries[b.index-1].url,address.base);assert.equal(b.entries.length,before);
});
test('글 안의 연락처/사진과 처리 중 뒤로 가기도 주소·부모 단계를 보존한다',async()=>{
 const b=browser();let busy=true;b.mount('post',address,()=>busy);await b.settle();b.mount('photo');await b.settle();assert.equal(b.port.state()[DIALOG].depth,2);await b.travel(-2);assert.equal(b.port.url(),address.open);assert.equal(b.port.state()[DIALOG].depth,2);assert.deepEqual(b.closed,[]);busy=false;await b.travel(-1);assert.deepEqual(b.closed,['photo']);assert.equal(b.port.url(),address.open);await b.travel(-1);assert.deepEqual(b.closed,['photo','post']);assert.equal(b.port.url(),address.base);
});
test('글쓰기→저장 상세 교체는 새 칸 없이 주소만 연결하고 닫기 뒤 다른 글을 연다',async()=>{
 const b=browser(),off=b.mount('editor');await b.settle();off();let close=b.mount('post',address);await b.settle();assert.equal(b.entries.length,3);assert.equal(b.port.url(),address.open);close();await b.settle();close=b.mount('other',{...address,open:address.open.replace('FAKE-A','FAKE-B')});await b.settle();assert.equal(b.entries.length,3);assert.equal(b.port.url(),address.open.replace('FAKE-A','FAKE-B'));close();await b.settle();assert.equal(b.port.url(),address.base);
});
test('글에서 다른 업무로 이동한 뒤 해제가 새 경로를 되돌리거나 입력을 재생하지 않는다',async()=>{
 const b=browser(),off=b.mount('post',address);await b.settle();b.port.push({__NA:true,tree:'connect'},'/connect');off();await b.settle();assert.equal(b.port.url(),'/connect');assert.deepEqual(b.closed,[]);
});
test('새 문서에서도 기존 첫 화면 지킴 칸을 이어받고 다시 로그인하면 새 경계를 만든다',async()=>{
 const b=browser();b.root.enter('fake-session-a');b.root.touch();const reloaded=new RootHistory(b.port,'reloaded');let message='';reloaded.subscribe(value=>{message=value;});reloaded.enter('fake-session-a');reloaded.touch();assert.equal(b.entries.length,3);await b.travel(-1);reloaded.pop();assert.equal(message,EXIT_MESSAGE);b.setSession(null);reloaded.sessionChanged();b.setSession('fake-session-a');reloaded.enter('fake-session-a');assert.equal(b.port.state()[ROOT].owner,'reloaded:2');
});
test('반복 새로고침 뒤에도 원래 목록 칸을 인식해 한 번에 닫고 나가기 안내를 띄우지 않는다',async()=>{
 const b=browser();b.root.enter('fake-session-a');b.root.touch();b.mount('post',address);await b.settle();const before=b.entries.length,owner=b.port.state()[DIALOG].owner;
 for(const id of ['reload-1','reload-2','reload-3']){const next=new DialogHistory(b.port,id);b.useDialogs(next);next.register({key:id,address:()=>address,close:()=>b.closed.push(id),busy:()=>false});await tick();assert.equal(b.entries.length,before);assert.equal(b.port.state()[DIALOG].owner,owner);}
 await b.travel(-1);assert.equal(b.port.url(),address.base);assert.deepEqual(b.closed,['reload-3']);assert.equal(b.messages.at(-1),'');await b.travel(-1);assert.equal(b.messages.at(-1),EXIT_MESSAGE);b.root.clearNotice();assert.equal(b.messages.at(-1),'');assert.equal(EXIT_NOTICE_MS,2600);await b.travel(-1);assert.equal(b.port.url(),'/outside');
});

test('같은 계정 PIN 갱신은 팝업 정리 전후 모두 원래 경계를 이어받고 첫 뒤로에 안내한다',async()=>{
 for(const order of ['before-pop','after-pop']){
  const b=browser('/account'),old='m9900000000001.old.signature',next='m9900000000001.new.signature';b.setSession(old);b.root.enter(old);b.root.touch();const owner=b.port.state()[ROOT].owner,count=b.entries.length;
  const close=b.mount('pin');await b.settle();b.setSession(next);close();await tick();if(order==='before-pop')b.root.enter(next);await b.settle();if(order==='after-pop')b.root.enter(next);
  assert.equal(b.port.state()[ROOT].owner,owner,order);assert.equal(b.port.state()[ROOT].kind,'guard');b.root.touch();assert.equal(b.entries.length,count+1); // 이미 있던 닫힌 팝업 칸 외에는 추가하지 않는다.
  await b.travel(-1);assert.equal(b.messages.at(-1),EXIT_MESSAGE,order);assert.doesNotMatch(JSON.stringify(b.entries),/9900000000001|signature/);
  await b.travel(-1);assert.equal(b.port.url(),'/outside');
 }
});
test('중간 업무에서 PIN을 갱신해도 그 화면을 새 첫 화면으로 만들지 않는다',async()=>{
 const b=browser(),old='m9900000000001.old.signature',next='m9900000000001.next.signature';b.setSession(old);b.root.enter(old);b.root.touch();b.port.push({__NA:true,tree:'account'},'/account');const close=b.mount('pin');await b.settle();
 b.setSession(next);close();b.root.enter(next);await b.settle();const count=b.entries.length;b.root.touch();assert.equal(b.entries.length,count);assert.equal(b.port.state()[ROOT],undefined);assert.equal(b.port.state().tree,'account');
 await b.travel(-1);assert.equal(b.port.url(),'/community?section=story');assert.equal(b.messages.at(-1),'');await b.travel(-1);assert.equal(b.messages.at(-1),EXIT_MESSAGE);
});
test('갱신 후보는 인증 확인 전에는 비활성이며 로그아웃·다른 계정으로 넘어가면 폐기한다',async()=>{
 for(const abandon of [null,'m9900000000002.other.signature']){
  const b=browser(),old='m9900000000001.old.signature',next='m9900000000001.new.signature';b.setSession(old);b.root.enter(old);const owner=b.port.state()[ROOT].owner;b.root.touch();
  b.setSession(next);b.setSession(next);await b.travel(-1);assert.equal(b.messages.at(-1),'');const count=b.entries.length;b.root.touch();assert.equal(b.entries.length,count);
  b.setSession(abandon);b.root.enter(next);assert.equal(b.port.state()[ROOT].owner,owner);b.setSession(old);b.root.enter(old);assert.notEqual(b.port.state()[ROOT].owner,owner);b.root.touch();await b.travel(-1);assert.equal(b.messages.at(-1),EXIT_MESSAGE);
 }
});
test('다른 계정 로그인은 이전 팝업 정리 전에는 history를 덮지 않고 정리 후 새 경계를 만든다',async()=>{
 const b=browser('/account'),old='m9900000000001.old.signature',next='m9900000000002.new.signature';b.setSession(old);b.root.enter(old);b.root.touch();const owner=b.port.state()[ROOT].owner,close=b.mount('old-pin');await b.settle();
 b.setSession(next);close();await tick();b.root.enter(next);assert.equal(b.port.state()[ROOT].owner,owner);await b.settle();assert.notEqual(b.port.state()[ROOT].owner,owner);assert.equal(b.port.state()[DIALOG].depth,0);assert.equal(b.messages.at(-1),'');b.root.touch();await b.travel(-1);assert.equal(b.messages.at(-1),EXIT_MESSAGE);
});
