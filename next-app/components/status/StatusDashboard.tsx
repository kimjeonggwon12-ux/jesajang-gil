'use client';
import Link from 'next/link';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {ORG_DEPTS} from '../../lib/directory';
import type {DistrictReport,OrgSummary,Participation,Settlement,Summary} from '../../lib/status';
import RegionOverview from './RegionOverview';
import {maskName,monthlyMvp,percent} from '../../lib/status-extra';
import ParticipationChart from './ParticipationChart';
import StatusRankings from './StatusRankings';
import ActivityDistribution from './ActivityDistribution';
import {useQuery} from '../../lib/use-query';
import {Counts,ErrorNote,Loading,Pager} from '../Ui';
import MonthlyAnalysis from './MonthlyAnalysis';
import StatusDetail,{DETAIL_LABELS,type DetailKind} from './StatusDetail';

function SummaryCard({summary,title}:{summary:Summary;title:string}){return <section className="panel"><h2>{title}</h2><Counts values={{'교사 수':summary.totalTeachers,...summary.tierCounts,'활동자':summary.activeCount,'이번 달 활동':summary.monthlyActivityCount,'승급 대상':summary.promotionCount}}/></section>;}
const deptIcon:Record<string,string>={'교역자':'⛪','자문회':'🧭','장년회':'👨‍👩‍👧','부녀회':'👩','청년회':'🧑‍🎓','기타':'📁'};
function DeferredStatus({children}:{children:ReactNode}){const ref=useRef<HTMLDivElement>(null),[show,setShow]=useState(false);useEffect(()=>{const node=ref.current;if(!node)return;const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setShow(true);observer.disconnect();}},{rootMargin:'300px'});observer.observe(node);return()=>observer.disconnect();},[]);return <div ref={ref} style={{minHeight:show?0:180}}>{show?children:<p className="help">활동 기록 항목별 현황</p>}</div>;}
function Overall({onDept}:{onDept:(dept:string)=>void}) {
 const org=useQuery<OrgSummary>('getOrgSummary'),settlement=useQuery<Settlement>('getSettlementReport',{summary:true}),part=useQuery<Participation>('getNonParticipants',{summary:true});
 const [detail,setDetail]=useState<DetailKind|null>(null),[rankings,setRankings]=useState(false);
 const rows=part.data?.depts.filter(r=>r.total>0)||[],sum=(key:'total'|'inactive'|'noEdu'|'both')=>rows.reduce((n,r)=>n+r[key],0);
 const labels:Record<string,[string,string,string]>={noActivity:['😴','미활동 교사','이번 달 활동 기록 0건'],noEducation:['📚','교육 불참 교사','이번 달 교육 출석 0번'],both:['⚠️','활동·교육 모두 0회','활동도 교육도 0회']};
 return <><ErrorNote message={org.error} retry={org.reload}/>{org.loading?<Loading/>:null}{org.data?<ParticipationChart report={org.data}/>:null}
  <section className="classic-status-card"><header><i>😴</i><div><h2>미활동 · 교육 불참 교사</h2><small>{part.data?.from} ~ {org.data?.asOf} · 이번 달 참여 1회 미만</small></div></header><ErrorNote message={part.error} retry={part.reload}/>{part.loading?<Loading/>:part.data?<><div className="classic-status-metrics">{([['noActivity',sum('inactive')],['noEducation',sum('noEdu')],['both',sum('both')]] as [DetailKind,number][]).map(([key,value])=><button key={key} onClick={()=>setDetail(key)}><i>{labels[key][0]}</i><strong>{value.toLocaleString()}<small>명</small></strong><b>{labels[key][1]}</b><small>{labels[key][2]}</small></button>)}</div><p className="help">총 교사 {sum('total').toLocaleString()}명 기준 · 교육 = QR 출석 모임 (이번 달 {part.data.meetings.length}번: {part.data.meetings.map(m=>m.title).join(', ')})</p><div className="table-wrap"><table className="data-table"><thead><tr><th>부서</th><th>총 교사</th><th>😴 미활동</th><th>📚 교육 불참</th><th>모두 0회</th></tr></thead><tbody>{[...rows,{dept:'합계',total:sum('total'),inactive:sum('inactive'),noEdu:sum('noEdu'),both:sum('both')}].map(r=><tr key={r.dept}><th>{r.dept}</th><td>{r.total.toLocaleString()}</td><td>{r.inactive.toLocaleString()} <small>{percent(r.inactive,r.total)}%</small></td><td>{r.noEdu.toLocaleString()} <small>{percent(r.noEdu,r.total)}%</small></td><td>{r.both.toLocaleString()}</td></tr>)}</tbody></table></div><p className="classic-status-guide">▲ 박스를 누르면 명단이 나와요 (엑셀로도 받을 수 있어요)</p></>:null}</section>
  <section className="classic-status-card"><header><i>📅</i><div><h2>이번 달 결산 현황</h2><small>{settlement.data?.month} 결산 기준 (기준일 {settlement.data?.asOf}) · 매월 말일 기준으로 자동 계산</small></div></header><ErrorNote message={settlement.error} retry={settlement.reload}/>{settlement.loading?<Loading/>:settlement.data?<><div className="classic-status-metrics settlement">{([['promotions',settlement.data.promotionsTotal,'⬆️'],['demotions',settlement.data.demotionsTotal,'⬇️'],['pendingApprovals',settlement.data.pendingApprovalCount,''],['inactive',settlement.data.inactiveTotal,'😴'],['leaders',settlement.data.centerLeadTotal||0,'']] as [DetailKind,number,string][]).map(([key,value,icon])=><button key={key} onClick={()=>setDetail(key)}>{icon?<i>{icon}</i>:null}<strong>{value.toLocaleString()}</strong><b>{DETAIL_LABELS[key]}</b></button>)}</div><p className="classic-status-guide">▲ 박스를 눌러 상세 내용을 확인하세요</p></>:null}</section>
  <DeferredStatus><ActivityDistribution/></DeferredStatus>
  {org.data?<><p className="help">{org.data.month} 기준 · 교역자/자문회/장년회/부녀회/청년회/기타 6개 조직 · 카드 클릭 시 그 부서 상세로 이동</p><div className="summary-grid classic-org-grid">{org.data.orgs.map(row=><button className="org-card" key={row.dept} onClick={()=>onDept(row.dept)}><h2>{deptIcon[row.dept]} {row.dept}</h2><dl>{[['총 교사 수',row.totalTeachers],...['휴교사','활동교사','정교사','우수교사'].map(t=>[t,row.tierCounts[t]||0])].map(([label,count])=><div key={String(label)}><dt>{label}</dt><dd>{count}명 {label!=='총 교사 수'?<small>({percent(Number(count),row.totalTeachers)}%)</small>:null}</dd></div>)}</dl></button>)}</div></>:null}
  <details className="classic-status-extra"><summary>활동 우수 지역</summary><button className="secondary" onClick={()=>setRankings(true)}>순위 조회</button>{rankings?<StatusRankings/>:null}</details>
  {detail?<StatusDetail key={detail} kind={detail} onClose={()=>setDetail(null)}/>:null}
 </>;
}
function Department({dept}:{dept:string}) {
 const report=useQuery<DistrictReport>('getDistrictReport',{dept}),[region,setRegion]=useState(''),[page,setPage]=useState(1),[analysis,setAnalysis]=useState(false);
 const mvp=monthlyMvp(report.data?.rows||[]);
 const rows=(report.data?.rows||[]).filter(row=>!region||row.region===region),pages=Math.max(1,Math.ceil(rows.length/50)),safePage=Math.min(page,pages);
 return <><ErrorNote message={report.error} retry={report.reload}/>{report.loading?<Loading/>:report.data?<>
  {mvp?<section className="panel mvp"><h2>이번 달 MVP</h2><p>{mvp.region||'지역 없음'} · {maskName(mvp.name)} 교사</p><strong>이번 달 활동 {mvp.monthlyCount.toLocaleString()}건</strong><p className="help">{dept} 전체 기준이며 지역 선택과 관계없이 표시합니다.</p></section>:null}
  <p className="muted">{report.data.month} 기준 · {dept} 전체 집계. 지역을 골라도 부서 전체 요약은 유지합니다.</p><SummaryCard title={`${dept} 전체 요약`} summary={report.data.summary}/>
  <RegionOverview dept={dept} rows={report.data.byRegion} onRegion={value=>{setRegion(value);setPage(1);}}/>
  <section className="panel"><h2>역할별 활동</h2><Counts values={report.data.roleActivityCounts}/><h2>대상자 단계</h2><Counts values={report.data.targetStageCounts}/></section>
  <section className="panel"><div className="section-heading"><h2>소속 교사</h2><Link className="secondary" href={'/members?'+new URLSearchParams({dept,region})}>명단에서 보기</Link></div><label htmlFor="status-region">지역 선택</label><select id="status-region" value={region} onChange={e=>{setRegion(e.target.value);setPage(1);}}><option value="">전체 지역</option>{report.data.regions.map(r=><option key={r}>{r}</option>)}</select><Pager page={safePage} pages={pages} total={rows.length} onPage={setPage}/><div className="table-wrap"><table className="data-table"><thead><tr><th>이름</th><th>지역</th><th>교사 구분</th><th>이번 달 활동</th><th>마지막 활동</th><th>등급 제안·조건</th></tr></thead><tbody>{rows.slice((safePage-1)*50,safePage*50).map(row=><tr key={row.memberId}><th scope="row">{row.name}</th><td>{row.region||'-'}</td><td>{row.tier}</td><td>{row.monthlyCount}</td><td>{row.lastActivityDate||'-'}</td><td>{row.suggestion?.reason||row.conditionText}</td></tr>)}</tbody></table>{!rows.length?<p className="empty">해당 지역의 교사가 없어요.</p>:null}</div><Pager page={safePage} pages={pages} total={rows.length} onPage={setPage}/></section>
  <button className="secondary" aria-expanded={analysis} onClick={()=>setAnalysis(v=>!v)}>{analysis?'월별 분석 닫기':'월별 활동 분석 보기'}</button>{analysis?<MonthlyAnalysis dept={dept} month={report.data.month}/>:null}
 </>:null}</>;
}
export default function StatusDashboard(){const [dept,setDept]=useState('');return <><div className="page-title"><div><p className="eyebrow">활동 현황</p><h1>전체·지역 현황</h1><p className="muted">같은 지역 이름도 부서별로 구분해서 확인해요.</p></div></div><nav className="classic-status-depts" aria-label="현황 부서">{['',...ORG_DEPTS].map(d=><button key={d} className="secondary" aria-pressed={dept===d} onClick={()=>setDept(d)}>{d?deptIcon[d]+' '+d:'▤ 전체 요약'}</button>)}</nav>{dept?<Department key={dept} dept={dept}/>:<Overall onDept={setDept}/>}</>;}
