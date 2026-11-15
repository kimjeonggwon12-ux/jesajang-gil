'use client';
import {useState} from 'react';
import {useQuery} from '../../lib/use-query';
import type {CoachChoice} from '../../lib/coach-conversation';
import {ErrorNote,Loading,Modal} from '../Ui';
import PrivateChat from './PrivateChat';

export default function CoachConversation({text,onClose}:{text:string;onClose:()=>void}){
 const [selected,setSelected]=useState<CoachChoice|null>(null);
 const result=useQuery<{rows:CoachChoice[]}>('getCoachList',{},!selected);
 if(selected)return <PrivateChat otherId={selected.coachId} name={selected.name} initialText={text} onClose={onClose}/>;
 return <Modal title="상의할 교관 선택" onClose={onClose}>
  <p>교관을 선택하고 대화 내용을 확인한 뒤 보내 주세요.</p>
  <details open><summary>전달할 내용</summary><p className="pre-wrap">{text}</p></details>
  <ErrorNote message={result.error} retry={result.reload}/>
  {result.loading?<Loading>교관을 확인하고 있어요.</Loading>:null}
  {result.data?<div className="activity-cards">{result.data.rows.map(coach=><button type="button" className="activity-card" key={coach.coachId} onClick={()=>setSelected(coach)}><strong>{coach.name}</strong><span>{coach.dept}{coach.region?` · ${coach.region}`:''}</span></button>)}{!result.data.rows.length?<p>등록된 교관이 없습니다.</p>:null}</div>:null}
 </Modal>;
}
