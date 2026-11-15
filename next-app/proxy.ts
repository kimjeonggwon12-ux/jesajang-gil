import {NextResponse,type NextRequest} from 'next/server';
import {cookieToken,routeForToken} from '../server/lib/pilot-routing.js';
import {isPilotPage} from '../shared/pilot-paths.mjs';
import operatingAssets from '../tools/operating-static-assets.json';
// 기존 공유 주소에서 괄호까지 인코딩한 경우도 같은 정적 원본으로 연결한다.
// 확인한 공개 자료만 허용하며 로그인/업무 경로에는 적용하지 않는다.
const preservedAssetPaths = new Map(operatingAssets.files.map(({path}) => {
 const canonical = '/' + path.split('/').map(encodeURIComponent).join('/');
 const encoded = canonical.replace(/[!'()*]/g, character => '%' + character.charCodeAt(0).toString(16).toUpperCase());
 return [encoded, canonical];
}));
export async function proxy(request:NextRequest){
 const canonicalAsset = preservedAssetPaths.get(request.nextUrl.pathname);
 if(canonicalAsset && canonicalAsset !== request.nextUrl.pathname)return NextResponse.rewrite(new URL(canonicalAsset,request.url));
 if(!isPilotPage(request.nextUrl.pathname)||process.env.PILOT_ROUTING_ENABLED!=='1')return NextResponse.next();
 try{
  const state=await routeForToken(cookieToken(request.headers),request.headers);
  const response=state.site==='A'?NextResponse.rewrite(new URL('/api/pilot-page?path='+encodeURIComponent(request.nextUrl.pathname),request.url)):NextResponse.next();
  response.headers.set('Cache-Control','private, no-store');response.headers.set('Vary','Cookie');
  return response;
 }catch(e){
  if((e as {status?:number}).status===401){const r=NextResponse.next();r.cookies.delete('ts_route_session');r.headers.set('Cache-Control','private, no-store');return r;}
  return new NextResponse('접속 정보를 확인하지 못했어요. 잠시 후 새로고침해 주세요.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'private, no-store'}});
 }
}
export const config={matcher:['/((?!api|_next|assets|vendor|.*\\.(?:js|css|png|webp|ico|svg|woff2|json)$).*)','/%EA%B5%90%EC%82%AC%EA%B4%91%EC%9E%A5%20%EA%B4%91%EA%B3%A0/:path*']};
