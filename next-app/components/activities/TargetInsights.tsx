'use client';
import Link from 'next/link';
import {planCoachDraft} from '../../lib/coach-conversation';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {useMember} from '../MemberArea';
import {ErrorNote,Loading} from '../Ui';
import {useQuery} from '../../lib/use-query';
import type {Target} from '../../lib/activities';
import {checkedFeedbackText,infoCategories,toggleInfoCategory,type SavedFeedback,type TargetInfo,type TargetFile} from '../../lib/target-insights';

function Feedback({title,value}:{title:string;value:SavedFeedback|null}){
  return value?<details className="report-preview"><summary>{title} · {value.at}</summary>{value.basis?<p className="muted">{value.basis}</p>:null}<pre>{value.text}</pre></details>:null;
}
function HistoryPager({page,total,onPage}:{page:number;total:number;onPage:(n:number)=>void}){
  return <nav className="pager" aria-label="기록 페이지"><span>{total.toLocaleString()}건 · {page}/{Math.max(1,Math.ceil(total/20))}쪽</span><div><button className="secondary" disabled={page<=1} onClick={()=>onPage(page-1)}>이전 기록</button><button className="secondary" disabled={page*20>=total} onClick={()=>onPage(page+1)}>다음 기록</button></div></nav>;
}

