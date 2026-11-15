'use client';
import {useState} from 'react';
import type {PercentChartData} from '../../lib/status-charts';

export default function PercentChart({data,title,stacked=false}:{data:PercentChartData;title:string;stacked?:boolean}){
 const [hidden,setHidden]=useState<Set<string>>(()=>new Set());
 const visible=data.datasets.filter(series=>!hidden.has(series.label));
 if(!data.labels.length||!data.datasets.length)return <p className="empty">표시할 기록이 없어요.</p>;
 return <figure className="percent-chart"><figcaption>{title}</figcaption>
  <div className="chart-legend" aria-label={`${title} 표시 항목`}>{data.datasets.map(series=><button type="button" className="secondary" key={series.label} aria-pressed={!hidden.has(series.label)} onClick={()=>setHidden(previous=>{const next=new Set(previous);if(next.has(series.label))next.delete(series.label);else next.add(series.label);return next;})}><i aria-hidden="true" style={{backgroundColor:series.backgroundColor}}/>{series.label}</button>)}</div>
  <p className="help">항목을 누르면 그래프에서 숨기거나 다시 표시해요. 비율은 지역 전체 기준이며 반올림 때문에 합이 100%와 다를 수 있어요.</p>
  <div className="percent-axis" aria-hidden="true"><span>0%</span><span>50%</span><span>100%</span></div>
  {!visible.length?<p className="empty">표시할 항목을 선택해 주세요.</p>:data.labels.map((label,index)=><div className="percent-region" key={`${index}-${label}`}><strong>{label}</strong><div className={stacked?'percent-stack':'percent-group'} role="img" aria-label={`${label}: ${visible.map(series=>`${series.label} ${series.data[index]}%`).join(', ')}`}>
   {visible.map(series=>{const value=series.data[index],description=`${label} · ${series.label} ${value}%`;return stacked?<span className="percent-segment" key={series.label} title={description} style={{width:`${value}%`,backgroundColor:series.backgroundColor}}>{value>=12?`${value}%`:''}</span>:<div className="percent-bar" key={series.label} title={description}><span style={{width:`${value}%`,backgroundColor:series.backgroundColor}}/><small>{series.label} {value}%</small></div>;})}
  </div></div>)}
 </figure>;
}
