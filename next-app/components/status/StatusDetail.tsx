'use client';
import Link from 'next/link';
import {useState} from 'react';
import {ORG_DEPTS} from '../../lib/directory';
import type {Participation,Settlement,SettlementPerson} from '../../lib/status';
import {transition} from '../../lib/status-extra';
import {displayId} from '../../lib/roster-admin';
import {useQuery} from '../../lib/use-query';
import {useMember} from '../MemberArea';
import {ErrorNote,Loading,Modal,Pager} from '../Ui';
import CenterLeadReport from './CenterLeadReport';
import StatusExport from './StatusExport';
export type DetailKind='promotions'|'demotions'|'pendingApprovals'|'inactive'|'leaders'|'noActivity'|'noEducation'|'both';
export const DETAIL_LABELS:Record<DetailKind,string>={promotions:'승급 대상',demotions:'강등 대상',pendingApprovals:'허가 대기',inactive:'비활동자',leaders:'센터 인도',noActivity:'이번 달 활동 0건',noEducation:'이번 달 교육 출석 0회',both:'이번 달 활동·교육 모두 0회'};
export default function StatusDetail({kind,onClose}:{kind:DetailKind;onClose:()=>void}) {
 const {access}=useMember(),nonPart=['noActivity','noEducation','both'].includes(kind),changes=kind==='promotions'||kind==='demotions';
 const [dept,setDept]=useState(''),[query,setQuery]=useState(''),[filter,setFilter]=useState(''),[page,setPage]=useState(1),[exporting,setExporting]=useState(false);
 const result=useQuery<Participation|Settlement>(nonPart?'getNonParticipants':'getSettlementReport',{});
 const source:SettlementPerson[]=nonPart?((result.data as Participation)?.rows||[]).filter(row=>kind==='noActivity'?row.inactive:kind==='noEducation'?row.noEdu:row.inactive&&row.noEdu):((result.data as Settlement)?.[kind as 'promotions'|'demotions'|'pendingApprovals'|'inactive'|'leaders']||[]);
 const rows=source.filter(row=>(!dept||row.dept===dept)&&(!query||[row.name,row.dept,row.region].some(value=>String(value||'').includes(query)))&&(!filter||(changes?transition(row)===filter:row.inactivity===filter)));
 const options=changes?[...new Set(source.map(transition))]:['danger','warning'],pages=Math.max(1,Math.ceil(rows.length/50)),safePage=Math.min(page,pages);
 return <Modal title={DETAIL_LABELS[kind]} onClose={onClose}>
  {kind!=='leaders'?<div className="filter-grid">{kind!=='pendingApprovals'?<div><label htmlFor="detail-dept">부서</label><select id="detail-dept" value={dept} onChange={event=>{setDept(event.target.value);setPage(1);}}><option value="">전체 부서</option>{ORG_DEPTS.map(value=><option key={value}>{value}</option>)}</select></div>:null}<div><label htmlFor="detail-query">이름·지역 검색</label><input id="detail-query" value={query} onChange={event=>{setQuery(event.target.value);setPage(1);}}/></div>{changes||kind==='inactive'?<div><label htmlFor="detail-filter">{changes?'등급 변경 유형':'비활동 단계'}</label><select id="detail-filter" value={filter} onChange={event=>{setFilter(event.target.value);setPage(1);}}><option value="">전체</option>{options.map(value=><option key={value} value={value}>{changes?value:value==='danger'?'경고':'주의'}</option>)}</select></div>:null}</div>:null}
  <ErrorNote message={result.error} retry={result.reload}/>{result.loading?<Loading/>:result.data?<>
   <p className="muted">{result.data.month} 기준 · 서버가 제공한 상세 목록 {source.length.toLocaleString()}명. 요약 카드의 전체 집계와 상세 표시 한도는 다를 수 있습니다.</p>
   {kind==='leaders'?<CenterLeadReport recent={source}/>:<>
    {nonPart&&access.permissions.canExportTeachers?<button className="secondary" onClick={()=>setExporting(true)}>미활동·교육 불참 엑셀 받기</button>:null}
    {kind==='inactive'?<p>주의 {(result.data as Settlement).inactiveWarn}명 · 경고 {(result.data as Settlement).inactiveDanger}명 · 마지막 활동일 기준</p>:null}
    <Pager page={safePage} pages={pages} total={rows.length} onPage={setPage}/><div className="table-wrap"><table className="data-table"><thead><tr><th>이름</th><th>부서·지역</th><th>교사 구분</th>{nonPart?<><th>이번 달 활동</th><th>이번 달 교육</th></>:kind==='pendingApprovals'?<><th>유형·사유</th><th>교관 허가 기록</th><th>지역장 허가 기록</th></>:<><th>{kind==='inactive'?'마지막 활동':'사유'}</th>{kind==='inactive'||kind==='demotions'?<th>비활동 단계</th>:null}{kind==='inactive'?<th>이번 달 활동</th>:null}</>}</tr></thead><tbody>{rows.slice((safePage-1)*50,safePage*50).map((row,index)=><tr key={row.memberId+'-'+index}><th scope="row">{row.name||'이름 미등록'}{!nonPart&&displayId(row.memberId)?<small className="muted">{displayId(row.memberId)}</small>:null}</th><td>{[row.dept,row.region].filter(Boolean).join(' · ')||'-'}</td><td>{row.currentTier||row.tier||'-'}{row.suggestedTier?` → ${row.suggestedTier}`:''}</td>{nonPart?<><td>{row.inactive?'0건':'있음'}</td><td>{row.noEdu?'0번':'있음'}</td></>:kind==='pendingApprovals'?<><td>{row.type==='reason'?`사유자 · ${row.reason||''}`:'자동 감지'}</td><td>{row.coachApprover||'대기'}</td><td>{row.leaderApprover||'대기'}</td></>:<><td>{kind==='inactive'?row.lastActivityDate||'기록 없음':row.reason||'-'}</td>{kind==='inactive'||kind==='demotions'?<td>{row.inactivity==='danger'?'경고':row.inactivity==='warning'?'주의':'-'}</td>:null}{kind==='inactive'?<td>{row.monthlyCount||0}건</td>:null}</>}</tr>)}</tbody></table>{!rows.length?<p className="empty">해당하는 교사가 없어요.</p>:null}</div><Pager page={safePage} pages={pages} total={rows.length} onPage={setPage}/>
    {kind==='pendingApprovals'?<p className="help">기존에 남은 허가 기록입니다. 교관·지역장 단건 승인 기능은 폐지되어 조회만 제공하며, 등급 변경은 전도 담당자가 <Link href="/members">교사 명단</Link>에서 처리합니다.</p>:null}
   </>}
  </>:null}
  {exporting?<StatusExport dept={dept} onClose={()=>setExporting(false)}/>:null}
 </Modal>;
}
