// 외부 서비스·DB를 사용하지 않고 교체한 엑셀/백그라운드 라이브러리의 기존 계약을 확인한다.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {runLater,settled} from '../server/lib/background.js';
import * as nextXlsx from '../next-app/node_modules/xlsx/xlsx.mjs';
import '../roster-excel.js';

const require=createRequire(import.meta.url),nodeXlsx=require('xlsx');
// File.arrayBuffer()와 라이브러리가 같은 브라우저 전역의 타입을 쓰는 조건을 재현한다.
const browser=vm.createContext({console,ArrayBuffer,Uint8Array,DataView});
vm.runInContext(readFileSync(new URL('../vendor/xlsx.full.min.js',import.meta.url),'utf8'),browser);
const implementations=[['개발 도구',nodeXlsx],['기존 화면',browser.XLSX],['Next 화면',nextXlsx]];
const headers=['고유번호','이름','부서','지역','소속비고','교육','상담','복음방','식구복방','동행교사','과제제출','인도','교사','섬김','활동','우수,정','구분'];
const rows=Array.from({length:1105},(_,i)=>[`00999999-${String(i+1).padStart(5,'0')}`,`검증교사${i+1}`,'청년회','1지역','',2,3,2,0,1,1,1,0,0,1,0,'정교사']);
const expected=[['검증용 교사활동현황'],headers,...rows];
const plain=value=>JSON.parse(JSON.stringify(value));

test('교체한 엑셀 배포본은 공식 0.20.3이며 브라우저 파일도 같은 배포본이다',()=>{
  for(const [name,xlsx]of implementations)assert.equal(xlsx.version,'0.20.3',name);
  assert.deepEqual(readFileSync(new URL('../vendor/xlsx.full.min.js',import.meta.url)),readFileSync(new URL('../node_modules/xlsx/dist/xlsx.full.min.js',import.meta.url)));
});

for(const format of ['xlsx','biff8'])test(`${format}: 세 실행 경로의 한글·앞자리 0·1105행·여러 시트 읽기와 명단 계산이 같다`,()=>{
  for(const [writerName,writer]of implementations){
    const book=writer.utils.book_new();
    writer.utils.book_append_sheet(book,writer.utils.aoa_to_sheet(expected),'11월');
    writer.utils.book_append_sheet(book,writer.utils.aoa_to_sheet([['교육','출석','점수'],['목요교육',true,98.5]]),'교육결과');
    const bytes=writer.write(book,{type:'array',bookType:format});
    for(const [readerName,reader]of implementations){
      const loaded=reader.read(bytes,{type:'array'});
      assert.deepEqual(plain(loaded.SheetNames),['11월','교육결과'],`${writerName} → ${readerName}`);
      const table=plain(reader.utils.sheet_to_json(loaded.Sheets['11월'],{header:1,raw:true,defval:''}));
      assert.deepEqual(table,expected.map(row=>Array.from({length:headers.length},(_,i)=>row[i]??'')));
      const parsed=globalThis.RosterExcel.parse(name=>name==='11월'?table:null,'11월');
      assert.equal(parsed.rows.length,1105);
      assert.equal(parsed.rows[0].memberId,'00999999-00001');
      assert.equal(parsed.rows[1104].name,'검증교사1105');
      assert.equal(parsed.rows[0].counsel,3);
      assert.equal(parsed.rows[0].tier,'정교사');
      assert.deepEqual(plain(reader.utils.sheet_to_json(loaded.Sheets['교육결과'],{header:1})),[['교육','출석','점수'],['목요교육',true,98.5]]);
    }
  }
});

test('실제 waitUntil 라이브러리가 응답 뒤 작업의 성공·실패를 받아 완료하며 로컬에서도 동작한다',async()=>{
  const symbol=Symbol.for('@vercel/request-context'),previous=globalThis[symbol],env=process.env.VERCEL;
  const handed=[],logs=[];const log=console.log;
  try{
    globalThis[symbol]={get:()=>({waitUntil:promise=>handed.push(promise)})};
    process.env.VERCEL='1';console.log=value=>logs.push(String(value));
    let finish,done=false;
    runLater(new Promise(resolve=>{finish=()=>{done=true;resolve();};}));
    runLater(Promise.reject(new Error('검증용 실패')));
    assert.equal(handed.length,2);assert.equal(done,false);
    finish();await settled();await Promise.all(handed);
    assert.equal(done,true);assert.equal(logs.length,1);assert.match(logs[0],/검증용 실패/);
    delete process.env.VERCEL;runLater(Promise.resolve());await settled();assert.equal(handed.length,2);
  }finally{
    if(previous===undefined)delete globalThis[symbol];else globalThis[symbol]=previous;
    if(env===undefined)delete process.env.VERCEL;else process.env.VERCEL=env;
    console.log=log;
  }
});
