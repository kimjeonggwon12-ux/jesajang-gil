import type {ActivityForm} from './activities';
// 같은 탭의 React 이동 동안만 유지하는 일회 입력 보조. 저장소/URL/서버에는 복사하지 않는다.
export type EntryHints={memberId:string;name:string;dept:string};
export type ChatDraft={id:string;name:string;text:string};
export type CoachingDraft={stage:string;targetGroup:string;situationText:string};
type Handoff={hints:EntryHints;chat:ChatDraft|null;coaching:CoachingDraft|null;activity?:ActivityForm};
let pending:{token:string;at:number;value:Partial<Handoff>}|null=null;
export function rememberEntry(value:Handoff,token:string){pending={token,at:Date.now(),value:{...value,...(token?{hints:undefined}:{})}};}
export function takeEntry<K extends keyof Handoff>(kind:K,token=''):Handoff[K]|null{
 if(!pending)return null;
 if(Date.now()-pending.at>5*60e3||pending.token&&pending.token!==token){pending=null;return null;}
 const value=pending.value[kind]||null;delete pending.value[kind];return value as Handoff[K]|null;
}
export function clearEntry(){pending=null;}
