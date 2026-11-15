// 실제 사람/사진 없이 재현 가능한 색·무늬·한글 안내문 검증 자료.
import sharp from 'sharp';
import { Resvg } from '@resvg/resvg-js';
import { fileURLToPath } from 'node:url';
export async function imageFixture() {
  const width=1600,height=1100,raw=Buffer.alloc(width*height*3);
  let seed=17;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;const noise=(seed>>>24)%40;
    const i=(y*width+x)*3;raw[i]=70+Math.floor(x/20)+noise;raw[i+1]=100+Math.floor(y/20)+noise;raw[i+2]=130+noise;
  }
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1100"><rect x="110" y="160" width="1380" height="780" rx="30" fill="white"/><g font-family="NanumGothic" fill="#173c32"><text x="180" y="300" font-size="64">로컬 이미지 검증</text><text x="180" y="410" font-size="42">가짜 교육 안내 · 실제 개인정보 없음</text><text x="180" y="560" font-size="38">준비물: 필기구와 노트</text><text x="180" y="640" font-size="38">작은 화면에서는 미리보기를 확인하세요.</text><text x="180" y="720" font-size="38">사진을 누르면 보존된 원본이 열립니다.</text><text x="180" y="830" font-size="28">원본 파일의 해시와 글자 가독성을 비교합니다.</text></g></svg>`;
  const overlay=new Resvg(svg,{font:{fontFiles:[fileURLToPath(new URL('../../server/assets/fonts/NanumGothic-Regular.ttf',import.meta.url))],loadSystemFonts:false}}).render().asPng();
  return sharp(raw,{raw:{width,height,channels:3}}).composite([{input:overlay}]).jpeg({quality:94}).toBuffer();
}
