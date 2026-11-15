import {createReportTools,activityOptionsForRoles,COOP_ROLE,ACTIVITY_TO_STAGE,ROLE_ACTIVITY_ALL,TARGET_STAGES_FALLBACK} from './activity-report.mjs';
export type Lesson={date:string;title:string};
export type ReportField='center'|'enroll'|'cohortNo'|'course'|'age'|'phone4'|'faith'|'recruitType'|'stageMark'|'time'|'eduTotal'|'eduWeekly'|'nextDate'|'request';
export type Report=Record<ReportField,string>&{team:Record<string,string>;checks:Record<string,string>;plan:Record<string,string>;lessons:Lesson[];lesson?:string;photos?:string[]};
export type Activity={id:number;name:string;submittedAt:string;activities:string[];roles:string[];targetName:string;targetGender:string;targetAgeGroup:string;targetStage:string;todayWork:string;nextWork:string;note:string;consultTitle:string;gospelSubject:string;reaction:string;reactionNote:string;report:Partial<Report>|null;reportText:string;reportTitle:string;editedAt:string;tgPosts:{kind:string;room?:string;url?:string;at?:string}[];aiFeedback:string;aiFeedbackAt:string;sequence?:number};
export type Target={targetId:string;targetName:string;stage:string;gender:string;ageGroup:string;completed:boolean;leaderId?:string;helperId?:string;memo:string;nextMeetingDate:string;goalCohort:string;goalPlan:string;goalPlanAt:string;goalPlanBasis?:string;reportProfile:Partial<Report>|null;teacherChangeLog:string;history?:{changedAt:string;fromStage:string;toStage:string;memo:string}[]};
export type CoopRecord={id:number;submittedAt:string;activities:string[];targetName:string};
export type Overview={coopRecords?:CoopRecord[];total:number;people:{name:string;total:number;edu:number;feedbackCount:number;postedCount:number;stageCandidates:string[];last:string;latest:Activity}[];names:{name:string;total:number;roles:string[]}[]};
export type ActivitySummary={overview:Overview;rows:Activity[];roleCounts:Record<string,number>;roleItemCounts:Record<string,Record<string,number>>;reportRoom:{title:string}|null};
export type ActivityCard=Pick<Activity,'id'|'submittedAt'|'activities'|'roles'|'targetName'|'targetStage'|'sequence'>&{preview:string;hasAiFeedback:boolean;reported?:boolean};
export type ActivityPage<Row=Activity>={rows:Row[];total:number;page:number;pages:number;limit:number;through:number};
export type ActivityForm={date:string;roles:string[];items:string[];activityItem:string;photos:string[];existingTargetId:string;targetName:string;targetGender:string;targetAgeGroup:string;targetStage:string;goalCohort:string;todayWork:string;nextWork:string;extraTitle:string;reaction:string;reactionNote:string;rp:Report;rpAuto:Record<string,boolean>;rpTotalAuto:boolean;rpTodayAt:number|null;rpLessonsEdited:boolean;editId:number|null;editOrigName:string;draftId:string|null};
export type ReportContext={name:string;memberId:string;dept:string;targets:Target[];overview?:Overview;today:string};
export type ActivityDeliveryResult={reported?:boolean;reposted?:boolean;reportError?:string;repostError?:string};
// 첫 방 성공과 뒤 방 실패를 함께 돌려주는 서버 계약을 보존한다.
export function activityDeliveryNotice(result:ActivityDeliveryResult){
 const delivered=result.reported||result.reposted,error=result.reportError||result.repostError;
 if(error)return delivered?` 일부 보고방에만 올렸어요. 전달하지 못한 보고방: ${error}`:` 보고방 전달은 완료하지 못했어요: ${error}`;
 return delivered?' 보고방에도 올렸어요.':'';
}
// 같은 이름의 대상자가 여럿이면 기존 화면처럼 목록의 첫 대상을 사용한다.
export function activityPeople(overview:Overview|undefined,targets:Target[]){
 const byName=new Map<string,Target>();
 for(const target of targets){const name=target.targetName.trim();if(!byName.has(name))byName.set(name,target);}
 return (overview?.people||[]).map(person=>{
  const target=byName.get(person.name)||null;
  const candidates=[target?.stage,...person.stageCandidates].filter((s):s is string=>!!s&&TARGET_STAGES_FALLBACK.includes(s));
  const stage=candidates.reduce((best,value)=>TARGET_STAGES_FALLBACK.indexOf(value)>TARGET_STAGES_FALLBACK.indexOf(best)?value:best,'');
  return {...person,target,stage};
 });
}
export const localDate=()=>{const now=new Date();return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;};
export function emptyActivity(context:ReportContext):ActivityForm{return {date:context.today,roles:[],items:[],activityItem:'',photos:[],existingTargetId:'',targetName:'',targetGender:'',targetAgeGroup:'',targetStage:'',goalCohort:'',todayWork:'',nextWork:'',extraTitle:'',reaction:'',reactionNote:'',rp:createReportTools(context).rpEmpty() as Report,rpAuto:{},rpTotalAuto:false,rpTodayAt:null,rpLessonsEdited:false,editId:null,editOrigName:'',draftId:null};}
export function normalizeActivity(f:ActivityForm,context:ReportContext){const tools=createReportTools(context);tools.rpSyncSelf(f);if(tools.rpTier(f.activityItem)==='edu'&&(!f.rp.eduTotal||f.rpTotalAuto)){f.rp.eduTotal=String(f.rp.lessons.length+1);f.rpTotalAuto=true;}return f;}
export function selectActivityRole(f:ActivityForm,role:string){f.roles=f.roles.includes(role)?f.roles.filter(r=>r!==role):role===COOP_ROLE?[role]:f.roles.filter(r=>r!==COOP_ROLE).concat(role);const options=activityOptionsForRoles(f.roles);f.items=f.items.filter(item=>options.includes(item));if(!f.items.length&&f.roles.length)f.items=[options[0]];f.activityItem=createReportTools({}).rpPrimary(f.items);}
export function selectActivityItem(f:ActivityForm,item:string){const tools=createReportTools({});f.items=f.items.includes(item)?f.items.filter(v=>v!==item):[...f.items,item];const previous=f.activityItem;f.activityItem=tools.rpPrimary(f.items);if(f.activityItem===previous)return;const mapped=(ACTIVITY_TO_STAGE as Record<string,string>)[f.activityItem];if(mapped&&!(mapped==='만남1'&&ROLE_ACTIVITY_ALL.indexOf(f.targetStage)>ROLE_ACTIVITY_ALL.indexOf(mapped)))f.targetStage=mapped;const mark=(tools.RP_STAGE_MARK_OF as Record<string,string>)[f.activityItem];if(mark)f.rp.stageMark=mark;f.extraTitle='';}
export function applyTarget(f:ActivityForm,t:Target,context:ReportContext){f.existingTargetId=t.targetId;f.targetName=t.targetName||'';f.targetGender=t.gender||'';f.targetAgeGroup=t.ageGroup||'';f.targetStage=t.stage||'';f.goalCohort=t.goalCohort||'';f.rp={...createReportTools(context).rpFromTarget(t),time:f.rp.time,request:f.rp.request} as Report;f.rpAuto={};f.rpTotalAuto=false;f.rpTodayAt=null;}
export function editActivity(a:Activity,context:ReportContext):ActivityForm{
 const f=emptyActivity(context),tools=createReportTools(context),rep=a.report||{},t=context.targets.find(t=>t.targetName.trim()===a.targetName.trim());
 Object.assign(f,{editId:a.id,date:a.submittedAt.slice(0,10)||context.today,roles:[...(a.roles||[])],items:[...(a.activities||[])],activityItem:a.activities?.[0]||'',photos:(rep.photos||[]).slice(0,3),existingTargetId:t?.targetId||'',targetName:a.targetName||'',editOrigName:a.targetName.trim(),targetGender:a.targetGender||'',targetAgeGroup:a.targetAgeGroup||'',targetStage:a.targetStage||'',goalCohort:t?.goalCohort||'',todayWork:a.todayWork||'',nextWork:a.nextWork||'',extraTitle:rep.lesson||a.gospelSubject||a.consultTitle||'',reaction:a.reaction||'',reactionNote:a.reactionNote||''});
 const base=(t?tools.rpFromTarget(t):tools.rpEmpty()) as Report,at=base.lessons.findIndex(l=>l&&l.date===f.date&&l.title===rep.lesson);
 const keys:ReportField[]=['center','enroll','cohortNo','course','age','faith','recruitType','phone4','stageMark','time','nextDate','eduTotal','eduWeekly'];
 f.rp={...base,...Object.fromEntries(keys.filter(k=>rep[k]!==undefined).map(k=>[k,rep[k]])),lessons:at>=0?base.lessons.filter((_,i)=>i!==at):base.lessons.filter(l=>!l||l.title!==rep.lesson),team:{...base.team,...rep.team},checks:{...base.checks,...rep.checks},plan:{...base.plan,...rep.plan},request:rep.request!==undefined?rep.request:a.note||''};f.rpTodayAt=at>=0?at:null;return normalizeActivity(f,context);
}
export function activityPayload(f:ActivityForm,context:ReportContext){const tools=createReportTools(context);return {id:f.editId||undefined,roles:f.roles,activityItem:f.activityItem,date:f.date,activities:[f.activityItem,...f.items.filter(x=>x!==f.activityItem)],photos:f.photos,target:{name:f.targetName.trim(),gender:f.targetGender,ageGroup:f.targetAgeGroup,stage:f.targetStage,note:'',todayWork:f.todayWork.trim(),nextWork:f.nextWork.trim()},consultTitle:['상담1','상담2'].includes(f.activityItem)?f.extraTitle.trim():'',gospelSubject:f.activityItem==='복음방'?f.extraTitle.trim():'',reaction:f.reaction,reactionNote:f.reactionNote.trim(),note:f.rp.request.trim(),report:tools.rpPayload(f),reportText:tools.rpReportText(f)};}
export function goalMonths(today:string){const [y,m]=today.split('-').map(Number);return Array.from({length:7},(_,i)=>`${y+Math.floor((m-1+i)/12)}-${String((m-1+i)%12+1).padStart(2,'0')}`);}
export function addLesson(f:ActivityForm){const tools=createReportTools({}),at=tools.rpTodayAt(f),keep=f.rp.lessons.map((l,i)=>({l,i})).filter(({l})=>String(typeof l==='string'?l:l?.title||'').trim());f.rpTodayAt=f.extraTitle.trim()?keep.filter(x=>x.i<at).length:null;f.rp.lessons=keep.map(x=>x.l);f.rp.lessons.push({date:f.date,title:''});f.rpLessonsEdited=true;}
export function removeLesson(f:ActivityForm,i:number){const at=createReportTools({}).rpTodayAt(f);f.rp.lessons.splice(i,1);if(i<at)f.rpTodayAt=at-1;f.rpLessonsEdited=true;}
export type Draft={id:string;at:string;name:string;item:string;form:ActivityForm};
const draftKey=(id:string)=>'ts_rp_drafts_'+id;
export function readDrafts(id:string):Draft[]{try{const rows=JSON.parse(localStorage.getItem(draftKey(id))||'[]');return Array.isArray(rows)?rows.filter(d=>d&&typeof d.id==='string'&&d.form&&Array.isArray(d.form.roles)&&d.form.rp).slice(0,30):[];}catch{return [];}}
export function writeDrafts(id:string,rows:Draft[]){try{localStorage.setItem(draftKey(id),JSON.stringify(rows.slice(0,30)));}catch{throw Error('임시 저장 공간이 부족해요. 오래된 임시 저장이나 사진을 줄여 주세요.');}}
export function draftForm(draft:Draft,context:ReportContext){const base=emptyActivity(context),saved=structuredClone(draft.form),f={...base,...saved,rp:{...base.rp,...saved.rp,team:{...saved.rp?.team},checks:{...saved.rp?.checks},plan:{...saved.rp?.plan},lessons:Array.isArray(saved.rp?.lessons)?saved.rp.lessons:[]},photos:Array.isArray(saved.photos)?saved.photos.slice(0,3):[],rpAuto:saved.rpAuto||{},items:Array.isArray(saved.items)?saved.items:saved.activityItem?[saved.activityItem]:[],draftId:draft.id,editId:null};return normalizeActivity(f,context);}
