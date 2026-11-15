import {tsTerms,tsMatch} from './learning-content.mjs';
export type Course={courseId:string;courseName:string;unitName:string;order:number;content:string;minutes:number;category:string};
export type Video={id:string;videoId:string;title:string;part:string;description:string;uploadDate:string;docs?:boolean;sum?:string};
export type Lesson=Video&{duration:number;pct:number;completed:boolean;lastPos:number};
export type Lecture={lectureId:string;title:string;part:string;instructor:string;description:string;featured:boolean;hidden:boolean;lessons:Lesson[];doneCount:number;completed:boolean;started:boolean};
export type Transcript={exists:boolean;status?:string;duration?:number;segs?:number;done?:number;summary?:string;transcript?:string;pkg?:Record<string,string>;updatedAt?:string;error?:string};
export type RequestRow={id:string;title:string;part:string;requestDate:string;createdBy:string;status:string;mine:boolean;phone:string;videoId?:string;description?:string;note?:string};
export type RequestComment={id:string;name:string;text:string;at:string;staff:boolean};
export type Requests={isApprover:boolean;canRequest:boolean;wishes:RequestRow[];requests:RequestRow[];comments:Record<string,RequestComment[]>};
export function groupCourses(rows:Course[]){const groups=new Map<string,{courseName:string;units:Course[]}>();for(const row of rows){if(!groups.has(row.courseName))groups.set(row.courseName,{courseName:row.courseName,units:[]});groups.get(row.courseName)!.units.push(row);}for(const group of groups.values())group.units.sort((a,b)=>a.order-b.order);return [...groups.values()];}
export function searchLearning(courses:Course[],videos:Video[],query:string){const terms=tsTerms(query),inTitle=(u:Course)=>tsMatch(u.unitName+' '+u.courseName,terms);return {terms,units:courses.filter(u=>tsMatch(u.unitName+' '+u.courseName+' '+u.category+' '+u.content,terms)).sort((a,b)=>Number(inTitle(b))-Number(inTitle(a))||a.courseName.localeCompare(b.courseName)||a.order-b.order),videos:videos.filter(v=>tsMatch(v.title+' '+(v.description||'')+' '+v.part+' '+(v.sum||''),terms))};}
export const lecturePct=(l:Lecture)=>l.lessons.length?Math.round(l.lessons.reduce((n,x)=>n+(x.completed?100:x.pct),0)/l.lessons.length):0;
export const resumeAt=(x:Lesson)=>!x.completed&&x.lastPos>5&&(!x.duration||x.lastPos<x.duration-15)?Math.floor(x.lastPos):0;
export type Playback={buckets:Set<number>;lastT:number|null;state:number;duration:number;pos:number};
// 10초 칸·0~3초 연속 재생 규칙은 구 화면과 동일하다. 메시지 발신 창/출처 확인은 플레이어에서 한다.
export function receivePlayback(p:Playback,info:{duration?:number;playerState?:number;currentTime?:number}){if(Number.isFinite(info.duration)&&(info.duration ?? 0)>0)p.duration=Math.round(info.duration!);if(typeof info.playerState==='number'){p.state=info.playerState;if(p.state!==1)p.lastT=null;}const t=info.currentTime;if(typeof t!=='number'||!Number.isFinite(t)||t<0)return;if(p.state===1&&p.lastT!==null&&t>p.lastT&&t-p.lastT<=3){for(let b=Math.floor(p.lastT/10);b<=Math.floor(t/10);b++)p.buckets.add(b);}p.lastT=p.state===1?t:null;p.pos=t;}
export function browserDownload(content:string,type:string,name:string){const url=URL.createObjectURL(new Blob(['\ufeff',content],{type})),a=document.createElement('a');a.href=url;a.download=name.replace(/[\\/:*?"<>|\r\n]+/g,'_').trim();document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}

export type ProgressBody={lectureId:string;videoKey:string;buckets:number[];duration:number;lastPos:number};
export type ProgressResult={pct:number;completed:boolean};
// 같은 플레이어의 저장은 직렬화한다. 실패한 쓰기는 사용자가 다시 시도할 때까지 멈춘다.
export function createProgressSaver(options:{body:()=>ProgressBody|undefined;active:()=>boolean;send:(body:ProgressBody)=>Promise<ProgressResult>;saved:(body:ProgressBody,result:ProgressResult)=>void;failed:(error:unknown)=>void}){
 let pending:Promise<boolean>|null=null,last='',paused=false;
 const save=async(manual=false):Promise<boolean>=>{
  if(!options.active())return true;
  if(pending){const success=await pending;if(!success)return false;return save(manual);}
  if(manual)paused=false;
  if(paused)return false;
  const body=options.body();if(!body)return true;const key=JSON.stringify(body);if(key===last)return true;
  pending=(async()=>{try{const result=await options.send(body);last=key;options.saved(body,result);return true;}catch(error){paused=true;options.failed(error);return false;}})();
  const success=await pending;pending=null;return success;
 };
 return save;
}
export function snippetText(text:string,terms:string[]){const s=String(text||'').replace(/\s+/g,' ').trim(),low=s.toLowerCase();let at=-1;for(const t of terms){const i=low.indexOf(t);if(i>=0&&(at<0||i<at))at=i;}if(at<0)return '';const a=Math.max(0,at-30),b=Math.min(s.length,at+70);return (a?'…':'')+s.slice(a,b)+(b<s.length?'…':'');}
export function highlightParts(text:string,terms:string[]){if(!terms.length)return [text];return text.split(new RegExp('('+terms.map(t=>t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')','gi'));}
