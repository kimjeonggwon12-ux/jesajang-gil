import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {roomUnread,mergeRoomMessages,cleanRoomCode,roomFileError,ROOM_FILE_MAX,roomInviteText,filterOpeningRooms} from '../next-app/lib/rooms.ts';
import {saveGuestSession,loadSession,clearSession} from '../next-app/lib/session.ts';
import {localRoomUploadResult} from '../tools/local-room-storage.mjs';
test('읽지 않은 사람 수는 기존 화면의 보낸 사람·삭제·알림 제외 규칙과 같다',()=>{
  const html=readFileSync(new URL('../app.html',import.meta.url),'utf8'),a=html.indexOf('    function trUnreadN('),b=html.indexOf('    function trMsgHtml(',a),old={trSt:{reads:[[1,4],[2,7],[3,0]]}};vm.createContext(old);vm.runInContext(html.slice(a,b),old);
  for(const from of ['','가짜'])for(const mine of [true,false])for(const deleted of [true,false])for(const id of [1,5,8]){const message={from,mine,deleted,id,fk:2};assert.equal(roomUnread(message,old.trSt.reads),old.trUnreadN(message));}
});
test('새 대화 병합은 ID 순서·중복 제거·삭제된 글 갱신을 유지한다',()=>{
  const initial=[{id:3,text:'셋'},{id:1,text:'첫'}],incoming=[{id:2,text:'둘'},{id:3,text:'',deleted:true}];
  assert.deepEqual(mergeRoomMessages(initial,incoming),[{id:1,text:'첫'},{id:2,text:'둘'},{id:3,text:'',deleted:true}]);assert.equal(initial[0].text,'셋');
});
test('초대 코드·첨부 종류·50MB 경계는 기존 계약이며 초대 글에 대상자를 넣지 않는다',()=>{
  assert.equal(cleanRoomCode(' room-test '),'ROOMTEST');assert.equal(cleanRoomCode('ab cd1234extra'),'ABCD1234');
  for(const name of ['a.pdf','a.PPTX','a.pps','a.ppsx','a.hwp','a.hwpx'])assert.equal(roomFileError({name,type:'application/octet-stream',size:ROOM_FILE_MAX}),'');
  for(const file of [{name:'a.exe',type:'',size:1},{name:'a.pdf',type:'',size:0},{name:'a.pdf',type:'',size:ROOM_FILE_MAX+1}])assert.ok(roomFileError(file));
  assert.equal(roomFileError({name:'image.png',type:'image/png',size:ROOM_FILE_MAX+1}),'');
  assert.match(roomInviteText('http://127.0.0.1:58434','ROOMTEST'),/\/rooms\?code=ROOMTEST/);assert.doesNotMatch(roomInviteText('http://127.0.0.1:58434','ROOMTEST'),/target=|990000/);
});
test('손님 저장은 서버 표의 별도 ID만 사용하고 일반 로그인 표와 PIN 저장을 섞지 않는다',()=>{
  const oldLocal=globalThis.localStorage,oldSession=globalThis.sessionStorage;const store=()=>{const rows=new Map();return {getItem:key=>rows.get(key)||null,setItem:(key,value)=>rows.set(key,value),removeItem:key=>rows.delete(key)};};
  try{globalThis.localStorage=store();globalThis.sessionStorage=store();localStorage.setItem('podo_pin','이전 PIN 보조');const saved=saveGuestSession('g999999999999999999999999999999.x.y',{memberId:'99000999',name:'가짜손님',dept:'청년회'});assert.equal(saved.account.memberId,'999999999999999999999999999999');assert.equal(saved.account.guest,true);assert.equal(localStorage.getItem('podo_pin'),null);assert.deepEqual(loadSession(),saved);assert.throws(()=>saveGuestSession('m9900000000001.x.y',saved.account));clearSession();assert.equal(loadSession(),null);}finally{globalThis.localStorage=oldLocal;globalThis.sessionStorage=oldSession;}
});
test('로컬 직접 첨부 주소는 지정 가짜 버킷만 바꾸고 실제 주소는 건드리지 않는다',()=>{
  const real={put:'https://real.example.test/bucket/file.pdf'};assert.equal(localRoomUploadResult(real),real);
  const fake={put:'https://local-image-fixture.r2.cloudflarestorage.com/fake-images/room-files/2026-11/f.pdf?X-Amz=FAKE',url:'fake-original'};assert.equal(localRoomUploadResult(fake).put,'http://127.0.0.1:58433/__local_image_fixture/room-files/2026-11/f.pdf');assert.equal(localRoomUploadResult(fake).url,'fake-original');
});
test('개강 목록은 기존 부서 묶음·복수 지역/단계·숫자 검색·방 유무·동률 정렬을 보존한다',()=>{
  const html=readFileSync(new URL('../app.html',import.meta.url),'utf8'),start=html.indexOf('    const ofbAdm ='),a=html.indexOf('      const MAIN =',start),b=html.indexOf('      function css()',a),c=html.indexOf('      const deptOf =',b),d=html.indexOf('      function card(',c);
  const rows=Array.from({length:330},(_,i)=>({id:String(i),dept:['교역자','자문회','장년회','부녀회','청년회','전도부',''][i%7],region:['3지역','03지역','10지역','지역 없음',''][i%5],stage:['센터수강','복음방','상담1'][i%3],teacher:'가짜교사'+i%4,name:'가짜대상'+i,room:i%2===0,lastReport:i%3?'2026-11-01':''}));
  const context={st:{rows}};vm.createContext(context);vm.runInContext(html.slice(a,b)+html.slice(c,d),context);
  for(const dept of ['전체','청년회','그 밖'])for(const regions of [[],['3'],['3','10']])for(const stages of [[],['복음방','센터수강']])for(const query of ['','3','03지역','가짜교사1','전도부'])for(const only of [true,false]){
    const filter={dept,regions,stages,query,only};Object.assign(context.st,filter,{q:query});const expected=JSON.parse(JSON.stringify(context.filtered()));assert.deepEqual(filterOpeningRooms(rows,filter),expected);
  }
  assert.equal(filterOpeningRooms(rows,{dept:'전체',regions:[],stages:[],query:'',only:false}).length,330);
});
