'use client';
import {useEffect,useRef,useState} from 'react';
import {useMember} from '../MemberArea';
import {ErrorNote} from '../Ui';
import {districtCoachingData} from '../../lib/district-coaching';
import {resultText} from '../../lib/coaching';
import {roleBreakdown} from '../../lib/status';
import ReportText from './ReportText';
export default function DistrictCoaching({dept,breakdown,sample=false}:{dept:string;sample?:boolean;breakdown:ReturnType<typeof roleBreakdown>}){const {request}=useMember(),[text,setText]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),alive=useRef(true),lock=useRef(false);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);async function analyze(){if(lock.current)return;lock.current=true;setBusy(true);setError('');setText('');try{const r=await request<{text:string}>('analyzeDistrictData',{data:districtCoachingData(dept,'전체',breakdown)}),value=resultText(r.text);if(alive.current)setText(value);}catch(e){if(alive.current)setError(e instanceof Error?e.message:'분석하지 못했어요.');}finally{lock.current=false;if(alive.current)setBusy(false);}}return <div className="report-preview"><h3>{sample?'샘플 활동 AI 분석':'이번 달 부서 활동 AI 분석'}</h3><p className="help">{sample?'아래 분석은 고정 샘플 자료를 사용하며 실제 부서 현황을 설명하지 않습니다.':`${dept} 전체의 지역별·역할별 집계로 분석합니다.`}</p><button className="secondary" disabled={busy} onClick={analyze}>{busy?'분석하는 중…':'AI 분석'}</button><ErrorNote message={error}/>{text?<ReportText text={text}/>:null}</div>;}
