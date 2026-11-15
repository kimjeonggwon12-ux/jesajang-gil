'use client';
import {useState} from 'react';
import {ROLES} from '../../lib/status';
import {ITEM_LABELS,type Distribution} from '../../lib/status-extra';
import {useQuery} from '../../lib/use-query';
import {Counts,ErrorNote,Loading} from '../Ui';
export default function ActivityDistribution(){
 const [role,setRole]=useState(''),items=useQuery<Distribution>('getActivityItemDistribution',{role}),stages=useQuery<{gospel:number;centerIntro:number;centerAttend:number}>('getKeyStageCount');
 return <section className="panel"><h2>활동 기록 항목별 현황</h2><ErrorNote message={stages.error} retry={stages.reload}/>{stages.loading?<Loading/>:stages.data?<Counts values={{'복음방 도달':stages.data.gospel,'센터소개 도달':stages.data.centerIntro,'센터수강 확정':stages.data.centerAttend}}/>:null}<nav className="classic-distribution-roles" aria-label="활동 역할">{['',...ROLES].map(value=><button key={value} aria-pressed={role===value} onClick={()=>setRole(value)}>{value||'전체'}</button>)}</nav><ErrorNote message={items.error} retry={items.reload}/>{items.loading?<Loading/>:items.data?<><p>{items.data.year}년 · {role||'인도·교사·섬김'} 활동 항목 합계 {items.data.total.toLocaleString()}건</p><div className="bar-chart">{items.data.stages.map(row=><div className="bar-row" key={row.stage}><span>{ITEM_LABELS[row.stage]||row.stage}</span><meter min="0" max={Math.max(1,...items.data!.stages.map(item=>item.count))} value={row.count}>{row.count}</meter><strong>{row.count.toLocaleString()}건</strong></div>)}</div></>:null}</section>;
}
