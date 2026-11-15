import AppRuntime from '../components/entry/AppRuntime';
import type {Metadata} from 'next';
import Script from 'next/script';
import './globals.css';
import './classic-extracted.css';
import './classic-presentation.css';
import {NoticeProvider} from '../components/home/NoticeProvider';
import {LearningJobsProvider} from '../components/learning/LearningJobs';
export const metadata:Metadata={title:'교사광장',description:'교사들의 활동과 교육을 함께 관리하는 공간',appleWebApp:{capable:true,title:'교사광장',statusBarStyle:'default'},robots:{index:false,follow:false},icons:{icon:'/assets/optimized/icon-192.png',apple:'/assets/optimized/apple-touch-icon.png'}};
export default function RootLayout({children}:{children:React.ReactNode}) {
  // 운영 설정을 쓰는 보호된 검토 배포에서도 manifest 요청에 기존 로그인 쿠키를 포함한다.
  return <html lang="ko" suppressHydrationWarning><head><link rel="manifest" href="/manifest.json" crossOrigin="use-credentials"/><link rel="stylesheet" crossOrigin="anonymous" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css"/></head><body>{process.env.PILOT_ROUTING_ENABLED==='1'?<Script src="/pilot-bridge.js" strategy="beforeInteractive" data-site="B"/>:null}<NoticeProvider><AppRuntime><LearningJobsProvider>{children}</LearningJobsProvider></AppRuntime></NoticeProvider></body></html>;
}
