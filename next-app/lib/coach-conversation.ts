import {maskName} from './status-extra.ts';
export type CoachChoice={coachId:string;name:string;dept:string;region:string};
export type CoachJournal={stage:string;todayWork:string;nextWork:string};

// 원본 requestCoachForJournal/glToCoach의 문구. 전송은 개인 대화에서 사용자가 확인한다.
export function journalCoachDraft(targetName:string,journal:CoachJournal){
 const parts=[`대상자: ${maskName(targetName)}`];
 if(journal.stage)parts.push(`단계: ${journal.stage}`);
 if(journal.todayWork)parts.push(`오늘 한 일: ${journal.todayWork}`);
 if(journal.nextWork)parts.push(`다음 할 일: ${journal.nextWork}`);
 return parts.join(' / ');
}
export function planCoachDraft(target:{targetName:string;stage:string;goalCohort:string}){
 const goal=target.goalCohort?`${Number(target.goalCohort.slice(5))}월 개강`:'';
 return `[센터 인도 계획 상의] 대상자: ${maskName(target.targetName)} / 지금 단계: ${target.stage||'섭외'} / 목표: ${goal} 센터 인도`;
}
