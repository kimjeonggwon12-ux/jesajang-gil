'use client';
import {useState} from 'react';
import type {SettlementPerson} from '../../lib/status';
import {leadMonths,monthlyLeaders,type CenterLead} from '../../lib/status-extra';
import {useQuery} from '../../lib/use-query';
import {displayId} from '../../lib/roster-admin';
import {ErrorNote,Loading,Pager} from '../Ui';
export default function CenterLeadReport({recent}:{recent:SettlementPerson[]}) {
 const [monthly,setMonthly]=useState(false),[month,setMonth]=useState(''),[page,setPage]=useState(1);
 const records=useQuery<{rows:CenterLead[]}>('getAllCenterLeads',{},monthly),months=leadMonths(records.data?.rows||[]),chosen=month||months[0]||'',summary=monthlyLeaders(records.data?.rows||[],chosen);
 const rows=monthly?summary.people.map(row=>({...row,leadCount:row.count,region:'',tier:''})):recent,pages=Math.max(1,Math.ceil(rows.length/50)),current=Math.min(page,pages);
 return <><label className="check-label"><input type="checkbox" checked={monthly} onChange={event=>{setMonthly(event.target.checked);setPage(1);}}/>월별 기록 조회</label><p className="muted">활동방의 센터 인도 등록 기록입니다. 최근 6개월 순위와 월별 기록은 조회 기간이 다릅니다.</p>{monthly?<><label htmlFor="lead-month">센터 인도 조회 월</label><select id="lead-month" value={chosen} onChange={event=>{setMonth(event.target.value);setPage(1);}} disabled={records.loading||!months.length}>{!months.length?<option value="">기록 없음</option>:months.map(value=><option key={value}>{value}</option>)}</select><ErrorNote message={records.error} retry={records.reload}/>{records.loading?<Loading/>:records.data?<p>{chosen||'선택한 달'} 총 {summary.total.toLocaleString()}건 · 인도자 {summary.people.length.toLocaleString()}명</p>:null}</>:null}
  {!monthly||records.data?<><Pager page={current} pages={pages} total={rows.length} onPage={setPage}/><div className="table-wrap"><table className="data-table"><caption>{monthly?chosen:'최근 6개월'} 센터 인도 순위</caption><thead><tr><th>순위</th><th>이름</th>{!monthly?<><th>지역</th><th>등급</th></>:null}<th>인도 실적</th></tr></thead><tbody>{rows.slice((current-1)*50,current*50).map((row,index)=><tr key={row.memberId+'-'+index}><td>{(current-1)*50+index+1}</td><th>{row.name||'이름 미등록'}{displayId(row.memberId)?<small className="muted">{displayId(row.memberId)}</small>:null}</th>{!monthly?<><td>{row.region||'-'}</td><td>{row.tier||'-'}</td></>:null}<td>{row.leadCount}명</td></tr>)}</tbody></table>{!rows.length?<p className="empty">이 기간에는 센터 인도 기록이 없어요.</p>:null}</div></>:null}
 </>;
}
