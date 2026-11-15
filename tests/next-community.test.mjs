import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {caseCompose,caseParse,postTags,contestOrder,contestName,contestMeaning,commentOrder,mosaicRect} from '../next-app/lib/community.ts';
test('기존 7항목 사례 작성/복원은 빈 항목 128조합과 자유 본문에서 동일하다',()=>{
 const html=readFileSync(new URL('../app.html',import.meta.url),'utf8'),a=html.indexOf('      const CASE_SECTIONS ='),b=html.indexOf('      /** 글 본문 보기:',a),context={};vm.createContext(context);vm.runInContext(html.slice(a,b)+'\nthis.compose=caseCompose;this.parse=caseParse;',context);
 for(let bits=0;bits<128;bits++){const sections=Array.from({length:7},(_,i)=>bits&(1<<i)?'  가짜 내용 '+i+'\n다음 줄  ':'');const body=caseCompose(sections);assert.equal(body,context.compose(sections));assert.deepEqual(caseParse(body),JSON.parse(JSON.stringify(context.parse(body))));}
 for(const body of ['자유롭게 쓴 사례','본문\n1. 깨달은 점\n내용','1. 깨달은 점\n내용\n2. 임의 제목\n내용',''])assert.deepEqual(caseParse(body),JSON.parse(JSON.stringify(context.parse(body))));
});
test('이름 공모·댓글 순서·태그 처리에서 원본 배열과 기존 순위를 보존한다',()=>{
 const p=(id,likes,comments,date,title='[이름 공모] '+id)=>({postId:id,title,summary:'담은 뜻: 의미',likeCount:likes,commentCount:comments,createdAt:date});const rows=[p('a',3,1,'01'),p('b',3,2,'01'),p('c',3,2,'02'),p('d',9,0,'01','일반 글')];assert.deepEqual(contestOrder(rows).map(p=>p.postId),['c','b','a']);assert.equal(rows.length,4);assert.equal(contestName(rows[0]),'a');assert.equal(contestMeaning(rows[0]),'의미');assert.deepEqual(commentOrder(rows,true),[...rows].reverse());assert.equal(commentOrder(rows,false),rows);assert.deepEqual(postTags('##사례, #교사 사례   '+('긴'.repeat(25))),['사례','교사','긴'.repeat(20)]);
});
test('모자이크 누르기와 역방향 드래그는 사진 밖으로 나가지 않는다',()=>{
 assert.deepEqual(mosaicRect(1000,800,{x:500,y:400},{x:500,y:400},true),{x:436,y:336,w:128,h:128});assert.deepEqual(mosaicRect(1000,800,{x:900,y:700},{x:100,y:50},false),{x:100,y:50,w:800,h:650});assert.deepEqual(mosaicRect(1000,800,{x:999,y:799},{x:999,y:799},true),{x:935,y:735,w:65,h:65});
});
