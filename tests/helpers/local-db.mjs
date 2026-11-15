import {execFileSync} from 'node:child_process';
import {scryptSync,createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
export const ids={member:'9900000000001',admin:'9900000000002',evangel:'9900000000003',coach:'9900000000004',other:'9900000000005',fresh:'9900000000006',missing:'9900000000007'};
export const PIN='582946';
export function sql(text) {
  // 대상 변경 옵션을 받지 않는다. 별도 클러스터의 지정 DB만 허용한다.
  try {return execFileSync('/opt/homebrew/bin/psql',['-h','/tmp/jesajang-auth-pg-socket','-p','58431','-U','postgres','-d','jesajang_auth_local','-v','ON_ERROR_STOP=1','-At'],{input:text,encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:32*1024*1024}).trim();}
  catch(error) {throw new Error('격리 검증 SQL 실패 ('+(error.code||'SQL')+') — 입력과 응답 원문은 출력하지 않습니다.');}
}
export const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
export function seed() {
  const salt='ab'.repeat(16), hash=scryptSync(PIN,salt,32).toString('hex');
  sql(`begin; truncate public.room_attachments,public.center_policy_changes,public.member_registration_contacts,public.pin_recovery_challenges,public.pin_enrollment_attempts,public.member_pins,public.teachers,public.admins,public.teacher_profiles,public.roster_changes restart identity; update public.center_approval_policy set mode='legacy_global',version=1,updated_at=now() where id=1;\n`+
    Object.entries(ids).map(([key,id],i)=>`insert into public.teachers(member_id,name,dept,region,sort_order) values('${id}','${{member:'테스트교사',admin:'테스트교육',evangel:'테스트전도',coach:'테스트교관',other:'테스트대상',fresh:'테스트등록',missing:'테스트미등록'}[key]}','${key==='evangel'?'전도부':'청년회'}','1지역',${i});`).join('\n')+
    `insert into public.admins(member_id,name,dept,position,phone) values('${ids.admin}','테스트교육','교육부','교육부장','010-0000-0002'),('${ids.evangel}','테스트전도','전도부','전도부장','010-0000-0003');`+
    Object.values(ids).slice(0,5).map(id=>`insert into public.member_pins(nid,pin_hash,salt,ver) values('${id}','${hash}','${salt}','seed-${id}');`).join('\n')+
    `insert into public.teacher_profiles(member_id,phone) values('${ids.member}','010-0000-0001'),('${ids.fresh}','010-0000-0006'); commit;`);
}
// 두 고정 로컬 주소만 선택할 수 있다. DB 연결 대상과 실자료 환경은 바꿀 수 없다.
export const apiBase=process.env.LOCAL_API_TARGET==='next'?'http://127.0.0.1:58434':'http://127.0.0.1:58433';
export async function api(action,data={},token) {
  const r=await fetch(apiBase+'/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...data,...(token?{_tk:token}:{})})});
  return {status:r.status,body:await r.json()};
}
export const login=(id=ids.member,name='테스트교사',pin=PIN,dept='청년회')=>api('verifyLogin',{memberId:id,name,pin,dept});
export const register=(extra={})=>api('registerPin',{memberId:ids.fresh,name:'테스트등록',dept:'청년회',phone:'01000000006',pin:PIN,...extra});
export async function issue(targetId=ids.member,extra={}) {
  const a=await login(ids.admin,'테스트교육');
  return api('resetPin',{targetId,adminPin:PIN,identityConfirmed:true,reason:'PIN 분실',...extra},a.body.token);
}
export const recover=(code,extra={})=>api('recoverPin',{memberId:ids.member,name:'테스트교사',dept:'청년회',pin:'693857',code,...extra});
export function jwt(role) {
  const r=JSON.parse(readFileSync(new URL('../../../.local-auth-20261111/runtime.json',import.meta.url),'utf8'));
  const b=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({role,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
  return b+'.'+createHmac('sha256',r.jwtSecret).update(b).digest('base64url');
}
