'use client';
import Link from 'next/link';
import {useQuery} from '../../lib/use-query';
import type {CalendarAd} from '../../lib/calendar';
// 11/18(사용자): 나의 교실 '내 활동 보고' 맨 위에 일정·광고 — 광고 3개, 누르면 일정·광고 화면
export default function ActivityAds(){
  const result=useQuery<{rows:CalendarAd[]}>('getCalendarAds',{});
  const ads=(result.data?.rows||[]).slice(0,3);
  if(!ads.length)return null;
  return <div className="act-ad"><div className="act-ad-h"><b>📢 일정·광고</b><Link href="/calendar" prefetch={false}>전체 보기 ›</Link></div>
    {ads.map(ad=><Link key={ad.adId} className="act-ad-row" href="/calendar" prefetch={false}><span className="act-ad-tag">광고</span><b>{ad.title}</b></Link>)}</div>;
}
