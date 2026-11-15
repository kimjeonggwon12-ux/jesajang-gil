import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../next-app/worker/pilot-bridge.js',import.meta.url),'utf8');
// 실제 브라우저 결과와 구분하는 이벤트 계약 검사. 로그인 전환/오래 열린 폼/오류를 재현한다.
function harness({site='B',token='',reply={enabled:true,site:'common'},status=200}={}){
 const events={},store=new Map(token?[['pd_tk_v1',token]]:[]),nodes=new Map(),state={reloads:0,confirms:0,calls:0,reply,status};
 const node=()=>({style:{},setAttribute(){},remove(){nodes.delete(this.id);},append(){},appendChild(){}});
 const document={currentScript:{dataset:{site}},documentElement:{setAttribute(){},removeAttribute(){}},head:node(),body:{append(n){nodes.set(n.id,n);}},getElementById:id=>nodes.get(id),createElement:node,addEventListener:(name,fn)=>{events[name]=fn;}};
 const window={addEventListener:(name,fn)=>{events[name]=fn;}};
 const location={pathname:'/',search:'',href:'http://127.0.0.1:58444/',origin:'http://127.0.0.1:58444',reload(){state.reloads++;},assign(){}};
 vm.runInNewContext(source,{window,document,location,localStorage:{getItem:k=>store.get(k)||null,removeItem:k=>store.delete(k)},fetch:async()=>{state.calls++;return {status:state.status,ok:state.status<400,json:async()=>state.reply};},URL,Date,confirm:()=>{state.confirms++;return false;}});
 return {state,events,store,nodes,settle:()=>new Promise(resolve=>setImmediate(resolve))};
}
test('첫 로그인으로 A 배정 시 불필요한 작성 취소 확인 없이 새 화면을 연다',async()=>{const h=harness();await h.settle();h.events.input();h.store.set('pd_tk_v1','signed-login');h.state.reply={enabled:true,site:'A'};h.events['ts-session-change']();await h.settle();assert.equal(h.state.reloads,1);assert.equal(h.state.confirms,0);});
test('오래 열린 B 작성 중 A 복귀는 입력을 확인 없이 버리지 않는다',async()=>{const h=harness({token:'signed-login',reply:{enabled:true,site:'B'}});await h.settle();h.events.input();h.state.reply={enabled:true,site:'A'};h.events['ts-session-change']();await h.settle();assert.equal(h.state.reloads,0);assert.equal(h.state.confirms,1);});
test('배정 서버 실패는 화면 위 오류로 막고 임의 그룹으로 계속하지 않는다',async()=>{const h=harness({token:'signed-login',status:503});await h.settle();assert.ok(h.nodes.has('pilot-entry-error'));assert.equal(h.state.reloads,0);});
test('만료된 로그인은 브라우저 표를 지우고 다시 입장한다',async()=>{const h=harness({token:'expired',status:401});await h.settle();assert.equal(h.store.has('pd_tk_v1'),false);assert.equal(h.state.reloads,1);});
test('배정 기능 비활성은 화면 이동을 강제하지 않으며 반복 타이머도 만들지 않는다',async()=>{const h=harness({token:'signed-login',reply:{enabled:false,site:'B'}});await h.settle();assert.equal(h.state.reloads,0);assert.equal(h.state.calls,1);assert.doesNotMatch(source,/setInterval/);});
