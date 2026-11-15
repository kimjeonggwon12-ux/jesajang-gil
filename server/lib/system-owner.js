import {normId} from './util.js';

// 책임자 식별값은 서버 환경에서만 받는다. 공개 소스에 실제 고유번호를 넣지 않는다.
// 미설정이면 책임자 권한을 부여하지 않는다. 유효한 PIN 세션과 현재 명단 확인도 유지한다.
export function systemOwnerNid(){
 const raw=String(process.env.TEACHERSQUARE_SYSTEM_OWNER_ID??'').trim().replaceAll('-','');
 return /^\d{8,40}$/.test(raw)?normId(raw):'';
}
export const isSystemOwner=id=>!!systemOwnerNid()&&normId(id)===systemOwnerNid();