export default function TargetInsights({target,busy,onBusy,onEdit,onCoach,view}:{view?:'info'|'plan'|'hearts';target:Target;busy:boolean;onBusy:(value:boolean)=>void;onEdit:()=>void;onCoach:(text:string)=>void}){
  const {request}=useMember(),pending=useRef(false);
  const info=useQuery<TargetInfo>('getTargetInfo',{targetId:target.targetId});
  const [tab,setTab]=useState<string>(view||'info'),[fileVersion,setFileVersion]=useState(0),[fileOpened,setFileOpened]=useState(!!view&&view!=='info');
  useEffect(()=>{if(view){setTab(view);if(view!=='info')setFileOpened(true);setPage(1);setDeleting(null);}},[view]);
  const file=useQuery<TargetFile>('getTargetFile',{targetId:target.targetId,_revision:fileVersion},fileOpened);
  const [draft,setDraft]=useState(''),[selected,setSelected]=useState(['기타']),[filter,setFilter]=useState(''),[page,setPage]=useState(1),[deleting,setDeleting]=useState<number|null>(null);
  const [running,setRunning]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
  // 생성 결과는 서버가 저장한 응답으로만 바꾼다. 실패해도 이전 결과를 지우지 않는다.
  const [feedback,setFeedback]=useState<SavedFeedback|null>(null),[master,setMaster]=useState<SavedFeedback|null>(null);
  const [plan,setPlan]=useState<SavedFeedback|null>(target.goalPlan?{text:target.goalPlan,at:target.goalPlanAt,basis:target.goalPlanBasis||''}:null);
  async function perform(label:string,work:()=>Promise<void>){
    if(pending.current||busy)return;
    pending.current=true;onBusy(true);setRunning(label);setError('');setNotice('');
    try{await work();}catch(error){setError(error instanceof Error?error.message:'처리하지 못했어요.');}
    finally{pending.current=false;onBusy(false);setRunning('');}
  }
  function add(event:FormEvent){
    event.preventDefault();
    if(!draft.trim())return;
    void perform('정보 저장',async()=>{
      await request('addTargetInfo',{targetId:target.targetId,cats:selected,text:draft.trim()});
      setDraft('');setFilter('');setPage(1);setNotice('파악 정보를 저장했어요.');info.reload();
    });
  }
  function generate(kind:'info'|'master'|'plan'){
    const action=kind==='info'?'targetInfoFeedback':kind==='master'?'targetMasterFeedback':'planCohortLead';
    void perform(kind==='plan'?'개강 계획 작성':'피드백 작성',async()=>{
      const result=await request<SavedFeedback&{goalPlanAt?:string}>(action,{targetId:target.targetId});
      const saved={text:checkedFeedbackText(result.text),at:result.goalPlanAt||result.at,basis:result.basis};
      if(kind==='info')setFeedback(saved);
      else if(kind==='master')setMaster(saved);
      else{setPlan(saved);setFileVersion(v=>v+1);}
      setNotice('새 결과를 저장했어요. 아래에서 펼쳐 볼 수 있어요.');
    });
  }
  const items=info.data?.items||[],filtered=items.filter(item=>!filter||infoCategories(item).includes(filter));
  const current=Math.min(page,Math.max(1,Math.ceil(filtered.length/20)));
  const plans=(file.data?.plans||[]).filter(row=>row.text!==plan?.text);
  const planPage=Math.min(page,Math.max(1,Math.ceil(plans.length/20)));
  const heartsPage=Math.min(page,Math.max(1,Math.ceil((file.data?.hearts.length||0)/20)));
  return <section className="target-insights">
    {!view?<nav className="tabs" aria-label="대상자 누적 정보">{[['info','파악 정보'],['plan','개강 계획'],['hearts','HEARTS·교관 답변']].map(([value,label])=><button className="secondary" key={value} disabled={busy} aria-pressed={tab===value} onClick={()=>{setTab(value);if(value!=='info')setFileOpened(true);setPage(1);setDeleting(null);}}>{label}</button>)}</nav>:null}
    {running?<Loading>{running} 중이에요. 잠시 기다려 주세요.</Loading>:null}
    <ErrorNote message={error}/>{notice?<p role="status">{notice}</p>:null}
    {tab==='info'?<>
      <ErrorNote message={info.error} retry={info.reload}/>{info.loading?<Loading/>:info.data?<>
        <h3>대화하며 알게 된 정보</h3>
        <form onSubmit={add}>
          <fieldset disabled={busy}><legend>분류 · 여러 개 선택할 수 있어요</legend><div className="toolbar">{info.data.cats.map(cat=><label className="check-label" key={cat}><input type="checkbox" checked={selected.includes(cat)} onChange={()=>setSelected(s=>toggleInfoCategory(s,cat))}/>{cat}</label>)}</div></fieldset>
          <label>파악한 내용<textarea rows={4} maxLength={2000} value={draft} disabled={busy} onChange={e=>setDraft(e.target.value)} placeholder="새로 알게 된 것을 남겨 주세요."/></label>
          <button className="primary" disabled={busy||!draft.trim()}>정보 저장</button>
        </form>
        <div className="toolbar"><button className="secondary" disabled={busy||!items.length} onClick={()=>generate('info')}>파악 정보 피드백 받기</button><button className="secondary" disabled={busy} onClick={()=>generate('master')}>누적 종합 피드백 받기</button></div>
        <Feedback title="파악 정보 피드백" value={feedback||info.data.feedback}/><Feedback title="종합 피드백" value={master||info.data.master}/>
        <label>정보 분류 보기<select value={filter} onChange={e=>{setFilter(e.target.value);setPage(1);setDeleting(null);}}><option value="">전체 ({items.length})</option>{info.data.cats.map(cat=><option key={cat} value={cat}>{cat} ({items.filter(item=>infoCategories(item).includes(cat)).length})</option>)}</select></label>
        <HistoryPager page={current} total={filtered.length} onPage={setPage}/>
        {filtered.slice((current-1)*20,current*20).map(item=><article className="panel" key={item.id}><p className="muted">{infoCategories(item).join(' · ')} · {item.at}</p><p className="pre-wrap">{item.text}</p>{deleting===item.id?<div><p>이 파악 정보를 지울까요?</p><div className="toolbar"><button className="secondary" disabled={busy} onClick={()=>setDeleting(null)}>취소</button><button className="primary danger" disabled={busy} onClick={()=>void perform('정보 삭제',async()=>{await request('deleteTargetInfo',{targetId:target.targetId,id:item.id});setDeleting(null);info.reload();setNotice('파악 정보를 지웠어요.');})}>이 정보 삭제</button></div></div>:<button className="text-button danger" disabled={busy} onClick={()=>setDeleting(item.id)}>정보 지우기</button>}</article>)}
        {!filtered.length?<p className="empty">이 분류에 남긴 정보가 없어요.</p>:null}
      </>:null}
    </>:<>
      <ErrorNote message={file.error} retry={file.reload}/>
      {tab==='plan'?<>
        <h3>개강 목표 {target.goalCohort||'미설정'}</h3><p className="muted">누적 기록을 바탕으로 계획을 받아 보고, 최종 계획은 담당 교관과 상의해 주세요.</p>
        <div className="toolbar"><button className="secondary" disabled={busy} onClick={onEdit}>개강 목표 수정</button><button className="primary" disabled={busy||!target.goalCohort} onClick={()=>generate('plan')}>{plan?'지금 기록으로 계획 다시 받기':'개강 계획 받기'}</button><button type="button" className="secondary" disabled={busy} onClick={()=>onCoach(planCoachDraft(target))}>교관과 계획 상의</button></div>
        <Feedback title="현재 개강 계획" value={plan}/>
        {file.loading?<Loading/>:file.data?<><h4>이전 개강 계획 {plans.length}건</h4><HistoryPager page={planPage} total={plans.length} onPage={setPage}/>{plans.slice((planPage-1)*20,planPage*20).map((row,index)=><Feedback key={index} title="이전 계획" value={{text:row.text,at:row.at,basis:row.input}}/>)}</>:null}
      </>:<>
        <h3>HEARTS·교관 답변</h3><Link className="secondary" href={`/coaching?target=${encodeURIComponent(target.targetId)}`}>누적 기록으로 새 상담</Link>{file.loading?<Loading/>:file.data?<><HistoryPager page={heartsPage} total={file.data.hearts.length} onPage={setPage}/>{file.data.hearts.slice((heartsPage-1)*20,heartsPage*20).map((row,index)=><details className="report-preview" key={index}><summary>{row.at} · {row.source||'상담'} · {row.status}</summary><h4>상황</h4><pre>{row.situation}</pre>{row.ai?<><h4>AI 피드백</h4><pre>{row.ai}</pre></>:null}{row.answer?<><h4>교관 답변{row.handler?` · ${row.handler}`:''}</h4><pre>{row.answer}</pre></>:null}</details>)}{!file.data.hearts.length?<p className="empty">아직 저장된 상담·답변이 없어요.</p>:null}</>:null}
      </>}
    </>}
  </section>;
}
