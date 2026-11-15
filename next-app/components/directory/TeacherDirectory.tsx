'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {useMember} from '../MemberArea';
import {Counts,ErrorNote,Loading,Modal,Pager} from '../Ui';
import {useQuery} from '../../lib/use-query';
import {defaultDirectoryFilter,directoryParams,ORG_DEPTS,selectionAfterChange,tierChanges,type Directory,type DirectoryFilter,type Teacher} from '../../lib/directory';
import TeacherDetail from './TeacherDetail';
import TeacherExport from './TeacherExport';

type ChangeResult={changed:{memberId:string}[];failed:{memberId:string;error:string}[]};
type TierReview={review:string;changed:{memberId:string;name:string;prevTier:string;tier:string}[];failed:{memberId:string;error:string}[]};
export default function TeacherDirectory() {
 const {access,request}=useMember();
 const [ready,setReady]=useState(false),[filter,setFilter]=useState(defaultDirectoryFilter),[search,setSearch]=useState(''),[page,setPage]=useState(1),[limit,setLimit]=useState(20);
 const [selected,setSelected]=useState(new Map<string,Teacher>()),[selecting,setSelecting]=useState(false),[allSelected,setAllSelected]=useState(false);
 const [detail,setDetail]=useState<Teacher|null>(null),[exporting,setExporting]=useState(false),[tier,setTier]=useState(''),[changes,setChanges]=useState<ReturnType<typeof tierChanges>|null>(null);
 const [review,setReview]=useState<TierReview|null>(null);
 const [busy,setBusy]=useState(false),[note,setNote]=useState(''),[error,setError]=useState(''),selectSequence=useRef(0),mutationPending=useRef(false);
 const result=useQuery<Directory>('getTeacherDirectory',directoryParams(filter,page,limit),ready);
 const data=result.data,rows=data?.rows||[];
 useEffect(()=>{const params=new URLSearchParams(location.search);setFilter({...defaultDirectoryFilter,dept:ORG_DEPTS.includes(params.get('dept')||'')?params.get('dept')!:'',region:params.get('region')||'',query:params.get('query')||''});setSearch(params.get('query')||'');setReady(true);return()=>{selectSequence.current++;};},[]);
 function changeFilter(patch:Partial<DirectoryFilter>){selectSequence.current++;setSelecting(false);setFilter(value=>({...value,...patch}));setPage(1);setSelected(new Map());setAllSelected(false);setNote('');setError('');}
 function searchSubmit(event:FormEvent){event.preventDefault();changeFilter({query:search.trim()});}
 async function selectAll(){
  const sequence=++selectSequence.current;setError('');
  if(allSelected){setSelected(new Map());setAllSelected(false);return;}
  setSelecting(true);
  try{const all=await request<Directory>('getTeacherDirectory',directoryParams(filter,1,0));if(sequence!==selectSequence.current)return;setSelected(new Map(all.rows.map(row=>[row.memberId,row])));setAllSelected(true);}
  catch(e){if(sequence===selectSequence.current)setError((e as Error).message);}finally{if(sequence===selectSequence.current)setSelecting(false);}
 }
 function toggle(row:Teacher){selectSequence.current++;setSelecting(false);setAllSelected(false);setSelected(current=>{const next=new Map(current);if(next.has(row.memberId))next.delete(row.memberId);else next.set(row.memberId,row);return next;});}
 async function confirmChanges(suggested:boolean){
  if(mutationPending.current)return;
  setError('');setNote('');const items=tierChanges([...selected.values()],tier,suggested);
  if(!items.length){setError('변경할 대상을 선택하고 등급을 확인해 주세요. 같은 등급이거나 제안이 없는 분은 제외됩니다.');return;}
  if(items.length>500){setError('한 번에 최대 500명까지 변경할 수 있어요. 선택 범위를 줄여 주세요.');return;}
  mutationPending.current=true;setBusy(true);
  try{const next=await request<TierReview>('previewTierChange',{items});setChanges(items);setReview(next);}
  catch(e){setError((e as Error).message);}finally{mutationPending.current=false;setBusy(false);}
 }
 async function refreshReview(){if(!changes||mutationPending.current)return;mutationPending.current=true;setBusy(true);setError('');
  try{setReview(await request<TierReview>('previewTierChange',{items:changes}));}
  catch(e){setError((e as Error).message);}finally{mutationPending.current=false;setBusy(false);}}
 async function applyChanges(){if(!changes||!review||mutationPending.current)return;mutationPending.current=true;setBusy(true);setError('');
  try{const result=await request<ChangeResult>('bulkChangeTier',{items:changes,review:review.review,confirmed:true});setSelected(value=>selectionAfterChange(value,result.changed));setAllSelected(false);setNote(`${result.changed.length}명 변경 완료${result.failed.length?` · 변경하지 못한 ${result.failed.length}명: ${result.failed.map(row=>row.error).join(', ')}`:''}`);setChanges(null);setReview(null);dataRefresh();}
  catch(e){setError((e as Error).message);setReview(null);}finally{mutationPending.current=false;setBusy(false);}}
 function dataRefresh(){result.reload();}
 return <><div className="page-title"><div><p className="eyebrow">함께하는 교사</p><h1>교사 명단</h1><p className="muted">부서·지역과 활동 현황을 확인해요.</p></div><button className="secondary" onClick={dataRefresh} disabled={result.loading||busy}>다시 불러오기</button></div>
  <section className="panel"><form onSubmit={searchSubmit} className="search-form"><label htmlFor="teacher-search" className="sr-only">교사 검색</label><input id="teacher-search" value={search} maxLength={120} onChange={e=>setSearch(e.target.value)} placeholder="이름·고유번호·지역·직책 검색"/><button className="primary" type="submit">검색</button><button className="secondary" type="button" onClick={()=>{setSearch('');changeFilter({query:''});}}>지우기</button></form>
  <fieldset className="filter-grid" disabled={busy}>
   <div><label htmlFor="teacher-dept">부서</label><select id="teacher-dept" value={filter.dept} onChange={e=>changeFilter({dept:e.target.value,region:''})}><option value="">전체 부서</option>{ORG_DEPTS.map(d=><option key={d}>{d}</option>)}</select></div>
   <div><label htmlFor="teacher-region">지역</label><select id="teacher-region" value={filter.region} disabled={!filter.dept||result.loading} onChange={e=>changeFilter({region:e.target.value})}><option value="">전체 지역</option>{(data?.regionsByDept[filter.dept]||[filter.region]).filter(r=>r&&r!=='지역 없음').map(r=><option key={r}>{r}</option>)}</select></div>
   <div><label htmlFor="teacher-tier">교사 구분</label><select id="teacher-tier" value={filter.tier} onChange={e=>changeFilter({tier:e.target.value})}><option value="">전체 구분</option>{(data?.tiers||[filter.tier]).filter(Boolean).map(t=><option key={t}>{t}</option>)}</select></div>
   <div><label htmlFor="teacher-admin">직책</label><select id="teacher-admin" value={filter.adminOnly?'admin':''} onChange={e=>changeFilter({adminOnly:!!e.target.value,...(e.target.value?{dept:'',region:''}:{})})}><option value="">직책 전체</option><option value="admin">관리자 직책만</option></select></div>
   <div><label htmlFor="teacher-apply">활동 신청</label><select id="teacher-apply" value={filter.apply} onChange={e=>changeFilter({apply:e.target.value})}><option value="">전체</option><option value="yes">신청 있음</option><option value="no">신청 없음</option></select></div>
   <div><label htmlFor="teacher-leads">최근 1년 인도 건수 이상</label><input id="teacher-leads" type="number" min="0" value={filter.minLeads||''} onChange={e=>changeFilter({minLeads:Math.max(0,Number(e.target.value)||0)})}/></div>
  </fieldset><div className="toolbar"><label className="check-label"><input type="checkbox" checked={filter.pendingOnly} onChange={e=>changeFilter({pendingOnly:e.target.checked})}/>등급 제안만 보기 {data?`(${data.pendingTotal}명)`:''}</label><label className="inline-label">표시 인원<select aria-label="표시 인원" value={limit} onChange={e=>{setLimit(Number(e.target.value));setPage(1);}}><option value="20">20명</option><option value="50">50명</option><option value="0">전체</option></select></label>{access.permissions.canExportTeachers?<button className="secondary" disabled={!data} onClick={()=>setExporting(true)}>엑셀 받기</button>:null}</div></section>
  <ErrorNote message={result.error} retry={result.reload}/><ErrorNote message={changes?'':error}/>{note?<p className="notice" role="status">{note}</p>:null}
  <section className="panel"><div className="toolbar"><label className="check-label"><input aria-label="검색 결과 전체 선택" type="checkbox" checked={allSelected} disabled={!data||selecting||busy} onChange={selectAll}/>검색 결과 전체 선택</label><span role="status">{selecting?'다른 페이지까지 선택 중…':`${selected.size.toLocaleString()}명 선택`}</span><button className="text-button" disabled={busy} onClick={()=>{selectSequence.current++;setSelecting(false);setSelected(new Map());setAllSelected(false);}}>선택 해제</button></div>
   {access.permissions.canChangeTier?<div className="toolbar"><label className="inline-label">변경할 등급<select aria-label="변경할 등급" value={tier} onChange={e=>setTier(e.target.value)} disabled={busy}><option value="">등급 선택</option>{(data?.tiers||[]).map(t=><option key={t}>{t}</option>)}</select></label><button className="primary" disabled={!selected.size||selecting||busy} onClick={()=>confirmChanges(false)}>선택한 등급으로 변경</button><button className="secondary" disabled={!selected.size||selecting||busy} onClick={()=>confirmChanges(true)}>제안대로 변경</button></div>:null}
   <p className="muted">전체 선택은 현재 검색 조건에 맞는 다른 페이지의 교사도 포함합니다.</p>
  </section>
  {result.loading?<Loading/>:data?<><Pager page={data.page} pages={data.pages} total={data.total} onPage={setPage}/><div className="table-wrap"><table className="data-table"><caption className="sr-only">교사 검색 결과</caption><thead><tr><th>선택</th><th>이름·부서·지역</th><th>교사 구분</th><th>직책</th><th>이번 달 활동</th><th>출석</th><th>센터 등록</th><th>등급 제안</th></tr></thead><tbody>{rows.map(row=><tr key={row.memberId}><td><input type="checkbox" aria-label={`${row.name} 선택`} checked={selected.has(row.memberId)} onChange={()=>toggle(row)} disabled={busy}/></td><th scope="row"><button className="row-link" onClick={()=>setDetail(row)}>{row.name}</button><small>{row.dept} · {row.region||'지역 없음'}</small>{row.caseRank?<small>사례 {row.caseRank}위</small>:null}</th><td>{row.tier}</td><td>{row.position||'-'}</td><td>{row.monthlyCount.toLocaleString()}건</td><td>{row.attend1m}회</td><td>{row.regLeads??row.leads1y}명</td><td>{row.suggestion?.suggestedTier||'-'}</td></tr>)}</tbody></table>{!rows.length?<p className="empty">조건에 맞는 교사가 없어요.</p>:null}</div><Pager page={data.page} pages={data.pages} total={data.total} onPage={setPage}/></>:null}
  {detail?<TeacherDetail key={detail.memberId} teacher={detail} onClose={()=>setDetail(null)} onChanged={dataRefresh}/>:null}
  {exporting&&data?<TeacherExport regionsByDept={data.regionsByDept} initialDept={filter.dept} onClose={()=>setExporting(false)}/>:null}
  {changes?<Modal title="등급 변경 확인" onClose={()=>{setChanges(null);setReview(null);setError('');}} busy={busy}>
   {review?<><p>{access.name}님의 승인으로 아래 {review.changed.length}명의 등급을 변경합니다.</p><Counts values={review.changed.reduce<Record<string,number>>((counts,row)=>{counts[row.tier]=(counts[row.tier]||0)+1;return counts;},{})}/>
    <ul style={{maxHeight:240,overflowY:'auto'}}>{review.changed.map(row=><li key={row.memberId}>{row.name} · {row.prevTier} → {row.tier}</li>)}</ul>
    {review.failed.length?<div className="notice"><p>아래 {review.failed.length}명은 변경에서 제외됩니다. 등급이 바뀐 경우 이 창을 닫고 명단을 다시 불러와 주세요.</p><ul>{review.failed.map(row=><li key={row.memberId}>{selected.get(row.memberId)?.name||'선택한 교사'} · {row.error}</li>)}</ul></div>:null}</>:null}
   <p className="muted">변경 전후와 승인자는 서버에 함께 기록됩니다.</p><ErrorNote message={error}/>
   {review?<button className="primary" disabled={busy||!review.changed.length} onClick={applyChanges}>{busy?'변경 중…':'등급 변경 확인'}</button>:<button className="secondary" disabled={busy} onClick={refreshReview}>{busy?'확인 중…':'변경 내용 다시 확인'}</button>}
  </Modal>:null}

 </>;
}
