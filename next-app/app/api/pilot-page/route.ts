import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {cookieToken,routeForToken} from '../../../../server/lib/pilot-routing.js';
import {isPilotPage,legacyHash,PILOT_LEGACY} from '../../../../shared/pilot-paths.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const headers={'Cache-Control':'private, no-store','Vary':'Cookie','Content-Type':'text/html; charset=utf-8'};
 try{
  const pathname=new URL(request.url).searchParams.get('path')||'/';
  if(!isPilotPage(pathname)||(await routeForToken(cookieToken(request.headers),request.headers)).site!=='A')return new Response('찾을 수 없습니다.',{status:404,headers});
  const filename=PILOT_LEGACY.includes(pathname.slice(1))?pathname.slice(1):'app.html';
  const html=await readFile(path.resolve(process.cwd(),'../',filename),'utf8');
  const hash=legacyHash(pathname);
  const bridge=`<base href="/"><script>if(!location.hash&&${JSON.stringify(hash)})history.replaceState(null,'',location.pathname+location.search+'#'+${JSON.stringify(hash)});</script><script src="/pilot-bridge.js" data-site="A"></script>`;
  return new Response(html.replace(/<head[^>]*>/i,m=>m+bridge),{headers});
 }catch{return new Response('화면을 불러오지 못했어요. 다시 시도해 주세요.',{status:503,headers});}
}
