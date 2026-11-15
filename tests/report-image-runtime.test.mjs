import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {pathToFileURL,fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {tablePng} from '../server/lib/table-image.js';
import {progressPng} from '../server/lib/progress-image.js';
import {eduCardPng} from '../server/lib/edu-card.js';
import {newsCardPng,totalCardPng} from '../server/lib/news-card.js';
const repo=fileURLToPath(new URL('../',import.meta.url));
test('표·참여·교육·뉴스·전체 이미지가 폰트 경로 수정 전과 바이트 단위로 동일',()=>{
 const f=JSON.parse(readFileSync(new URL('./fixtures/report-image-runtime.json',import.meta.url),'utf8'));
 for(const [key,fn]of Object.entries({table:tablePng,progress:progressPng,education:eduCardPng,news:newsCardPng,total:totalCardPng})){
  const png=fn(f.inputs[key]);assert.equal(png.length,f.expected[key].bytes,key);assert.equal(createHash('sha256').update(png).digest('hex'),f.expected[key].sha256,key);
 }
});
test('서버 기준·Next 하위 폴더 기준의 배포 폰트 탐색과 누락 거절',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'teacher-fonts-')),cwd=process.cwd();
 try{
  copyFileSync(path.join(repo,'server/lib/bundled-fonts.js'),path.join(dir,'fonts.mjs'));
  const {bundledFontFiles}=await import(pathToFileURL(path.join(dir,'fonts.mjs')));
  process.chdir(dir);assert.throws(bundledFontFiles,/폰트가 배포물에 없습니다/);
  mkdirSync(path.join(dir,'server/assets/fonts'),{recursive:true});mkdirSync(path.join(dir,'next-app'));
  for(const name of ['NanumGothic-Regular.ttf','NanumGothic-Bold.ttf'])copyFileSync(path.join(repo,'server/assets/fonts',name),path.join(dir,'server/assets/fonts',name));
  assert.equal(bundledFontFiles().length,2);process.chdir(path.join(dir,'next-app'));assert.equal(bundledFontFiles().length,2);
 }finally{process.chdir(cwd);rmSync(dir,{recursive:true});}
});
