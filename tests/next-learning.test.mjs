import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as p from '../next-app/lib/learning-content.mjs';
import {groupCourses,searchLearning,receivePlayback,resumeAt,lecturePct,createProgressSaver,snippetText,highlightParts} from '../next-app/lib/learning.ts';
const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const part=(a,b)=>{const start=html.indexOf(a);assert.ok(start>=0,a);const end=html.indexOf(b,start);assert.ok(end>start,b);return html.slice(start,end);};
const old=vm.createContext({esc:p.esc,VT_TABS:p.VT_TABS,vtState:{cache:{}}});
vm.runInContext(part('const TBX_BOOKS =','function tbxInline(')+part('function tsTerms(', 'function tbSearchRender('),old);
vm.runInContext(part('function vdIdFrom(', 'async function vdLoad(')+part('const vdNorm =','function vdDupCheck(')+part('function vtText(', 'function vtRender(')+part('function vtMsgs(', 'async function vtRun(')+part('const VT_ROMAN =','async function vtCopy('),old);
test('교재 줄 연결·검색·미리보기와 중복 영상 규칙이 기존 HTML 함수와 같다',()=>{
 const samples=['제목: 첫걸음\n| 학습 목표 |\n1. 질문\n2. 경청\n\n● 성경\n• 요 3:16 말씀\n1. 시작\n(대답 듣기) 긴 문장입니다.','여기에 충분히 긴 원래 문장의 앞부분이 있고 계속 연결해 설명하는\n다음 줄입니다.\n\n마무리입니다.','<script>alert(1)</script> & "상담"\n상 담 내용을 찾습니다.'];
 for(const text of samples){assert.deepEqual(p.tbxJoin(text),Array.from(old.tbxJoin(text)));for(const q of ['상담','성경 질문','요 3:16','.*','']){const terms=p.tsTerms(q);assert.equal(p.tsMatch(text,terms),old.tsMatch(text,terms));assert.equal(p.tsSnippet(text,terms),old.tsSnippet(text,terms));const s=snippetText(text,terms),render=highlightParts(s,terms).map((x,i)=>i%2?`<mark class="ts-hit">${p.esc(x)}</mark>`:p.esc(x)).join('');assert.equal(render,p.tsSnippet(text,terms));}}
 for(const [a,b]of [['상담 1강','상담 2강'],['교사 교육 입문과 자세','교사교육 입문과 자세'],['가짜 영상','완전히 다른 제목']])assert.equal(p.vdSimilarTitle(a,b),old.vdSimilarTitle(a,b));for(const url of ['FAKEVID0001','https://youtu.be/FAKEVID0001?t=5','https://youtube.com/watch?v=FAKEVID0002','bad'])assert.equal(p.vdIdFrom(url),old.vdIdFrom(url));
});
test('강좌 묶음·제목 우선 검색·빈 목록과 이어 보기 계산을 보존한다',()=>{
 const base={courseId:'1',courseName:'A',unitName:'첫 단원',order:2,content:'경청 상담',category:'상담',minutes:1};const rows=[base,{...base,courseId:'2',order:1,unitName:'경청 제목'},{...base,courseId:'3',courseName:'__proto__'}];assert.deepEqual(groupCourses(rows).map(g=>g.units.map(u=>u.courseId)),[['2','1'],['3']]);assert.deepEqual(searchLearning(rows,[],'경청').units.slice(0,1).map(u=>u.courseId),['2']);assert.equal(searchLearning(rows,[],'없는 내용').units.length,0);
 assert.equal(resumeAt({completed:false,lastPos:30,duration:100}),30);for(const x of [{completed:true,lastPos:30,duration:100},{completed:false,lastPos:5,duration:100},{completed:false,lastPos:90,duration:100}])assert.equal(resumeAt(x),0);assert.equal(lecturePct({lessons:[{completed:true,pct:90},{completed:false,pct:30}]}),65);assert.equal(lecturePct({lessons:[]}),0);
});
test('녹취·전도 문구·워드 출력은 기존 본문·서식을 보존하고 HTML을 이스케이프한다',()=>{
 const v={id:'X',title:'가짜 <script>제목</script>',videoId:'FAKEVID0001',part:'소양,상담',uploadDate:'2026-11-12'},r={summary:'## 큰 제목\n### 작은 제목\n**굵게** <img src=x onerror=alert(1)>\n- 목록\n> 인용',transcript:'## [00:10] 녹취\n내용',pkg:{lesson:'[교안 — 안내]\n## 교안\n가짜 내용',share:'질문',quiz:'### 1. 가짜 퀴즈',outreach:'## 제목\n**문구** [영상 링크]'}};old.vtState.cache.X=r;
 for(const k of [...p.VT_TABS.map(x=>x[0]),'all']){if(k!=='all')assert.equal(p.vtText(v,r,k),old.vtText(v,r,k));const doc=p.vtLesson(v,r,k);assert.deepEqual(doc,JSON.parse(JSON.stringify(old.vtLesson(v,k))));assert.doesNotMatch(doc.html,/<script>|<img/);}
 assert.deepEqual(p.vtMsgs(r.pkg.outreach),JSON.parse(JSON.stringify(old.vtMsgs(r.pkg.outreach))));
});
test('실제 연속 재생 10초 칸은 합치고 건너뛰기·일시정지·잘못된 시간은 제외한다',()=>{
 const x={buckets:new Set(),lastT:null,state:-1,duration:0,pos:0};receivePlayback(x,{duration:100,playerState:1,currentTime:0});for(let i=1;i<=21;i++)receivePlayback(x,{currentTime:i});assert.deepEqual([...x.buckets],[0,1,2]);receivePlayback(x,{currentTime:80});assert.deepEqual([...x.buckets],[0,1,2]);receivePlayback(x,{playerState:2,currentTime:90});receivePlayback(x,{playerState:1,currentTime:90});receivePlayback(x,{currentTime:91});assert.deepEqual([...x.buckets],[0,1,2,9]);receivePlayback(x,{duration:NaN,currentTime:Infinity});assert.equal(x.duration,100);assert.equal(x.pos,91);
});
test('진도 저장은 직렬·중복 방지이며 실패 후 자동 재시도하지 않고 계정 변경 때 멈춘다',async()=>{
 let body={lectureId:'L',videoKey:'V',buckets:[0],duration:100,lastPos:10},active=true,calls=0,fail=false,errors=0,saved=0;
 const save=createProgressSaver({body:()=>body,active:()=>active,send:async()=>{calls++;await new Promise(r=>setTimeout(r,5));if(fail)throw Error('가짜 실패');return {pct:10,completed:false};},saved:()=>saved++,failed:()=>errors++});
 await Promise.all([save(),save(),save()]);assert.equal(calls,1);body={...body,lastPos:11};fail=true;assert.equal(await save(),false);assert.equal(await save(),false);assert.equal(calls,2);fail=false;assert.equal(await save(true),true);assert.equal(calls,3);assert.equal(errors,1);assert.equal(saved,2);active=false;body={...body,lastPos:12};await save(true);assert.equal(calls,3);
});
