'use client';
import {useMemo,useState} from 'react';
import {orderedRegions,ROLES,type RegionSummary} from '../../lib/status';
import {regionLabel,tierChart,TIER_ORDER,wholePercent} from '../../lib/status-charts';
import PercentChart from './PercentChart';

export default function RegionOverview({dept,rows,onRegion}:{dept:string;rows:RegionSummary[];onRegion:(region:string)=>void}){
 const [chart,setChart]=useState(false),ordered=useMemo(()=>orderedRegions(rows),[rows]);
 return <section className="panel"><div className="section-heading"><h2>지역별 교사·활동 현황</h2><button className="secondary" onClick={()=>setChart(value=>!value)}>{chart?'지역 현황 표로 보기':'지역 현황 그래프로 보기'}</button></div>
  {chart?<PercentChart data={tierChart(dept,ordered)} title="지역별 교사 구분 비율"/>:<div className="table-wrap"><table className="data-table"><caption>{dept} 전체 지역 현황</caption><thead><tr><th>지역</th><th>교사 수</th>{TIER_ORDER.map(tier=><th key={tier}>{tier}</th>)}<th>활동자</th><th>이번 달 활동</th><th>승급 대상</th>{ROLES.map(role=><th key={role}>{role}</th>)}</tr></thead><tbody>{ordered.map(row=><tr key={row.region}><th scope="row"><button className="row-link" onClick={()=>onRegion(row.region)}>{regionLabel(dept,row.region)}</button></th><td>{row.totalTeachers}명</td>{TIER_ORDER.map(tier=><td key={tier}>{row.tierCounts[tier]||0}명 <small>({wholePercent(row.tierCounts[tier]||0,row.totalTeachers)}%)</small></td>)}<td>{row.activeCount}명</td><td>{row.monthlyActivityCount}건</td><td>{row.promotionCount}명</td>{ROLES.map(role=><td key={role}>{row.roleActivityCounts[role]||0}</td>)}</tr>)}</tbody></table>{!ordered.length?<p className="empty">해당 부서의 지역 기록이 없어요.</p>:null}</div>}
 </section>;
}
