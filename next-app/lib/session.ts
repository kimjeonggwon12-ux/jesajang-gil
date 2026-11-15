import {clearEntry} from './entry-handoff.ts';
export const TOKEN_KEY='pd_tk_v1', MEMBER_KEY='podo_member';
export type Account = {memberId:string; name:string; dept:string; guest?:boolean};
export type Session = {account:Account; token:string};

export function loadSession():Session|null {
  try {
    const token=localStorage.getItem(TOKEN_KEY), account=JSON.parse(localStorage.getItem(MEMBER_KEY)||'null');
    if(!token || !account || typeof account.memberId!=='string' || typeof account.name!=='string')return null;
    return {token,account:{memberId:account.memberId,name:account.name,dept:typeof account.dept==='string'?account.dept:'',guest:account.guest===true}};
  }catch{return null;}
}
export function saveSession(token:string, account:Account, pinVer?:string):Session {
  // 번호는 기존 화면의 입력 보조용이다. 본인·권한 판정은 매번 서버가 수행한다.
  const memberId=token.match(/^m([1-9]\d{0,39})\./)?.[1];
  if(!memberId)throw new Error('로그인 정보를 확인하지 못했어요.');
  const saved={...account,memberId,guest:false};
  try {
    localStorage.setItem(MEMBER_KEY,JSON.stringify(saved));
    localStorage.setItem(TOKEN_KEY,token);
    if(pinVer)localStorage.setItem('podo_pin',JSON.stringify({id:memberId,ver:pinVer}));
    sessionStorage.setItem('pd_in','1');sessionStorage.removeItem('pd_gate_once');
  }catch{clearSession();throw new Error('브라우저 저장 공간을 사용할 수 없어요. 사이트 저장을 허용한 뒤 다시 시도해 주세요.');}
  if(typeof window!=='undefined')window.dispatchEvent(new Event('ts-session-change'));
  return {account:saved,token};
}
// 손님의 입력 번호를 계정 ID로 사용하지 않는다. 서버가 초대 방에 묶어 발급한 표의 ID만 저장한다.
export function saveGuestSession(token:string,account:Account):Session {
  const memberId=token.match(/^g([1-9]\d{0,39})\./)?.[1];
  if(!memberId)throw Error('손님 입장 정보를 확인하지 못했어요.');
  const saved={...account,memberId,guest:true};
  try{localStorage.setItem(MEMBER_KEY,JSON.stringify(saved));localStorage.setItem(TOKEN_KEY,token);localStorage.removeItem('podo_pin');sessionStorage.setItem('pd_in','1');}
  catch{clearSession();throw Error('브라우저 저장 공간을 사용할 수 없어요.');}
  if(typeof window!=='undefined')window.dispatchEvent(new Event('ts-session-change'));
  return {account:saved,token};
}
export function clearSession() {
  clearEntry();
  try {for(const key of [TOKEN_KEY,MEMBER_KEY,'podo_pin'])localStorage.removeItem(key);sessionStorage.removeItem('pd_in');}catch{}
  if(typeof window!=='undefined')window.dispatchEvent(new Event('ts-session-change'));
}
