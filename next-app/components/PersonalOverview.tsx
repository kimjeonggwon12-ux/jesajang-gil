'use client';
import Link from 'next/link';
import {useState} from 'react';
import type {TierStatus} from '../lib/contracts';
import {useMember} from './MemberArea';
import {useQuery} from '../lib/use-query';
import HomeUpdates from './home/HomeUpdates';
import HomeActivity from './home/HomeActivity';
import GrowthGuide from './home/GrowthGuide';

export default function PersonalOverview() {
  const [activityVersion,setActivityVersion]=useState(0);
  const {access}=useMember(),result=useQuery<TierStatus>('getMyTierStatus'),tier=result.data;
  const data={access,tier,tierError:result.error},error=result.error,loading=result.loading;

  return <><div className="page-title"><div><p className="eyebrow">나의 교실</p><h1>{data?`${data.access.name}님의 현황`:'내 현황을 확인하고 있어요'}</h1>{tier?<p className="muted">{[tier.dept,tier.region].filter(Boolean).join(' · ')}</p>:null}</div><button className="secondary" onClick={()=>{result.reload();setActivityVersion(v=>v+1);}} disabled={loading}>{loading?'불러오는 중…':'새로고침'}</button></div>
      {error?<p className="error" role="alert">{error} <button className="text-button" onClick={result.reload}>다시 불러오기</button></p>:null}
      {loading&&!error?<p role="status" className="loading-card">활동 현황을 불러오는 중이에요.</p>:null}
      {data?.tierError?<p className="help">{data.tierError} 전체 메뉴에서 담당 업무를 이어갈 수 있어요.</p>:null}
      <HomeUpdates dept={tier?.dept||access.dept}/>
      {tier?<>
        <section className="tier-banner" aria-labelledby="my-tier"><div><p>현재 교사 구분</p><h2 id="my-tier">{tier.tier}</h2><GrowthGuide tier={tier}/>{tier.tierChangedAt?<p>최근 변경 {tier.tierChangedAt}</p>:null}</div><div><p>마지막 활동</p><strong>{tier.lastActivityDate||'아직 기록이 없어요'}</strong></div></section>
        <div className="stat-grid"><section className="stat-card"><h2>이번 달 활동 기록</h2><p className="stat-number">{tier.recentRecords.toLocaleString()}<span> / {tier.activeGoal}건</span></p><p className="muted">{tier.monthStart} ~ {tier.monthEnd}</p><p>이번 달이 {tier.monthDaysLeft}일 남았어요.</p></section>
          <section className="stat-card"><h2>최근 1년 센터 인도</h2><p className="stat-number">{tier.leadCount.toLocaleString()}<span>{tier.leadGoal!==null?` / ${tier.leadGoal}`:''}명</span></p><p className="muted">{tier.nextTier?`다음 교사 구분: ${tier.nextTier}`:'현재 교사 구분을 확인해 주세요.'}</p></section>
          {tier.otherPending?<section className="stat-card"><h2>교육 출석</h2><p className="stat-number">{tier.otherAttend??0}<span> / {tier.otherGoal}회</span></p><p className="muted">기존 교육 출석 기준으로 확인해요.</p></section>:null}</div>
        {tier.suggestion?<section className="suggestion"><h2>등급 안내</h2><p>{tier.suggestion.reason}</p><p className="muted">현재 교사 구분은 {tier.tier}입니다.</p></section>:null}
      </>:null}
      <HomeActivity version={activityVersion}/>
      {data?<section aria-labelledby="continue-title" className="continue"><h2 id="continue-title">활동 이어가기</h2><div className="menu-grid"><Link href="/activities"><strong>활동 보고</strong><span>작성 · 수정 · 대상자 · 누적 기록</span></Link><Link href="/menu"><strong>전체 메뉴</strong><span>일정 · 교육 · 출석 · 교재</span></Link><Link href="/members"><strong>교사 명단</strong><span>검색 · 활동 · 이수교육</span></Link><Link href="/status"><strong>전체·지역 현황</strong><span>조직별 집계 · 활동 분석</span></Link>{data.access.isAdmin?<Link href="/admin/roster"><strong>관리자</strong><span>명단 운영 · 교육 관리</span></Link>:null}</div></section>:null}
    </>;
}
