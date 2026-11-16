'use client';
import {useState} from 'react';
import Link from 'next/link';
import {useNotices} from '../home/NoticeProvider';
import {EncouragementInbox} from '../home/Encouragements';
import {useQuery} from '../../lib/use-query';
export default function ClassicAttention(){
 const {data,counts}=useNotices(),[enc,setEnc]=useState(false),messages=useQuery<{rows:{fromName:string;message:string}[]}>('getMyEncouragements',{},!!data?.encouragements),first=messages.data?.rows[0];
 return <div className="classic-attention">
 
 {data?.encouragements?<button className="classic-attention-row encouragement" onClick={()=>setEnc(true)}><span>💌</span><strong>{first?`${first.fromName||'지역장'}님: '${first.message}'${data.encouragements>1?` 외 ${data.encouragements-1}건`:''}`:`받은 격려 메시지 ${data.encouragements}건`}</strong><small>전체보기 ›</small></button>:null}
 {counts?.coach?<Link className="classic-attention-row coach" prefetch={false} href="/coaching?tab=requests"><span>💬</span><strong>교관님이 {counts.coach}건에 답변하셨어요</strong><small>확인 ›</small></Link>:null}
 {enc?<EncouragementInbox onClose={()=>setEnc(false)}/>:null}</div>;
}
