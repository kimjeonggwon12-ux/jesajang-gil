import {authenticateRequest} from './request-auth.js';
import {withActor,AccessError} from './request-context.js';
import {readRoomAttachment} from '../actions/target-room.js';

// 세션은 POST 본문에만 넣는다. 브라우저 주소·리퍼러·공개 다운로드 URL에는 넣지 않는다.
export async function roomDownload(request){
 let response;
 try{
  if(request.method!=='POST')return Response.json({error:'로그인한 화면에서 첨부를 열어 주세요.'},{status:405,headers:{'Cache-Control':'no-store'}});
  const raw=await request.text();if(raw.length>4096)throw new AccessError('요청이 너무 커요.',400);
  const input=JSON.parse(raw);if(!input||typeof input!=='object'||Array.isArray(input))throw new AccessError('요청을 확인해 주세요.',400);
  // 기존 방 읽기와 같은 일반/손님 인증 경계를 사용한다.
  const {actor,body}=await authenticateRequest('getTargetRoom',input);
  response=await withActor(actor,()=>readRoomAttachment(body));
  await authenticateRequest('getTargetRoom',input); // 파일을 준비하는 동안 PIN이 변경된 경우 본문을 보내지 않는다.
  return response;
 }catch(error){
  void response?.body?.cancel().catch(()=>{});
  const status=error instanceof AccessError?error.status:error instanceof SyntaxError?400:503;
  return Response.json({error:error instanceof AccessError?error.message:'첨부를 열지 못했어요. 다시 시도해 주세요.',...(status===401?{auth:false}:{})},{status,headers:{'Cache-Control':'no-store'}});
 }
}
