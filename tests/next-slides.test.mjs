import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import sharp from 'sharp';
import {askAi,normalize,buildSlides,fillPptx,fixWrap,svgOf,THEMES,MOTIFS} from '../next-app/lib/coaching-slides.mjs';
import {slideFixture} from './helpers/slide-fixture.mjs';
const source=readFileSync(new URL('../coach-slides.js',import.meta.url),'utf8'),ctx={window:{},Date};vm.runInNewContext(source.replace('_test: { normalize','_test: { askAi, normalize'),ctx);const old=ctx.window.CoachSlides._test,plain=x=>JSON.parse(JSON.stringify(x));
test('10쪽 슬라이드의 기존 정규화·모든 색상/그림·좌표·메모·PPT 호출이 같다',()=>{
 const spy=()=>{const calls=[];return{calls,ShapeType:{roundRect:'roundRect',rect:'rect',rightArrow:'rightArrow'},addSlide(){const sl={};for(const k of ['addShape','addText','addImage','addNotes'])sl[k]=(...args)=>calls.push([k,...plain(args)]);calls.push(['slide']);return sl;}};};
 for(const theme of Object.keys(THEMES))for(const motif of Object.keys(MOTIFS)){const raw={...slideFixture,theme,coverMotif:motif},data=normalize(raw),expected=old.normalize(plain(raw));assert.deepEqual(plain(data),plain(expected));const slides=buildSlides(data),before=old.buildSlides(expected);assert.equal(slides.length,10);assert.deepEqual(plain(slides),plain(before));const a=spy(),b=spy();fillPptx(a,slides,{[motif]:'data:image/png;base64,AAAA'});old.fillPptx(b,before,{[motif]:'data:image/png;base64,AAAA'});assert.deepEqual(a.calls,b.calls);for(const slide of slides)for(const e of slide.els){assert.ok(e.x>=0&&e.y>=0&&e.x+e.w<=13.334&&e.y+e.h<=7.501);}}
 const long={cover:{line1:'아주 긴 제목'.repeat(20)},notes:['메모'.repeat(200)],life:{people:[null,{},{}]}};assert.deepEqual(plain(normalize(long)),plain(old.normalize(plain(long))));
});
test('슬라이드 프롬프트·JSON 추출을 보존하며 실패·생각 파트·잘못된 테마를 구분한다',async()=>{
 const captures=[],make=call=>({text:'### 가짜 심리 상담',targetGroup:'청년',stage:'상담',callApi:async body=>{captures.push(body);return call;}}),answer={candidates:[{content:{parts:[{thought:true,text:'무시할 생각'},{text:'```json\n'+JSON.stringify(slideFixture)+'\n```'}]}}]};assert.deepEqual(plain(await askAi(make(answer))),plain(await old.askAi(make(answer))));assert.deepEqual(plain(captures[0]),plain(captures[1]));for(const text of ['','⚠️ 가짜 오류','가짜 잘못된 JSON'])await assert.rejects(askAi(make({candidates:[{content:{parts:[{text}]}}]})));
 for(const invalid of ['__proto__','constructor','toString','모르는 값']){const d=normalize({theme:invalid,coverMotif:invalid,wisdomMotif:invalid});assert.equal(d.theme,'calm');assert.equal(d.coverMotif,'tea');assert.equal(d.wisdomMotif,'tree');assert.equal(buildSlides(d).length,10);}
});
test('기존 보관 PPT 라이브러리로 실제 10쪽·그림 2개·메모·한글 줄바꿈 파일을 만든다',async()=>{
 const runtime={console,setTimeout,clearTimeout,Uint8Array,Uint16Array,Uint32Array,ArrayBuffer,DataView,TextEncoder,TextDecoder,Blob,Buffer,Date};runtime.window=runtime;runtime.self=runtime;vm.createContext(runtime);vm.runInContext(readFileSync(new URL('../vendor/pptxgen.bundle.js',import.meta.url),'utf8'),runtime);assert.equal(typeof runtime.PptxGenJS,'function');assert.ok(runtime.JSZip);
 const d=normalize(slideFixture),slides=buildSlides(d),images={};for(const m of [d.coverMotif,d.wisdomMotif])images[m]='data:image/png;base64,'+(await sharp(Buffer.from(svgOf(m,THEMES[d.theme]))).png().toBuffer()).toString('base64');const pptx=new runtime.PptxGenJS();pptx.title='대상자 맞춤 심리 코칭';fillPptx(pptx,slides,images);const bytes=await fixWrap(await pptx.write({outputType:'arraybuffer'}),runtime.JSZip,'uint8array'),zip=await runtime.JSZip.loadAsync(bytes);
 const files=Object.keys(zip.files),pages=files.filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n));assert.equal(pages.length,10);assert.equal(files.filter(n=>/^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n)).length,10);assert.equal(files.filter(n=>/^ppt\/media\/.*\.png$/.test(n)).length,2);
 for(const file of pages){const xml=await zip.file(file).async('string');assert.match(xml,/lang="ko-KR"/);assert.ok((xml.match(/<a:pPr\b[^>]*>/g)||[]).every(tag=>tag.includes('latinLnBrk="0"')));assert.doesNotMatch(xml,/undefined|NaN/);}
 assert.match(await zip.file('ppt/slides/slide1.xml').async('string'),/가짜 상담 자료/);assert.match(await zip.file('ppt/notesSlides/notesSlide10.xml').async('string'),/정신건강 전문 기관/);assert.ok(bytes.byteLength>10000);const out=new URL('../../artifacts/next-phase12-20261112/',import.meta.url);mkdirSync(out,{recursive:true});writeFileSync(new URL('slides-contract.pptx',out),Buffer.from(bytes));writeFileSync(new URL('pptx-structure.json',out),JSON.stringify({slides:pages.length,notes:10,png:2,bytes:bytes.byteLength,language:'ko-KR',latinLineBreak:false},null,2));
});
