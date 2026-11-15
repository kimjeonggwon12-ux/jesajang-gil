'use client';
import Link from 'next/link';
import {useState} from 'react';
import {useQuery} from '../../lib/use-query';
import {ErrorNote,Loading} from '../Ui';
import {FeedbackPager} from './CoachRequests';

type HistoryRow={receiptNo:string;source:string;situation:string;aiCoachText:string;handlerAnswer:string;status:string;submittedAt:string};

// 구형 독립 피드백방의 본인 전체 이력이다. 현재 상담의 교관 요청 목록과 범위가 다르다.
export default function FeedbackHistory(){
 const result=useQuery<{rows:HistoryRow[]}>('getHistory'),[page,setPage]=useState(1);
 const rows=result.data?.rows||[],current=Math.min(page,Math.max(1,Math.ceil(rows.length/20)));
 // 서버의 등록 순서(id 오름차순)를 뒤집던 원본 계약을 유지한다. 날짜로 다시 정렬하지 않는다.
 const end=rows.length-(current-1)*20,visible=rows.slice(Math.max(0,end-20),end).reverse();
 return <>
  <div className="page-title"><h1>내 피드백 이력</h1><div className="toolbar"><Link href="/coaching">새 상담</Link><Link href="/coaching?tab=requests">교관 요청·답변</Link></div></div>
  <section className="panel" aria-label="내 피드백 이력">
   <div className="section-heading"><p className="help">내 AI 코칭 기록과 교관 답변을 함께 확인합니다.</p><button className="secondary" disabled={result.loading} onClick={result.reload}>새로고침</button></div>
   <ErrorNote message={result.error} retry={result.reload}/>
   {result.loading?<Loading/>:result.data?<>
    <FeedbackPager page={current} total={rows.length} onPage={setPage}/>
    {visible.map((row,index)=><article className="report-preview" key={`${end-index}:${row.receiptNo}`}>
     <div className="section-heading"><h2>{row.receiptNo}</h2><span className="muted">{row.status==='완료'?(row.source==='AI셀프코칭'?'AI 코칭 완료':'교관 답변 완료'):'교관 검토중'}</span></div>
     <p className="preserve-lines">{row.situation}</p>
     <p className="preserve-lines">AI: {row.aiCoachText||'-'}</p>
     {row.handlerAnswer?<p className="preserve-lines">교관: {row.handlerAnswer}</p>:null}
    </article>)}
    {!rows.length?<p className="empty">아직 이력이 없습니다.</p>:null}
   </>:null}
  </section>
 </>;
}
