// 서버·비밀값·문서 폴더를 공개하지 않는다. 확인한 정적 파일만 기존 URL 그대로 복사한다.
import {copyFile,mkdir,readFile,writeFile,readdir,lstat,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import operatingAssets from './operating-static-assets.json' with {type:'json'};
export const repoRoot=fileURLToPath(new URL('../',import.meta.url));
export const legacyFiles=[
  'display.html','podo-admin.html','podo-connect.html','podo-home.html','podo-splash.html',
  'coach-slides.js','podo-ui.js','roster-excel.js','podo-ui.css','tw.css',
  'icon-192.png','icon-512.png','apple-touch-icon.png','vendor/pptxgen.bundle.js','vendor/xlsx.full.min.js','vendor/xlsx-LICENSE.txt','vendor/qrcode-1.0.0.min.js','vendor/qrcode-LICENSE.txt',
  'assets/optimized/icon-192.png','assets/optimized/icon-512.png','assets/optimized/apple-touch-icon.png',
];
export const preservedAssetFiles=operatingAssets.files.map(file=>file.path);
export function nextManifest(original){return {...original,id:'/app.html',start_url:'/',scope:'/',icons:original.icons.map(icon=>({...icon,src:'/'+icon.src.replace(/^\//,'')}))};}
export async function prepareLegacy() {
  const destination=path.join(repoRoot,'next-app/public');
  // Git 밖 운영 홍보 자료도 같은 주소와 바이트로 보존한다. 누락/변조를 빌드 전에 거절한다.
  // 폴더 전체를 공개하지 않고, 검토한 명시 목록만 복사한다.
  if(operatingAssets.version!==1||new Set(preservedAssetFiles).size!==preservedAssetFiles.length)throw Error('운영 정적 자료 목록을 확인하세요.');
  for(const asset of operatingAssets.files){
    if(typeof asset.path!=='string'||!asset.path.startsWith('교사광장 광고/')||asset.path.split('/').some(part=>!part||part==='.'||part==='..')||asset.path.includes('\\')||!['.png','.jpg','.txt','.mp4','.pptx'].includes(path.extname(asset.path))||!/^[a-f0-9]{64}$/.test(asset.sha256))throw Error('허용되지 않은 운영 정적 자료 경로입니다.');
    const original=path.join(repoRoot,asset.path),stat=await lstat(original);
    if(!stat.isFile()||stat.size!==asset.bytes||createHash('sha256').update(await readFile(original)).digest('hex')!==asset.sha256)throw Error('운영 정적 자료가 검증 원본과 다릅니다: '+asset.path);
  }
  // 이 폴더는 생성물 전용이다. 사람이 만든 파일이 있으면 덮어 지우지 않는다.
  try {await lstat(destination);await readFile(path.join(destination,'.generated-legacy'));}
  catch(error){if(error.code!=='ENOENT')throw error;const entries=await readdir(destination).catch(()=>[]);if(entries.length)throw Error('public 폴더에 직접 만든 파일이 있습니다. 자동 생성 범위를 확인하세요.');}
  await rm(destination,{recursive:true,force:true});await mkdir(destination,{recursive:true});
  const publicFiles=[...legacyFiles,...preservedAssetFiles];
  for(const name of publicFiles){await mkdir(path.dirname(path.join(destination,name)),{recursive:true});await copyFile(path.join(repoRoot,name),path.join(destination,name));}
  await copyFile(path.join(repoRoot,'next-app/worker/service-worker.js'),path.join(destination,'service-worker.js'));
  await copyFile(path.join(repoRoot,'next-app/worker/pilot-bridge.js'),path.join(destination,'pilot-bridge.js'));
  await copyFile(path.join(repoRoot,'next-app/worker/offline.html'),path.join(destination,'offline.html'));
  await writeFile(path.join(destination,'manifest.json'),JSON.stringify(nextManifest(JSON.parse(await readFile(path.join(repoRoot,'manifest.json'),'utf8'))),null,2));
  await writeFile(path.join(destination,'.generated-legacy'),'Generated only by tools/prepare-next-legacy.mjs\n');
  return publicFiles.length+3;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log('기존 URL용 정적 파일 준비:',await prepareLegacy());
