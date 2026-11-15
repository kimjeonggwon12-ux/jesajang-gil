'use client';
import {useEffect,useState,type ReactNode} from 'react';
import {Modal} from '../Ui';
import type {TierStatus} from '../../lib/contracts';
import {localDate} from '../../lib/activities';
import GrowthGuide from '../home/GrowthGuide';
export default function ClassicTierProgress({tier}:{tier:TierStatus}){
 const [intro,setIntro]=useState(false);useEffect(()=>{try{setIntro(localStorage.getItem('ts_tier_start_1105')!=='1');}catch{}},[]);
 function accept(){try{localStorage.setItem('ts_tier_start_1105','1');}catch{}setIntro(false);}
 if(intro&&tier.tier)return <Modal title="교사 등급제 시작" variant="tier" onClose={accept}><div className="classic-tier-intro"><div className="classic-tier-intro-label">📢 교사 등급제 시작</div><h2>{localDate()<'2026-11-05'?'내일(11월 5일)부터':'11월 5일부터'}<br/>휴·활·정·우 등급이 시작돼요</h2><p>✅ 한 달에 <b>내 활동 기록 4건</b> 이상 → <b>활동교사</b><br/>⚪ 4건 미만이면 다음 달 <b>휴교사</b><br/>🌱 휴교사도 그 달 <b>4건</b>을 채우면 바로 활동교사<br/>🏅 정교사·우수교사는 1년 센터 인도로 심사{tier.otherPending?<><br/>🙋 <b>11월 5일부터 교육 출석 2번</b>이면 바로 활동교사</>:null}</p><div className="classic-tier-intro-current">지금 내 등급 : <b>{tier.tier}</b><br/><small>10월 교사활동현황 기준 · 11월 기록은 5일부터 세어요</small></div><button onClick={accept}>확인 — 시작하기</button></div></Modal>;
 const goal=tier.activeGoal||4,n=Math.min(tier.recentRecords||0,goal),left=goal-n,before=!!tier.monthStart&&localDate()<tier.monthStart;
 if(!['휴교사','활동교사'].includes(tier.tier)&&!tier.otherPending)return null;
 const other=tier.otherPending&&!before,gaugeGoal=other?tier.otherGoal||2:goal,gaugeCount=other?Math.min(tier.otherAttend||0,gaugeGoal):n;
 const remaining=tier.monthDaysLeft!=null?' · 이번 달 '+tier.monthDaysLeft+'일 남음':'';
 let icon='⚪',title=<>지금은 <b>휴교사</b>예요 · 이번 달 기록 <b>{n}/{goal}건</b></>;
 let description:ReactNode=<>{left>0?<>{left}건 더 기록하면 바로 <b>활동교사</b>가 돼요{remaining}</>:'곧 활동교사로 바뀌어요'}</>;
 if(before){icon='📅';title=<>지금 등급 <b>{tier.tier}</b> · <b>11월 5일</b>부터 기록이 세어져요</>;description=<>한 달에 활동 기록 <b>{goal}건</b>이면 활동교사</>;}
 else if(other){icon='🙋';title=<>교육 <b>출석 {gaugeCount}/{gaugeGoal}번</b> 하면 바로 <b>활동교사</b>예요</>;description=<>또는 이번 달 활동 기록 {goal}건(지금 {n}건)</>;}
 else if(tier.tier==='활동교사'){icon=left>0?'⏳':'✅';title=left>0?<><b>활동교사</b> · 이번 달 기록 <b>{n}/{goal}건</b></>:<><b>활동교사</b> · 이번 달 {goal}건 달성!</>;description=left>0?<>{left}건 더 남기면 다음 달도 활동교사{remaining}</>:'다음 달도 활동교사가 유지돼요';}
 return <div className={'classic-tier '+(before?'before':other?'other':tier.tier==='활동교사'?(left>0?'active-pending':'active-complete'):'rest')}><GrowthGuide tier={tier} buttonClass="classic-tier-card" trigger={<><span className="classic-tier-row"><span className="classic-tier-icon">{icon}</span><span className="classic-tier-text">{title}<small>{description}</small></span><span className="classic-tier-condition">조건 ›</span></span><span className="classic-tier-gauge" aria-label={`진행 ${gaugeCount}/${gaugeGoal}`}>{Array.from({length:gaugeGoal},(_,i)=><i key={i} className={i<gaugeCount?'done':''}/>)}</span></>}/></div>;
}
