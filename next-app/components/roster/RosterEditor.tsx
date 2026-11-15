'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {ROSTER_DEPTS,ROSTER_REGIONS,FIELD_LABELS,type RosterPerson,type AdminRecord,type RosterReview} from '../../lib/roster-admin';
import {useMember} from '../MemberArea';
import {ErrorNote,Modal} from '../Ui';

type Confirmation='member'|'admin-on'|'admin-off'|null;
const EMPTY:RosterPerson={memberId:'',name:'',dept:'',region:'',affiliation:'',position:'',note:'',tier:'활동교사',inRoster:false,admin:null};
export default function RosterEditor({person,onClose,onReload,onSaved}:{person:RosterPerson|null;onClose:()=>void;onReload:()=>void;onSaved:(message:string,query:string)=>void}) {
 const {request,refreshAccess}=useMember(),initial=person||EMPTY,isNew=!person;
 const assignments=initial.admins||[],newAdmin={name:initial.name,dept:initial.dept,region:initial.region,position:'',phone:''};
 const [fields,setFields]=useState(initial),[assignmentId,setAssignmentId]=useState<number|'new'>(assignments[0]?.assignmentId||'new'),[admin,setAdmin]=useState<AdminRecord>(assignments[0]||newAdmin);
 const [confirmation,setConfirmation]=useState<Confirmation>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [review,setReview]=useState<(RosterReview&{action:string;body:Record<string,unknown>;message:string})|null>(null);
 const pending=useRef(false);
 const confirmationRef=useRef<HTMLElement>(null);
 useEffect(()=>{if(confirmation)confirmationRef.current?.focus();},[confirmation]);
 const change=(field:keyof RosterPerson,value:string)=>{setFields(current=>({...current,[field]:value}));setConfirmation(null);};
 async function perform(action:string,body:Record<string,unknown>,message:string){
  if(pending.current)return;pending.current=true;setBusy(true);setError('');
  try{
   const result=await request<{unchanged?:boolean}>(action,body);
   // 자기 보직을 수정한 경우 메뉴도 다시 확인한다. 저장 성공을 재조회 실패로 오인해 중복 실행하지 않는다.
   await refreshAccess().catch(()=>{});
   onSaved(result.unchanged?'바뀐 내용이 없어요.':message,fields.name);
  }catch(e){setError((e as Error).message);setConfirmation(null);}finally{pending.current=false;setBusy(false);}
 }
 async function preview(mode:'create'|'update'|'remove'){
  if(pending.current)return;pending.current=true;setBusy(true);setError('');setReview(null);
  const member={memberId:fields.memberId,name:fields.name,dept:fields.dept,region:fields.region,affiliation:fields.affiliation,position:fields.position,note:fields.note,isNew};
  const body={...(mode==='remove'?{targetId:initial.memberId}:{member}),expectedRevision:initial.rosterRevision};
  try{const result=await request<RosterReview>('previewRosterChange',{...body,mode});
   setReview({...result,body,action:mode==='remove'?'removeRosterMember':'saveRosterMember',message:mode==='remove'?'명단에서 뺐어요.':mode==='create'?'명단에 추가했어요.':'교사 정보를 저장했어요.'});setConfirmation('member');
  }catch(e){setError((e as Error).message);}finally{pending.current=false;setBusy(false);}
 }
 function save(event:FormEvent){event.preventDefault();void preview(isNew?'create':'update');}
 function confirm(){
  if(confirmation==='member'&&review)void perform(review.action,{...review.body,review:review.review,confirmed:true},review.message);
  const change={targetId:initial.memberId,assignmentId,expectedAdmins:assignments,confirmed:true};
  if(confirmation==='admin-off')void perform('setAdminMember',{...change,on:false},'선택한 관리자 보직을 해제했어요.');
  if(confirmation==='admin-on')void perform('setAdminMember',{...change,on:true,admin},'선택한 관리자 보직을 저장했어요.');
 }
 function chooseAssignment(value:string){const id=value==='new'?'new':Number(value);setAssignmentId(id);setAdmin(assignments.find(a=>a.assignmentId===id)||newAdmin);setConfirmation(null);setError('');}
 return <Modal title={isNew?'교사 추가':`${initial.name} · 명단 관리`} onClose={onClose} busy={busy}>
  <datalist id="roster-depts">{ROSTER_DEPTS.map(value=><option key={value} value={value}/>)}</datalist>
  <datalist id="roster-regions">{ROSTER_REGIONS.map(value=><option key={value} value={value}/>)}</datalist>
  {isNew||initial.inRoster?<form onSubmit={save}><fieldset disabled={busy||!!confirmation}>
   {isNew?<><label htmlFor="roster-id">고유번호</label><input id="roster-id" autoComplete="off" maxLength={40} required value={fields.memberId} onChange={e=>change('memberId',e.target.value)}/></>:null}
   <div className="filter-grid">{(['name','dept','region','affiliation','position','note'] as const).map((key,index)=><div key={key}><label htmlFor={'roster-'+key}>{['이름','부서','지역','소속(구역)','직책','소속 비고'][index]}</label><input id={'roster-'+key} list={key==='dept'?'roster-depts':key==='region'?'roster-regions':undefined} required={key==='name'||key==='dept'} maxLength={{name:30,dept:20,region:20,affiliation:40,position:30,note:60}[key]} value={fields[key]} onChange={e=>change(key,e.target.value)}/></div>)}</div>
   <p className="help">{isNew?'새 교사의 등급은 활동교사로 시작해요.':'등급 변경은 교사 명단의 등급 변경 기능을 이용해 주세요.'}</p>
   <div className="toolbar"><button className="primary" type="submit">{busy?'저장 중…':isNew?'교사 추가':'교사 정보 저장'}</button>{!isNew?<button className="secondary danger" type="button" onClick={()=>void preview('remove')}>명단에서 빼기</button>:null}</div>
  </fieldset></form>:<p className="help">교사명단에는 없고 관리자 명단에만 있는 사람입니다.</p>}
  {!isNew?<section className="panel"><h3>관리자 보직 · {assignments.length}개</h3><p className="muted">담당 부서·지역과 직책에 따라 업무 권한을 확인합니다. 교육 과정 운영은 과정별 위임도 필요합니다.</p>
   <fieldset disabled={busy||!!confirmation}><label htmlFor="admin-assignment">변경할 보직</label><select id="admin-assignment" value={assignmentId} onChange={e=>chooseAssignment(e.target.value)}>{assignments.map(a=><option key={a.assignmentId} value={a.assignmentId}>{a.dept} · {a.region||'지역 미지정'} · {a.position}</option>)}<option value="new">새 보직 추가</option></select>
    {(['name','dept','position','region','phone'] as const).map((key,index)=><div key={key}><label htmlFor={'admin-'+key}>{['관리자 이름','담당 부서','관리자 직책','담당 지역','연락처'][index]}</label><input id={'admin-'+key} list={key==='dept'?'roster-depts':key==='region'?'roster-regions':undefined} type={key==='phone'?'tel':'text'} maxLength={key==='position'||key==='name'?30:20} value={admin[key]} onChange={e=>setAdmin(current=>({...current,[key]:e.target.value}))}/></div>)}
   <div className="toolbar"><button className="secondary" disabled={!admin.name.trim()||!admin.dept.trim()||!admin.position.trim()} onClick={()=>setConfirmation('admin-on')}>{assignmentId==='new'?'관리자 보직 추가':'선택한 보직 저장'}</button>{assignmentId!=='new'?<button className="secondary danger" onClick={()=>setConfirmation('admin-off')}>선택한 보직 해제</button>:null}</div></fieldset>
  </section>:null}
  <ErrorNote message={error}/>{error?<button className="secondary" disabled={busy} onClick={onReload}>명단 다시 찾기</button>:null}
  {confirmation?<section ref={confirmationRef} tabIndex={-1} className="confirmation" role="region" aria-label="변경 확인"><h3>변경 내용을 확인해 주세요</h3>{confirmation==='member'&&review?<><p>{review.mode==='remove'?`${review.name}님을 교사 명단에서 뺍니다. 활동·출석 기록과 별도 관리자 보직, 기존 PIN은 남습니다. 관리자 보직이 있으면 그 보직에 따른 접근은 유지됩니다.`:review.mode==='create'?`${review.name}님을 새 교사로 추가합니다.`:`${review.name}님의 교사 정보를 수정합니다.`}</p>{review.mode==='remove'?<p>{[review.before?.dept,review.before?.region,review.before?.position,review.before?.tier].filter(Boolean).join(' · ')}</p>:<dl>{Object.entries(FIELD_LABELS).filter(([key])=>key!=='phone'&&(!review.before||review.before[key]!==review.after?.[key])).map(([key,label])=><div key={key}><dt>{label}</dt><dd>{review.before?`${review.before[key]||'(빈칸)'} → `:''}{review.after?.[key]||'(빈칸)'}</dd></div>)}</dl>}</>:<p>{confirmation==='admin-off'?`${initial.name}님의 ${assignments.find(a=>a.assignmentId===assignmentId)?.dept} · ${assignments.find(a=>a.assignmentId===assignmentId)?.region||'지역 미지정'} · ${assignments.find(a=>a.assignmentId===assignmentId)?.position} 보직만 해제합니다. 다른 겸직과 교사 명단의 직책은 유지됩니다.`:`${admin.name} · ${admin.dept} · ${admin.region||'지역 미지정'} · ${admin.position} 보직을 ${assignmentId==='new'?'추가':'수정'}합니다.`}</p>}<div className="toolbar"><button className="primary" disabled={busy} onClick={confirm}>{busy?'처리 중…':'확인하고 반영'}</button><button className="secondary" disabled={busy} onClick={()=>setConfirmation(null)}>취소</button></div></section>:null}
 </Modal>;
}
