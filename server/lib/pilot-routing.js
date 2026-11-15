import {authenticateRequest} from './request-auth.js';
import {pilotEnabled,pilotSite,canManagePilot} from './pilot.js';
import {tokenInfo} from './auth.js';
import {AccessError} from './request-context.js';
export const PILOT_COOKIE='ts_route_session';
export const OWNER_VIEW_COOKIE='ts_pilot_owner_view';
export const commonPath=path=>['/admin/pilot','/admin/reports','/account','/device','/attend'].includes(path);
export function cookieToken(headers){const raw=headers.get('cookie')||'';const values=raw.split(';').map(s=>s.trim()).filter(s=>s.startsWith(PILOT_COOKIE+'='));return values.length===1?values[0].slice(PILOT_COOKIE.length+1):'';}
const cookieValue=(headers,key)=>{const values=(headers?.get('cookie')||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(key+'='));return values.length===1?values[0].slice(key.length+1):'';};
export async function routeForToken(token,headers,requestedView){
 if(requestedView!==undefined&&!['A','B'].includes(requestedView))throw new AccessError('화면을 확인해 주세요.',400);
 if(!pilotEnabled())return {site:'B',enabled:false,canManage:false};
 if(!token){if(requestedView!==undefined)throw new AccessError('로그인이 필요해요.',401);return {site:'common',enabled:true,canManage:false};}
 const {actor}=await authenticateRequest(tokenInfo(token)?.guest?'listMyRooms':'checkAdmin',{_tk:token});
 const canManage=!!actor&&!actor.guest&&canManagePilot(actor.nid);
 if(requestedView!==undefined&&!canManage)throw new AccessError('최종 책임자만 본인 화면을 선택할 수 있어요.');
 const saved=cookieValue(headers,OWNER_VIEW_COOKIE),ownerView=requestedView??(saved===actor.nid+':A'?'A':'B');
 return {...await pilotSite(actor,ownerView),canManage};
}
function cookie(token,url){const expires=token?tokenInfo(token)?.expiresAt:0;return `${PILOT_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0,(expires||0)-Math.floor(Date.now()/1000))}${new URL(url).protocol==='https:'?'; Secure':''}`;}
export async function pilotSession(request){
 const headers={'Cache-Control':'private, no-store','Content-Type':'application/json'};
 if(request.method!=='POST')return Response.json({error:'지원하지 않는 요청이에요.'},{status:405,headers});
 const origin=request.headers.get('origin'),fetchSite=request.headers.get('sec-fetch-site');
 const publicUrl=new URL(request.url);publicUrl.host=request.headers.get('host')||publicUrl.host;
 if((origin&&origin!==publicUrl.origin)||fetchSite==='cross-site')return Response.json({error:'같은 사이트에서 요청해 주세요.'},{status:403,headers});
 try{
  const text=await request.text();if(text.length>4096)return Response.json({error:'요청이 너무 큽니다.'},{status:413,headers});
  const body=JSON.parse(text),token=typeof body.token==='string'?body.token:'';
  const requestedView=Object.hasOwn(body,'ownerView')?body.ownerView:undefined;
  const state=await routeForToken(token,request.headers,requestedView);
  const responseHeaders=new Headers(headers);responseHeaders.append('Set-Cookie',cookie(state.enabled?token:'',request.url));
  if(requestedView!==undefined&&state.canManage){
   const nid=tokenInfo(token).nid;
   responseHeaders.append('Set-Cookie',`${OWNER_VIEW_COOKIE}=${nid}:${requestedView}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${new URL(request.url).protocol==='https:'?'; Secure':''}`);
  }
  return Response.json(state,{headers:responseHeaders});
 }catch(e){return Response.json({error:e.status===401?'로그인이 만료됐어요. 다시 들어와 주세요.':'접속 정보를 확인하지 못했어요.',auth:e.status===401?false:undefined},{status:e.status||503,headers:{...headers,...(e.status===401?{'Set-Cookie':cookie('',request.url)}:{})}});}
}
