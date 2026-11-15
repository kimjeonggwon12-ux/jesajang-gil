'use client';
import {useEffect,useRef,useState} from 'react';
import type {OrgSummary} from '../../lib/status';
import {participationRows,participationTitle} from '../../lib/status-extra';
import {drawParticipation} from '../../lib/participation-chart';
import {ErrorNote} from '../Ui';
export default function ParticipationChart({report}:{report:OrgSummary}) {
 const canvas=useRef<HTMLCanvasElement>(null),host=useRef<HTMLDivElement>(null),[error,setError]=useState(''),[shareable,setShareable]=useState(false);
 useEffect(()=>{
  setShareable(typeof navigator.canShare==='function');
  const draw=()=>{if(canvas.current&&host.current)drawParticipation(canvas.current,report,host.current.clientWidth);};
  draw();const observer=new ResizeObserver(draw);if(host.current)observer.observe(host.current);return()=>observer.disconnect();
 },[report]);
 const filename=`부서별참여현황_${report.asOf}.png`;
 function save(){setError('');try{if(!canvas.current)return;const link=document.createElement('a');link.download=filename;link.href=canvas.current.toDataURL('image/png');link.click();}catch{setError('이미지를 저장하지 못했어요. 다시 시도해 주세요.');}}
 function share(){setError('');canvas.current?.toBlob(async blob=>{if(!blob){setError('이미지를 만들지 못했어요.');return;}try{const file=new File([blob],filename,{type:'image/png'});if(navigator.canShare?.({files:[file]}))await navigator.share({files:[file],title:participationTitle(report.month)});else save();}catch(error){if((error as Error).name!=='AbortError')setError('공유하지 못했어요. 이미지로 저장해 주세요.');}},'image/png');}
 return <section className="panel classic-participation"><div className="section-heading"><h2>부서별 참여 현황</h2><div className="toolbar"><button className="secondary" onClick={save}>⬇ 이미지 저장</button>{shareable?<button className="secondary" onClick={share}>공유</button>:null}</div></div><div ref={host} className="participation-canvas"><canvas ref={canvas} role="img" aria-label={participationTitle(report.month)}/></div><details><summary>참여 수치 보기</summary><table className="data-table"><thead><tr><th>부서</th><th>참여</th><th>전체</th></tr></thead><tbody>{participationRows(report).map(row=><tr key={row.dept}><th>{row.dept}</th><td>{row.active}</td><td>{row.total}</td></tr>)}</tbody></table></details><p className="muted">교역자·자문회·장년회·부녀회·청년회 기준입니다. 기타 부서는 아래 전체 교사 현황에서 확인할 수 있어요.</p><ErrorNote message={error}/></section>;
}
