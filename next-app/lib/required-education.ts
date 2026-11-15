export {educationCandidates} from '../../shared/education-search.js';
export type EducationPerson={memberId:string;name:string;dept:string;region:string};
export type EducationLog={at:string;memberId:string;name:string;category:string;date:string;registrar:string;kind:string};
// 기존 입력의 UTC 날짜 기본값을 유지한다. 서버는 날짜가 비어 있으면 한국 날짜를 사용한다.
export const educationToday=()=>new Date().toISOString().slice(0,10);
