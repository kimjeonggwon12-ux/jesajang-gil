'use client';
import {useEffect,useState} from 'react';
import {useMember} from '../MemberArea';
import {ErrorNote,Loading} from '../Ui';

type Source='reports'|'webhooks';
type Row={status:'sending'|'processing'|'unknown';finished_at:string|null;meeting_id?:string;phase?:string;room_key?:string;part_no?:number;mode?:string;created_at?:string;bot_key?:string;update_id?:number;received_at?:string};
type Review={source:Source;page:number;pageSize:number;total:number;hasMore:boolean;rows:Row[];checkedAt:string};
const time=(value?:string)=>value?new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'기록 없음';
export default function DeliveryReview(){
  const {request,access}=useMember(),[source,setSource]=useState<Source>('reports'),[page,setPage]=useState(1),[attempt,setAttempt]=useState(0),[data,setData]=useState<Review|null>(null),[error,setError]=useState('');
  // checkAdmin의 canManageBackup은 현재 앱 관리자 판정이다. 실제 권한은 매 요청 서버에서 재검사한다.
  const owner=!!access.permissions.canManageBackup;
  useEffect(()=>{if(!owner)return;let live=true;setData(null);setError('');request<Review>('getDeliveryReview',{source,page}).then(value=>{if(live)setData(value);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[request,owner,source,page,attempt]);
  if(!owner)return <p>전달 확인 기록은 앱 관리자만 볼 수 있어요.</p>;
  function changeSource(value:Source){setData(null);setSource(value);setPage(1);}
  function move(value:number){setData(null);setPage(value);}
  return <section><h1>전달 확인 필요</h1><p>처리 중이거나 결과를 확정하지 못한 보고와 봇 요청입니다. 처리 중은 잠시 표시될 수 있으므로 새로 확인해 주세요. 오래 남아 있거나 결과가 불명확하면 앱의 저장 내용과 실제 Telegram 수신 내용을 함께 확인해야 합니다.</p><p>이 화면은 기록을 조회합니다. 다시 보내거나 완료 처리하지 않습니다. 시간은 한국 시간입니다.</p>
    <div className="att-actions"><button className={source==='reports'?'primary':'secondary'} aria-pressed={source==='reports'} onClick={()=>changeSource('reports')}>보고 전달</button><button className={source==='webhooks'?'primary':'secondary'} aria-pressed={source==='webhooks'} onClick={()=>changeSource('webhooks')}>봇 요청 처리</button><button className="secondary" onClick={()=>{setData(null);setAttempt(n=>n+1);}}>새로 확인</button></div>
    <ErrorNote message={error} retry={()=>setAttempt(n=>n+1)}/>{!data&&!error?<Loading/>:null}
    {data?<><p role="status">확인 대상 {data.total.toLocaleString()}건 · {data.page}쪽 · {time(data.checkedAt)} 조회</p>{!data.rows.length?<p>이 쪽에 표시할 확인 대상이 없습니다.</p>:data.rows.map((row,i)=><article className="panel" key={`${source}-${page}-${i}`}><h2>{row.status==='unknown'?'결과 확인 필요':'처리 중 · 장시간 지속 시 확인'}</h2>{source==='reports'?<><p>보고 {row.phase} · 대상 {row.room_key}</p><p>관련 기록 {row.meeting_id} · {row.mode==='auto'?'자동':'수동'} 전달 · 부분 번호 {row.part_no}</p></>:<><p>봇 요청 번호 {row.update_id} · 봇 구분 {row.bot_key}</p><p>요청 원문과 방 정보는 이 기록에 보관하지 않습니다. 접수 시각과 실제 앱·Telegram 기록을 대조해 주세요.</p></>}<p>접수 {time(row.created_at||row.received_at)} · 마지막 결과 {time(row.finished_at||undefined)}</p></article>)}
    <div className="att-actions"><button className="secondary" disabled={page===1} onClick={()=>move(page-1)}>이전 쪽</button><button className="secondary" disabled={!data.hasMore} onClick={()=>move(page+1)}>다음 쪽</button></div><p>새 기록이 들어오거나 처리가 끝나면 쪽별 내용과 건수가 달라질 수 있습니다.</p></>:null}
  </section>;
}
