'use client';
import Link from 'next/link';
import {useSearchParams} from 'next/navigation';
import {useState,type FormEvent} from 'react';
import {displayId,logDifference,type RosterLog,type RosterPerson} from '../../lib/roster-admin';
import {useQuery} from '../../lib/use-query';
import {useMember} from '../MemberArea';
import {ErrorNote,Loading} from '../Ui';
import RosterEditor from './RosterEditor';
import PinRecovery from './PinRecovery';
import RosterImport from './RosterImport';
import RosterDataTools from './RosterDataTools';

function ChangeLog(){
 const result=useQuery<{rows:RosterLog[]}>('getRosterLog');
 return <section className="panel"><div className="section-heading"><h2>최근 변경 기록 100건</h2><button className="secondary" onClick={result.reload}>다시 불러오기</button></div><ErrorNote message={result.error} retry={result.reload}/>{result.loading?<Loading/>:null}
  {result.data?.rows.map((row,index)=><article className="change-log" key={index}><h3>{row.kind} · {row.targetName}</h3><p>{logDifference(row)||'변경 내역 없음'}</p><small>{row.at} · {row.actor} {displayId(row.targetId)}</small></article>)}{result.data&&!result.data.rows.length?<p>아직 변경 기록이 없어요.</p>:null}
 </section>;
}
function SearchRoster(){
 const [draft,setDraft]=useState(''),[query,setQuery]=useState(''),[editing,setEditing]=useState<RosterPerson|null|undefined>(),[message,setMessage]=useState('');
 const result=useQuery<{rows:RosterPerson[];hint?:string}>('searchRoster',{query},query.length>=2);
 function search(event:FormEvent){event.preventDefault();const next=draft.trim();setMessage('');if(next===query)result.reload();else setQuery(next);}
 return <><section className="panel"><h2>명단에서 찾기</h2><form onSubmit={search}><label htmlFor="roster-search">이름 또는 고유번호</label><div className="search-form"><input id="roster-search" minLength={2} maxLength={40} autoComplete="off" required value={draft} onChange={e=>setDraft(e.target.value)}/><button className="primary">찾기</button></div></form><div className="toolbar"><button className="secondary" onClick={()=>setEditing(null)}>교사 추가</button><Link href="/members">교사 명단·등급 변경·엑셀</Link></div><p className="muted">이름이나 번호 두 글자 이상으로 찾습니다. 교사·관리자 명단에서 각각 최대 30명까지 검색합니다.</p></section>
  {message?<p className="notice" role="status">{message}</p>:null}<ErrorNote message={result.error} retry={result.reload}/>{result.loading?<Loading/>:null}
  {result.data?.hint?<p>{result.data.hint}</p>:null}<div className="roster-results">{result.data?.rows.map(person=><button className="roster-result" key={person.memberId} onClick={()=>setEditing(person)}><strong>{person.name}</strong><span>{[person.dept,person.region,person.affiliation,displayId(person.memberId)].filter(Boolean).join(' · ')}</span><small>{person.inRoster?person.tier:'교사명단에 없음'}{person.admin?` · 관리자 ${person.admins?.length||1}개 보직: ${(person.admins||[person.admin]).map(a=>[a.dept,a.region,a.position].filter(Boolean).join(' ')).join(' / ')}`:''}</small></button>)}</div>
  {result.data&&!result.data.hint&&!result.data.rows.length?<p className="empty">찾는 사람이 없어요. 이름이나 번호를 다시 확인해 주세요.</p>:null}
  {editing!==undefined?<RosterEditor key={editing?.memberId||'new'} person={editing} onClose={()=>setEditing(undefined)} onReload={()=>{setEditing(undefined);result.reload();}} onSaved={(message,name)=>{setEditing(undefined);setMessage(message);if(!query){setDraft(name);setQuery(name);}else result.reload();}}/>:null}
 </>;
}
export default function RosterAdmin(){
 const {access}=useMember(),params=useSearchParams(),[selected,setSelected]=useState<string|null>(null);
 const tab=selected||(params.get('tab')==='data'?'data':'search'),setTab=setSelected;
 if(!access.permissions.canManageRoster)return <section className="panel"><h1>명단 관리</h1><p>교육·전도 담당자만 사용할 수 있어요.</p><Link href="/members">교사 명단으로</Link></section>;
 return <><div className="page-title"><div><p className="eyebrow">업무 관리</p><h1>명단 관리</h1><p className="muted">교사 정보와 관리자 지정, 계정 복구를 관리해요.</p></div></div><nav className="tabs" aria-label="명단 관리 메뉴">{[['search','명단 찾기'],['log','변경 기록'],['pin','PIN 복구'],['import','엑셀 가져오기'],['data','다운로드·백업']].map(([key,label])=><button key={key} className="secondary" aria-pressed={tab===key} onClick={()=>setTab(key)}>{label}</button>)}</nav>{tab==='search'?<SearchRoster/>:tab==='log'?<ChangeLog/>:tab==='pin'?<PinRecovery/>:tab==='import'?<RosterImport/>:<RosterDataTools/>}</>;
}
