'use client';
import DistrictCoaching from '../coaching/DistrictCoaching';
import {useMemo,useState} from 'react';
import {activityAnalysis,roleBreakdown,orderedRegions,ROLES,type DistrictReport} from '../../lib/status';
import {activityChart,displayedRoleTotal,regionLabel,roleItems,sampleRoleBreakdown,strongItems,wholePercent} from '../../lib/status-charts';
import {useQuery} from '../../lib/use-query';
import {ErrorNote,Loading} from '../Ui';
import PercentChart from './PercentChart';

export default function MonthlyAnalysis({dept,month}:{dept:string;month:string}) {
 const [selected,setSelected]=useState(month),[role,setRole]=useState('인도자'),[view,setView]=useState('table'),[sample,setSample]=useState(false);
 const result=useQuery<DistrictReport>('getDistrictReport',{dept,analysis:true,analysisMonth:selected},/^\d{4}-(0[1-9]|1[0-2])$/.test(selected));
 const analysis=useMemo(()=>result.data?activityAnalysis(result.data):null,[result.data]);
 const roles=useMemo(()=>sample?sampleRoleBreakdown():result.data?roleBreakdown({...result.data,byRegion:orderedRegions(result.data.byRegion)}):null,[result.data,sample]);
 const items=roleItems(role),strong=useMemo(()=>roles?strongItems(roles):[],[roles]);
 return <section className="panel"><div className="section-heading"><h2>월별 활동 분석</h2><label className="inline-label">조회 월<input aria-label="분석 조회 월" type="month" value={selected} onChange={e=>{setSelected(e.target.value);setSample(false);}}/></label><button className="secondary" onClick={()=>setView(v=>v==='table'?'chart':'table')}>{view==='table'?'활동 분석 그래프로 보기':'활동 분석 표로 보기'}</button></div><ErrorNote message={result.error} retry={result.reload}/>{result.loading?<Loading/>:null}
  {analysis?view==='chart'?<PercentChart key={selected} data={activityChart(dept,analysis)} stacked title={`${selected} 지역별 활동 유형 비중`}/>:!analysis.regionStats.length||!analysis.types.length?<p className="empty">선택한 달의 활동 기록이 없어요.</p>:<div className="table-wrap"><table className="data-table"><caption>{selected} 지역별 활동 항목 비중</caption><thead><tr><th>지역</th><th>활동 항목 합계</th>{analysis.types.map(type=><th key={type}>{type}</th>)}<th>평가</th></tr></thead><tbody>{analysis.regionStats.map(row=><tr key={row.region}><th scope="row">{row.region||'(미상)'}</th><td>{row.total}</td>{analysis.types.map(type=><td key={type}>{row.counts[type]||0}건 <small>({wholePercent(row.counts[type]||0,row.total)}%)</small></td>)}<td>{row.grade}</td></tr>)}</tbody></table></div>:null}
  {roles?<><div className="section-heading"><h3>지역·역할별 활동{sample?' · 샘플':''}</h3>{selected===month?<button className="secondary" aria-pressed={sample} onClick={()=>setSample(value=>!value)}>{sample?'실제 활동 자료로 보기':'샘플 활동 자료로 보기'}</button>:null}</div>
   {sample?<p className="notice" role="status">샘플 보기: 아래 역할별 활동·강세 항목·AI 분석만 고정된 12지역 예시입니다. 위의 교사 현황과 활동 유형 비중은 실제 조회 자료입니다.</p>:null}
   <label htmlFor="analysis-role">역할</label><select id="analysis-role" value={role} onChange={e=>setRole(e.target.value)}>{ROLES.map(r=><option key={r}>{r}</option>)}</select><div className="table-wrap"><table className="data-table"><caption>{sample?'샘플':selected} {role} 활동 항목</caption><thead><tr><th>지역</th><th>합계</th>{items.map(item=><th key={item}>{item}</th>)}</tr></thead><tbody>{roles.allRegions.map(region=><tr key={region}><th scope="row">{regionLabel(dept,region)}</th><td>{displayedRoleTotal(roles,region,role)}</td>{items.map(item=><td key={item}>{roles.counts[region]?.[role]?.[item]||'-'}</td>)}</tr>)}</tbody></table>{roles.allRegions.every(region=>displayedRoleTotal(roles,region,role)===0)?<p className="empty">선택한 달의 {role} 활동 기록이 없어요.</p>:null}</div><p className="muted">역할이 기록된 활동 중 해당 역할의 표시 항목을 합산합니다. 여러 역할·항목이 있는 기록은 각각 집계합니다.</p>
   <h3>지역별 강세 항목{sample?' · 샘플':''}</h3><div className="table-wrap"><table className="data-table"><caption>{sample?'샘플':selected} 지역별 활동 상위 항목</caption><thead><tr><th>지역</th><th>강세 항목</th><th>건수</th><th>이어서 많은 항목</th></tr></thead><tbody>{strong.map(row=><tr key={row.region}><th scope="row">{regionLabel(dept,row.region)}</th><td>{row.items[0]?.item||'-'}</td><td>{row.items[0]?`${row.items[0].count}건`:'-'}</td><td>{row.items.slice(1).map(item=>`${item.item} ${item.count}건`).join(' · ')||'-'}</td></tr>)}</tbody></table></div>
  </>:null}
  {roles&&selected===month?<DistrictCoaching key={`${dept}:${selected}:${sample}`} dept={dept} breakdown={roles} sample={sample}/>:null}
 </section>;
}
