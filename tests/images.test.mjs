import {test,beforeEach,mock} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import sharp from 'sharp';
import {prepareImage,IMAGE_MAX_BYTES} from '../server/lib/image-variants.js';
import {imageFixture} from './helpers/image-fixture.mjs';
let writes=[],failPreview=false;
mock.module('aws4fetch',{exports:{AwsClient:class {async fetch(url,init){
  assert.equal(init.method,'PUT');writes.push({url,...init});
  return {ok:!(failPreview&&url.endsWith('.webp')),status:failPreview?503:200};
}}}});
for(const k of Object.keys(process.env))if(k.startsWith('R2_'))delete process.env[k];
globalThis.fetch=async()=>{throw Error('External network disabled in image tests');};
const {storeImage}=await import('../server/lib/images.js');
const input=await imageFixture(), asData=(b=input,type='image/jpeg')=>`data:${type};base64,${b.toString('base64')}`;
beforeEach(()=>{
  writes=[];failPreview=false;
  Object.assign(process.env,{R2_ACCOUNT_ID:'fake',R2_BUCKET:'fake',R2_ACCESS_KEY_ID:'fake',R2_SECRET_ACCESS_KEY:'fake',R2_PUBLIC_BASE:'https://images.invalid'});
});
test('원본 바이트를 유지하면서 작은 사본만 만들고 크기·메타데이터를 제한한다',async()=>{
  const before=Buffer.from(input),result=await prepareImage(input,'image/jpeg');
  assert.ok(input.equals(before));assert.deepEqual(result.variants.map(v=>v.side),[320,960]);
  for(const v of result.variants){const m=await sharp(v.bytes).metadata();assert.equal(m.format,'webp');assert.ok(Math.max(m.width,m.height)<=v.side);assert.ok(v.bytes.length<input.length*0.9);assert.equal(m.exif,undefined);}
});
test('EXIF 방향은 표시 사본에 반영하고 투명도는 보존한다',async()=>{
  const oriented=await sharp(input).withMetadata({orientation:6}).jpeg({quality:94}).toBuffer();
  const r=await prepareImage(oriented,'image/jpeg');const m=await sharp(r.variants[0].bytes).metadata();assert.ok(m.height>m.width);assert.equal(m.orientation,undefined);
  const rgba=Buffer.alloc(400*400*4);for(let i=0;i<rgba.length;i++)rgba[i]=(i*31+Math.floor(i/123))%256;
  const transparent=await sharp(rgba,{raw:{width:400,height:400,channels:4}}).png({compressionLevel:0}).toBuffer();
  const alpha=await prepareImage(transparent,'image/png');assert.ok(alpha.variants.length);assert.equal((await sharp(alpha.variants[0].bytes).metadata()).hasAlpha,true);
});
test('작은 사진과 움직이는 GIF에는 불필요한 정지 사본을 만들지 않는다',async()=>{
  const small=await sharp(input).resize(100).webp().toBuffer();assert.deepEqual((await prepareImage(small,'image/webp')).variants,[]);
  const gif=await sharp(Buffer.from([255,0,0,255,0,255,0,255]),{raw:{width:1,height:2,channels:4,pageHeight:1}}).gif({delay:[100,100],loop:0}).toBuffer();
  assert.equal((await sharp(gif,{animated:true}).metadata()).pages,2);
  const url=await storeImage(asData(gif,'image/gif'),'report');assert.ok(url.endsWith('.gif'));assert.equal(writes.length,1);assert.ok(Buffer.from(writes[0].body).equals(gif));
});
test('위장 형식·잘린 파일·과도한 바이트/픽셀·SVG를 저장 전에 거절한다',async()=>{
  for(const [bytes,type] of [[input,'image/png'],[input.subarray(0,100),'image/jpeg'],[Buffer.alloc(IMAGE_MAX_BYTES+1),'image/jpeg']])await assert.rejects(prepareImage(bytes,type),e=>e.status===400);
  const large=await sharp({create:{width:5000,height:4001,channels:3,background:'#eee'}}).png().toBuffer();
  await assert.rejects(prepareImage(large,'image/png'),e=>e.status===400);
  for(const value of ['data:image/svg+xml;base64,PHN2Zy8+','data:image/jpeg;base64,!!!!'])await assert.rejects(storeImage(value,'report'),e=>e.status===400);
  assert.equal(writes.length,0);
});
test('사본이 준비된 새 주소만 반환하며 원본을 재인코딩하거나 덮어쓰지 않는다',async()=>{
  const url=await storeImage(asData(),'report');assert.match(url,/\.iv1-320-960\.jpg$/);
  assert.equal(writes.length,3);assert.ok(Buffer.from(writes.at(-1).body).equals(input));
  for(const size of [320,960])assert.ok(writes.some(w=>w.url.endsWith(`.w${size}.webp`)));
  assert.equal(new Set(writes.map(w=>w.url)).size,3);
});
test('사본 업로드가 실패하면 원본 주소로 저장하고 깨진 사본 주소는 반환하지 않는다',async()=>{
  failPreview=true;const url=await storeImage(asData(),'report');assert.ok(!url.includes('.iv1-'));
  assert.equal(writes.length,2);assert.ok(Buffer.from(writes.at(-1).body).equals(input));
});
test('기존 저장 주소와 R2 미설정의 기존 형식은 변경하지 않고 외부 URL을 가져오지 않는다',async()=>{
  const old='https://images.invalid/report/old.jpg';assert.equal(await storeImage(old,'report'),old);assert.equal(writes.length,0);
  assert.equal(await storeImage('https://outside.invalid/photo.jpg','report'),'');
  delete process.env.R2_BUCKET;assert.equal(await storeImage(asData(),'report'),asData());assert.equal(writes.length,0);
});
function imageUI(){
  const html=fs.readFileSync(new URL('../app.html',import.meta.url),'utf8');
  const start=html.indexOf('    function imageSource('),end=html.indexOf('    // 2026-11-06(사용자): 입장 표',start);
  const listeners={};const c={URL,esc:s=>String(s).replaceAll('"','&quot;'),document:{addEventListener:(k,v)=>listeners[k]=v}};
  vm.createContext(c);vm.runInContext(html.slice(start,end),c);return {c,listeners};
}
const original='https://images.invalid/report/2026-11/12345678-1234-1234-1234-123456789012.iv1-320-960.jpg';
test('목록·본문은 사본, 기존/서명 주소는 그대로, 작은 사본만 있으면 상세는 원본이다',()=>{
  const {c}=imageUI();assert.equal(c.imageSource(original),original.replace('.jpg','.w320.webp'));assert.equal(c.imageSource(original,960),original.replace('.jpg','.w960.webp'));
  for(const value of [original+'?signature=local','data:image/jpeg;base64,AAAA','https://images.invalid/old.jpg'])assert.equal(c.imageSource(value),value);
  const onlySmall=original.replace('320-960','320');assert.equal(c.imageSource(onlySmall,960),onlySmall);
  assert.match(c.imageAttrs(original),/loading="lazy" decoding="async"/);assert.match(c.imageAttrs(original,960,true),/loading="eager"/);
});
test('사본 표시 실패는 원본으로 한 번만 대체하고 확대용 원본 정보를 유지한다',()=>{
  const {c,listeners}=imageUI();assert.match(c.imageAttrs(original),/data-original=/);
  let calls=0;const img={tagName:'IMG',dataset:{original},set src(v){assert.equal(v,original);calls++;}};
  listeners.error({target:img});listeners.error({target:img});assert.equal(calls,1);
});
test('PNG 아이콘 원본의 픽셀과 크기는 동일하고 표시 사본은 더 작다',async()=>{
  for(const name of ['icon-192.png','icon-512.png','apple-touch-icon.png']){
    const source=fs.readFileSync(new URL('../'+name,import.meta.url)),out=fs.readFileSync(new URL('../assets/optimized/'+name,import.meta.url));
    assert.ok(out.length<source.length);assert.ok((await sharp(source).ensureAlpha().raw().toBuffer()).equals(await sharp(out).ensureAlpha().raw().toBuffer()));
  }
});
