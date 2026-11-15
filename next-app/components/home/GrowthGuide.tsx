'use client';
import {useState,type ReactNode} from 'react';
import Link from 'next/link';
import {Modal} from '../Ui';
import {TIER_GUIDE,REST_REASONS} from '../../lib/growth-guide';
import {growthConditions} from '../../lib/home-activity';
import type {TierStatus} from '../../lib/contracts';
const routes:Record<string,string>={connect:'/connect',textbook:'/library',ai:'/coaching',calendar:'/calendar',activity:'/activities'};
export default function GrowthGuide({tier,trigger,buttonClass='secondary'}:{tier:TierStatus;trigger?:ReactNode;buttonClass?:string}){
 const [open,setOpen]=useState(false),[reason,setReason]=useState(''),guide=TIER_GUIDE[tier.tier],picked=REST_REASONS.find(r=>r.key===reason),conditions=growthConditions(tier);
 if(!guide)return null;
 return <><button className={buttonClass} onClick={()=>setOpen(true)}>{trigger||'교사 구분·다음 활동 안내'}</button>{open?<Modal title={tier.tier+' 안내'} onClose={()=>setOpen(false)}><h3>{guide.who}</h3><p>{guide.why}</p><p><strong>{guide.goal}</strong></p>{tier.tier==='휴교사'?<><h3>어떤 상황에 더 가까우세요?</h3><div className="toolbar">{REST_REASONS.map(r=><button key={r.key} className="secondary" aria-pressed={reason===r.key} onClick={()=>setReason(reason===r.key?'':r.key)}>{r.label}</button>)}</div>{picked?<section className="notice"><p>{picked.tip}</p><ul>{picked.dos.map(text=><li key={text}>{text}</li>)}</ul><div className="toolbar">{picked.go.map(([label,tab])=><Link className="secondary" key={tab} href={routes[tab]}>{label}</Link>)}</div></section>:null}</>:<div className="toolbar">{(tier.tier==='우수교사'?[['‘도와주세요’ 글에 응답하기','connect'],['내 활동 기록 남기기','activity']]:[['연결 탭에서 함께할 사람 찾기','connect'],['교재 확인하기','textbook']]).map(([label,tab])=><Link className="secondary" key={tab} href={routes[tab]}>{label}</Link>)}</div>}{tier.nextTier?<><h3>{tier.nextTier}까지 필요한 조건</h3>{conditions.length?conditions.map(row=><section className="panel" key={row.label}><strong>{row.label}: {row.count}/{row.goal}{row.goal>0&&row.count>=row.goal?' · 달성':''}</strong><p>{row.description}</p></section>):<p>조건 정보가 없습니다.</p>}</>:<p>축하드려요! 이미 최고 등급이에요.</p>}</Modal>:null}</>;
}
