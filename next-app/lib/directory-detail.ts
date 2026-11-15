import type {Teacher} from './directory';

export const DETAIL_GROUPS=[['피드백','사랑이 피드백'],['섭외','섭외·찾기 활동(전단지·좌판 등)'],['만남·교육','친분·만남·상담·복음방'],['동행 복음방','동행 복음방(동행교사)'],['식구 복음방','내부(식구) 복음방'],['동호회','동호회(외부·내부) = 동아리'],['협력','잎사귀·만남 동행·밭보기·육상담·부스담당·은사·멘토교사'],['센터 관리','센터 관리 활동(센터소개·센터수강)'],['전도 행사 지원','전도 행사 지원']];
export const DEFAULT_EDUCATION=['복음방교사양성교육','섭외전도교육','상담교육','복음방교재교육','교사소양교육'];
export type RequiredEducation={categories?:string[]}&Record<string,unknown>;

// 원본 teacherSheetHtml의 빈 값/구형 기록 분기. 연간 인도와 명단 센터 등록은 다른 수치다.
export function teacherExtraFields(t:Teacher):Record<string,string>{
 const fields:Record<string,string>={};
 const ms=t.monthStats;
 if(ms){
  fields[`${ms.month||''} 부서 기록`]=`교육 ${ms.edu||0} · 상담 ${ms.counsel||0} · 복음방 ${ms.gospel||0} · 식구복방 ${ms.family||0} · 동행 ${ms.companion||0} · 과제 ${ms.task||0}`;
  fields[`${ms.month||''} 전도부 기록`]=`인도 ${ms.lead||0} · 교사 ${ms.teach||0} · 섬김 ${ms.serve||0}`;
  fields['엑셀 구분']=ms.tierRaw||'-';
 }else if(t.counsel||t.gospelRoom||t.companion){fields['부서 기록란']=`상담 ${t.counsel||0} · 복음방 ${t.gospelRoom||0} · 동행교사 ${t.companion||0}`;}
 fields['앱 접속']=t.visits?`${t.visits}번${t.lastVisit?' · 마지막 '+t.lastVisit.slice(0,10):''}`:'0번';
 if(t.apply)fields['신청 소속·성별']=[t.affilSel,t.genderSel].filter(Boolean).join(' · ')||'-';
 return fields;
}
export function educationSummary(edu:RequiredEducation){
 const categories=edu.categories?.length?edu.categories:DEFAULT_EDUCATION;
 return {categories,completed:categories.filter(category=>edu[category]).length,total:categories.length};
}
