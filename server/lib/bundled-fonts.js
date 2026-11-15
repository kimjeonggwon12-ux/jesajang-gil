import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// 원본 Node 서버와 Next 배포물 모두에서 저장소의 동일한 폰트를 찾는다.
// 폰트 누락을 빈 한글 이미지로 숨기지 않는다. 환경값/요청 경로는 받지 않는다.
export function bundledFontFiles(){
 const roots=[path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../assets/fonts'),
  path.resolve(process.cwd(),'server/assets/fonts'),path.resolve(process.cwd(),'../server/assets/fonts')];
 for(const root of roots){
  const files=['NanumGothic-Regular.ttf','NanumGothic-Bold.ttf'].map(name=>path.join(root,name));
  if(files.every(file=>existsSync(file)))return files;
 }
 throw Error('보고 이미지 폰트가 배포물에 없습니다.');
}
