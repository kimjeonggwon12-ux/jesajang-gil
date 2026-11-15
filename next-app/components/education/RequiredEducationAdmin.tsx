'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {useMember} from '../MemberArea';
import {useQuery} from '../../lib/use-query';
import {DEFAULT_EDUCATION,type RequiredEducation} from '../../lib/directory-detail';
import {ORG_DEPTS} from '../../lib/directory';
import {educationToday,type EducationPerson,type EducationLog} from '../../lib/required-education';
import {ErrorNote,Loading,Modal} from '../Ui';

function CompletionForm({person,onClose,onSaved}:{person:EducationPerson;onClose:()=>void;onSaved:()=>void}) {
 const {access,request}=useMember(),current=useQuery<RequiredEducation>('getRequiredEducation',{memberId:person.memberId});
 const [category,setCategory]=useState(DEFAULT_EDUCATION[0]),[date,setDate]=useState(educationToday),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const pending=useRef(false);
 async function submit(event:FormEvent){
  event.preventDefault();if(pending.current)return;if(!confirm){setConfirm(true);return;}
  pending.current=true;setBusy(true);setError('');setMessage('');
  try{await request('updateRequiredEducation',{memberId:person.memberId,name:person.name,category,date:date||educationToday()});setMessage(`${person.name} 교사 · ${category} · ${date||educationToday()} 이수로 등록했어요.`);setConfirm(false);current.reload();onSaved();}
  catch(e){setError((e as Error).message);}finally{pending.current=false;setBusy(false);}
 }
 return <Modal title={`${person.name} · ${access.permissions.canManageRoster?'이수 등록':'이수 현황'}`} onClose={onClose} busy={busy}>
  <p>{person.dept} · {person.region}</p><ErrorNote message={current.error} retry={current.reload}/>{current.loading?<Loading/>:current.data?<dl className="detail-list">{DEFAULT_EDUCATION.map(c=><div key={c}><dt>{c}</dt><dd>{String(current.data?.[c]||'미이수')}</dd></div>)}</dl>:null}
  {access.permissions.canManageRoster?<form onSubmit={submit}><fieldset disabled={busy}><label>이수 항목<select value={category} onChange={e=>{setCategory(e.target.value);setConfirm(false);setMessage('');}}>{DEFAULT_EDUCATION.map(c=><option key={c}>{c}</option>)}</select></label>
   <label>이수일<input type="date" max={educationToday()} required value={date} onChange={e=>{setDate(e.target.value);setConfirm(false);setMessage('');}}/></label>
   <p>등록자: {access.name} (로그인한 담당자로 기록돼요.)</p><ErrorNote message={error}/>{message?<p role="status" className="notice">{message}</p>:null}
   {confirm?<p>{person.name}님의 {category} 이수일을 {date}로 등록합니다. 기존 이수일이 있으면 바뀝니다.</p>:null}
   <button className="primary">{busy?'등록 중…':confirm?'이수 등록 확인':'이수 등록'}</button>{confirm?<button type="button" className="secondary" onClick={()=>setConfirm(false)}>돌아가기</button>:null}
  </fieldset></form>:<p>이수일 등록은 교육·전도 담당자에게 요청해 주세요.</p>}
 </Modal>;
}
function Management(){
 const [query,setQuery]=useState(''),[search,setSearch]=useState(''),[dept,setDept]=useState(''),[picked,setPicked]=useState<EducationPerson|null>(null),[limit,setLimit]=useState(30);
 useEffect(()=>{const timer=setTimeout(()=>setSearch(query.trim()),250);return()=>clearTimeout(timer);},[query]);
 const settling=query.trim()!==search;
 const roster=useQuery<{rows:EducationPerson[]}>('getRoster',{indexOnly:true,query:search,dept},!!search&&!settling),log=useQuery<{rows:EducationLog[]}>('getRequiredEducationLog');
 const rows=roster.data?.rows||[];
 return <><div className="page-title"><div><p className="eyebrow">교육 운영</p><h1>필수교육 이수 관리</h1><p className="muted">교사별 이수일을 등록하고 최근 등록 이력을 확인해요.</p></div></div>
  <section className="panel"><div className="edu-row"><label>부서<select value={dept} onChange={e=>setDept(e.target.value)}><option value="">전체</option>{ORG_DEPTS.map(d=><option key={d}>{d}</option>)}</select></label><label>이름 또는 고유번호<input type="search" maxLength={120} value={query} onChange={e=>setQuery(e.target.value)}/></label></div>
   <ErrorNote message={roster.error} retry={roster.reload}/>{roster.loading||settling?<Loading/>:<><p className="help">검색 결과에서 최대 8명을 보여줘요.</p>{rows.map(person=><button className="roster-result" key={person.memberId} onClick={()=>setPicked(person)}><strong>{person.name}</strong><span>{person.dept} · {person.region}</span></button>)}{query.trim()&&!rows.length&&!roster.error?<p>검색 결과가 없어요.</p>:null}</>}
  </section><section className="panel"><div className="section-heading"><h2>최근 등록 이력 300건</h2><button className="secondary" onClick={log.reload}>새로고침</button></div><ErrorNote message={log.error} retry={log.reload}/>{log.loading?<Loading/>:log.data?<><div className="table-scroll"><table><thead><tr>{['등록일시','교사명','항목','이수일','등록자','구분'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{log.data.rows.slice(0,limit).map((row,i)=><tr key={i}><td>{row.at}</td><td>{row.name}</td><td>{row.category}</td><td>{row.kind==='취소'?'-':row.date}</td><td>{row.registrar||'미기재'}</td><td>{row.kind||'등록'}</td></tr>)}</tbody></table></div>{!log.data.rows.length?<p>아직 등록 이력이 없어요.</p>:null}{log.data.rows.length>limit?<button className="secondary" onClick={()=>setLimit(n=>n+30)}>이력 더 보기</button>:null}</>:null}</section>
  {picked?<CompletionForm key={picked.memberId} person={picked} onClose={()=>setPicked(null)} onSaved={log.reload}/>:null}
 </>;
}
export default function RequiredEducationAdmin(){const {access}=useMember();return access.isAdmin?<Management/>:<section className="panel"><h1>필수교육 이수 관리</h1><p>교육·전도 담당자만 등록할 수 있어요. 이수 현황은 교사 명단에서 확인할 수 있어요.</p></section>;}
