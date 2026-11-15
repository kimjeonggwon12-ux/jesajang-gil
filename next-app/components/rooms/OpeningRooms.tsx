'use client';
import type {Dispatch,SetStateAction} from 'react';
import {ErrorNote,Loading,Pager} from '../Ui';
import {filterOpeningRooms,ROOM_DEPTS,ROOM_STAGES,roomDept,roomRegion,roomRegionNo,type OpeningRoom,type OpeningFilter} from '../../lib/rooms';
type Result={data:{rows:OpeningRoom[]}|null;error:string;loading:boolean;reload:()=>void};
export type OpeningView={filter:OpeningFilter;page:number};
export default function OpeningRooms({result,navigate,view,setView}:{result:Result;navigate:(id:string)=>void;view:OpeningView;setView:Dispatch<SetStateAction<OpeningView>>}){
  const {filter,page}=view;
  const setPage=(page:number)=>setView(old=>({...old,page}));
  const rows=result.data?.rows||[],filtered=filterOpeningRooms(rows,filter),pages=Math.max(1,Math.ceil(filtered.length/30)),current=Math.min(page,pages);
  function change(value:Partial<OpeningFilter>){setView(old=>({filter:{...old.filter,...value},page:1}));}
  function toggle(key:'regions'|'stages',value:string){change({[key]:filter[key].includes(value)?filter[key].filter(v=>v!==value):[...filter[key],value]});}
  const inDept=(row:OpeningRoom)=>filter.dept==='전체'||roomDept(row)===filter.dept;
  const regions=[...new Set(rows.filter(inDept).map(roomRegion))].sort((a,b)=>roomRegionNo(a)-roomRegionNo(b)||a.localeCompare(b));
  return <>
    <p>담당 부서·지역과 직접 담당하거나 초대받은 방을 표시합니다. 전체 명단 조회 권한과는 별개입니다.</p>
    <nav className="tabs" aria-label="개강 피드백 부서">{['전체',...ROOM_DEPTS,'그 밖'].map(dept=><button className="secondary" key={dept} aria-pressed={filter.dept===dept} onClick={()=>change({dept,regions:[]})}>{dept} {rows.filter(row=>dept==='전체'||roomDept(row)===dept).length}</button>)}</nav>
    <div className="filter-grid">
      <details className="panel"><summary>지역 {filter.regions.length?`${filter.regions.length}개 선택`:'전체'}</summary>{regions.map(region=><label className="check-label" key={region}><input type="checkbox" checked={filter.regions.includes(region)} onChange={()=>toggle('regions',region)}/>{/^\d+$/.test(region)?region+'지역':region} ({rows.filter(row=>inDept(row)&&roomRegion(row)===region&&(!filter.stages.length||filter.stages.includes(row.stage))).length})</label>)}<button className="text-button" onClick={()=>change({regions:[]})}>지역 선택 해제</button></details>
      <details className="panel"><summary>단계 {filter.stages.length?`${filter.stages.length}개 선택`:'전체'}</summary>{ROOM_STAGES.map(stage=><label className="check-label" key={stage}><input type="checkbox" checked={filter.stages.includes(stage)} onChange={()=>toggle('stages',stage)}/>{stage} ({rows.filter(row=>inDept(row)&&row.stage===stage&&(!filter.regions.length||filter.regions.includes(roomRegion(row)))).length})</label>)}<button className="text-button" onClick={()=>change({stages:[]})}>단계 선택 해제</button></details>
      <label>이름·교사·지역 검색<input value={filter.query} onChange={e=>change({query:e.target.value})} placeholder="예: 3지역"/></label>
      <label className="check-label"><input type="checkbox" checked={filter.only} onChange={e=>change({only:e.target.checked})}/>방 있는 것만</label>
    </div>
    <ErrorNote message={result.error} retry={result.reload}/>{result.loading?<Loading/>:<><Pager total={filtered.length} page={current} pages={pages} onPage={setPage}/><div className="activity-cards">{filtered.slice((current-1)*30,current*30).map(row=><button className="activity-card" key={row.id} onClick={()=>navigate(row.id)}><strong>{row.name} · {row.stage}</strong><span>{[row.teacher,row.dept,row.region,row.gender,row.ageGroup,row.goalMonth?`${row.goalMonth}월 목표`:''].filter(Boolean).join(' · ')}</span><span>{row.room?`참여 ${row.members}명 · 안 읽은 글 ${row.unread}개`:'새 피드백방 열기'}</span><span>최근 보고 {row.lastReport||'없음'}{row.lastAt?` · 최근 대화 ${row.lastAt}`:''}</span>{row.admins.length?<span>관리자 {row.admins.join(', ')}</span>:null}{row.dup?<small>같은 교사·대상자 {row.dup}건을 합친 항목</small>:null}</button>)}</div>{!filtered.length&&!result.error?<p className="empty">해당하는 대상자가 없어요.</p>:null}</>}
  </>;
}
