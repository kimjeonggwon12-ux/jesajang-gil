import type {Activity,Target} from './activities';

export type SavedFeedback={text:string;at:string;basis:string};
export type TargetInfoItem={id:number;cat:string;cats:string[];text:string;at:string};
export type TargetInfo={cats:string[];items:TargetInfoItem[];feedback:SavedFeedback|null;master:SavedFeedback|null};
export type TargetFile={plans:{at:string;input:string;text:string}[];hearts:{at:string;source:string;situation:string;ai:string;handler:string;answer:string;status:string}[]};
export const TARGET_FLOW=['섭외','친분','만남1','만남2','상담1','상담2','복음방','개강 준비','개강','초등','중등','고등','수료'];
export const TARGET_FLOW_SHORT=['섭외','친분','만1','만2','상1','상2','복음','준비','개강','초등','중등','고등','수료'];
export function targetFlowIndex(stage:string,course=''){
  if(stage==='센터수강')return 8+Math.max(0,TARGET_FLOW.slice(8).indexOf(course||'개강'));
  return stage==='센터소개'?7:TARGET_FLOW.indexOf(stage);
}
// 기존 다중 분류와 과거 단일 분류 기록을 함께 읽는다.
export const infoCategories=(item:Pick<TargetInfoItem,'cat'|'cats'>)=>item.cats?.length?item.cats:[item.cat||'기타'];
export function toggleInfoCategory(selected:string[],category:string){
  const next=selected.includes(category)?selected.filter(c=>c!==category):[...selected,category];
  return next.length?next:selected;
}
export function activityFeedbackPayload(row:Activity,targets:Target[],maskedName:string){
  const target=targets.find(t=>t.targetName.trim()===row.targetName.trim());
  return {activityId:row.id,targetId:target?.targetId||'',targetName:maskedName||'대상자',stage:row.targetStage||'',todayWork:row.todayWork||'',nextWork:row.nextWork||''};
}
export function checkedFeedbackText(text:unknown){
  if(typeof text!=='string'||!text.trim())throw Error('피드백 내용이 없어 저장 결과를 확인할 수 없어요.');
  if(text.startsWith('⚠️'))throw Error(text.replace(/^⚠️\s*/,''));
  return text;
}
