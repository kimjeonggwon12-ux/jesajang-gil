import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DialogHistory, DIALOG_HISTORY_KEY as KEY} from '../next-app/lib/dialog-history.ts';

const tick = async () => {await Promise.resolve(); await Promise.resolve();};
function browser() {
  const entries = [{url:'/menu',state:{tree:'menu'}},{url:'/activities',state:{tree:'activities',__NA:true}}];
  let index=1;const closed=[],moves=[],pending=[];
  const port={state:()=>entries[index].state,url:()=>entries[index].url,
    push:state=>{entries.splice(index+1);entries.push({url:port.url(),state});index++;},
    replace:state=>{entries[index]={...entries[index],state};},
    go:delta=>{moves.push(delta);const next=Math.max(0,Math.min(entries.length-1,index+delta));pending.push(()=>{index=next;manager.pop();});}};
  const manager=new DialogHistory(port,'document-a');
  const add=(key,busy=()=>false)=>manager.register({key,close:()=>closed.push(key),busy});
  const travel=async delta=>{port.go(delta);await settle();};
  const settle=async()=>{while(pending.length){pending.shift()();await tick();}};
  const navigate=url=>{entries.splice(index+1);entries.push({url,state:{tree:url}});index++;};
  return {entries,closed,moves,port,manager,add,travel,settle,navigate,get index(){return index;}};
}

test('뒤로 가기는 가장 위 팝업만 닫고 다음 뒤로 가기는 원래 페이지로 이동한다',async()=>{
  const b=browser();b.add('target');await tick();b.add('center');await tick();
  assert.equal(b.port.state()[KEY].depth,2);assert.equal(b.port.state().tree,'activities');
  await b.travel(-1);assert.deepEqual(b.closed,['center']);assert.equal(b.port.url(),'/activities');
  await b.travel(-1);assert.deepEqual(b.closed,['center','target']);assert.equal(b.port.url(),'/activities');
  await b.travel(-1);assert.equal(b.port.url(),'/menu');
});
test('닫기·취소로 unmount하면 해당 기록을 제거하고 부모는 그대로 남는다',async()=>{
  const b=browser(),parent=b.add('parent');await tick();const child=b.add('child');await tick();
  child();await tick();await b.settle();assert.equal(b.port.state()[KEY].depth,1);assert.deepEqual(b.closed,[]);
  parent();await tick();await b.settle();assert.equal(b.port.state()[KEY].depth,0);
  await b.travel(-1);assert.equal(b.port.url(),'/menu');
});
test('같은 렌더의 상세→편집 교체와 effect 재등록은 기록을 중복 생성하지 않는다',async()=>{
  const b=browser();let off=b.add('detail');await tick();const count=b.entries.length;
  off();off=b.add('edit');await tick();assert.equal(b.entries.length,count);assert.deepEqual(b.moves,[]);
  off();b.add('edit');await tick();assert.equal(b.entries.length,count);
  await b.travel(-1);assert.deepEqual(b.closed,['edit']);
});
test('처리 중인 팝업은 뒤로 가기로 닫히지 않고 처리 종료 뒤 정상 닫힌다',async()=>{
  const b=browser();let busy=true;b.add('save',()=>busy);await tick();
  await b.travel(-1);assert.equal(b.port.state()[KEY].depth,1);assert.deepEqual(b.closed,[]);
  busy=false;await b.travel(-1);assert.deepEqual(b.closed,['save']);assert.equal(b.port.state()[KEY].depth,0);
});
test('여러 층을 건너뛴 뒤로 가기도 위에서부터 닫고 처리 중인 층을 건너뛰지 않는다',async()=>{
  const b=browser();let busy=true;b.add('parent',()=>busy);await tick();b.add('child');await tick();
  await b.travel(-2);assert.deepEqual(b.closed,[]);assert.equal(b.port.state()[KEY].depth,2);
  busy=false;await b.travel(-2);assert.deepEqual(b.closed,['child','parent']);
});
test('링크 이동 후 해제는 새 페이지를 뒤로 돌리지 않는다',async()=>{
  const b=browser(),off=b.add('guide');await tick();b.navigate('/library');off();await tick();
  assert.equal(b.port.url(),'/library');assert.deepEqual(b.moves,[]);
});
test('닫기 기록 정리 중 새 팝업이 열려도 새 팝업을 닫거나 이전 경로로 보내지 않는다',async()=>{
  const b=browser(),off=b.add('old');await tick();off();await tick();b.add('new');await tick();await b.settle();
  assert.equal(b.port.url(),'/activities');assert.equal(b.port.state()[KEY].depth,1);assert.deepEqual(b.closed,[]);
  await b.travel(-1);assert.deepEqual(b.closed,['new']);
});
test('로그아웃 뒤 앞으로·새 문서의 옛 기록은 닫힌 팝업이나 개인정보를 복원하지 않는다',async()=>{
  const b=browser(),off=b.add('private');await tick();off();await tick();await b.settle();
  await b.travel(1);assert.deepEqual(b.closed,[]);assert.equal(b.port.state()[KEY].depth,0);
  const reloaded=new DialogHistory(b.port,'new-document');reloaded.pop();
  assert.deepEqual(b.closed,[]);assert.deepEqual(Object.keys(b.port.state()[KEY]).sort(),['depth','owner']);
});
test('기록 API가 차단돼도 등록·해제는 예외를 전파하거나 무한 재시도하지 않는다',async()=>{
  const b=browser();let attempts=0;b.port.push=()=>{attempts++;throw Error('blocked');};
  const off=b.add('view');await tick();off();await tick();assert.equal(attempts,1);assert.deepEqual(b.moves,[]);
});
