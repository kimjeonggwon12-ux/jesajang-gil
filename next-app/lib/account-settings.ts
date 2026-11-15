import {loadSession,saveSession,type Session} from './session.ts';

// PIN 변경 응답이 늦게 와도 로그아웃하거나 바꾼 계정을 되살리지 않는다.
export function acceptPinSession(expected:Session,result:{ok?:boolean;token?:string;pinVer?:string;ver?:string}) {
 if(loadSession()?.token!==expected.token)return null;
 if(!result.ok||!result.token||result.token.split('.')[0]!==expected.token.split('.')[0])throw Error('변경된 로그인 정보를 확인하지 못했어요. 새 PIN으로 다시 로그인해 주세요.');
 return saveSession(result.token,expected.account,result.pinVer||result.ver);
}

// 원본 logVisitOnce: 탭 최초 입장 한 번만 기록한다. 새로고침/화면 이동/PIN 갱신은 중복 집계하지 않는다.
export function logVisitOnce(account:Session['account'],send:()=>Promise<unknown>,storage:Pick<Storage,'getItem'|'setItem'>=sessionStorage) {
 if(account.guest)return;
 try {if(storage.getItem('pd_visit')==='1')return;storage.setItem('pd_visit','1');}catch{}
 void send().catch(()=>{});
}
