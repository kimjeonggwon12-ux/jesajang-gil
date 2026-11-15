'use client';
import {useState} from 'react';
import {ASPECTS,TOP_DEPTS,type TopRegions} from '../../lib/status-extra';
import {useQuery} from '../../lib/use-query';
import {ErrorNote,Loading} from '../Ui';
function RankTable({data,all=false}:{data:TopRegions;all?:boolean}) {
 return <>{data.isSample?<p className="notice">기록이 없는 항목에 예시 순위가 포함되어 있습니다. 실제 실적으로 사용하지 마세요.</p>:null}<div className="table-wrap"><table className="data-table"><thead><tr><th>활동</th><th>1위</th><th>2위</th><th>3위</th></tr></thead><tbody>{ASPECTS.map(aspect=><tr key={aspect}><th>{aspect==='센터인도'?'센터 인도':aspect}</th>{[0,1,2].map(index=>{const row=data.byAspect[aspect]?.[index];return <td key={index}>{row?<>{all?`${row.dept} · `:''}{row.region} <strong>{row.count.toLocaleString()}건</strong></>:'-'}</td>;})}</tr>)}</tbody></table></div></>;
}
export default function StatusRankings(){
 const [dept,setDept]=useState(TOP_DEPTS[0]),church=useQuery<TopRegions>('getChurchTopRegions'),department=useQuery<TopRegions>('getTopRegions',{dept});
 return <section className="panel"><h2>이번 달 활동 우수 지역</h2><p>4가지 역할의 활동을 합산합니다. 같은 지역 이름도 전체 순위에서는 부서와 함께 구분해 표시합니다.</p><h3>전체 부서</h3><ErrorNote message={church.error} retry={church.reload}/>{church.loading?<Loading/>:church.data?<><RankTable data={church.data} all/><h3>역할별 지역명 합산</h3><p className="help">기존 역할별 집계는 여러 부서의 같은 지역 이름을 합칩니다. 아래 기여 부서는 그중 가장 많이 기여한 부서입니다. 부서별 지역 순위와는 집계 범위가 다릅니다.</p><div className="table-wrap"><table className="data-table"><thead><tr><th>역할</th><th>지역명</th><th>최대 기여 부서</th><th>활동</th><th>강세 항목</th></tr></thead><tbody>{church.data.byRole?.map(row=><tr key={row.role}><th>{row.role}</th><td>{row.topRegion}</td><td>{row.topDept}</td><td>{row.totalCount}건 {row.isSample?<span className="badge">예시</span>:null}</td><td>{row.topItem}</td></tr>)}</tbody></table></div></>:null}
  <h3>부서별 순위</h3><label htmlFor="ranking-dept">순위 조회 부서</label><select id="ranking-dept" value={dept} onChange={event=>setDept(event.target.value)}>{TOP_DEPTS.map(value=><option key={value}>{value}</option>)}</select><ErrorNote message={department.error} retry={department.reload}/>{department.loading?<Loading/>:department.data?<RankTable data={department.data}/>:null}
 </section>;
}
