'use client';
import Link from 'next/link';
// 11/18(3차, 사용자): 나의 교실 배너 = 피드백방(만드는 3단계) + 수업 계획표(칸 이름) — 한눈에
export default function ActivityAds(){
  return <div className="fbp"><div className="fbp-name">열두 가지 열매 맺는 피드백</div>
    <div className="fbp-t">교사님! <em>지금 어서 피드백방을 만드세요.</em></div>
    <div className="fbp-card"><div className="fbp-ch"><span className="fbp-pill">피드백방 만드는 방법</span><Link href="/rooms" prefetch={false}>방 만들기 ›</Link></div><div className="fs3"><div><span>1</span><b>섭외자 누르기</b></div><i>›</i><div><span>2</span><b>피드백방</b></div><i>›</i><div><span>3</span><b>함께할 분 초대</b></div></div></div>
    <div className="fbp-card"><div className="fbp-ch"><span className="fbp-pill">피드백방에서 모두 함께 보는 것</span></div><div className="lpc rm">{["대화","수업 계획표","정보 기록","활동 이력","단계향상 피드백","감동주기 방법","센터 인도 계획","HEARTS 상세피드백","종합 피드백"].map(x=><span key={x}>{x}</span>)}</div></div>
    <div className="fbp-card"><div className="fbp-ch"><span className="fbp-pill">수업 계획표</span><Link href="/rooms" prefetch={false}>계획 쓰기 ›</Link></div><div className="fbp-must">상담 이상의 모든 교사는 수업 계획표를 작성하세요.</div><div className="lpc">{['수업 제목','교육 목표','감동 주기','입막음','피드백 실행','진행 방식','협력자','상세 계획'].map(x=><span key={x}>{x}</span>)}</div></div>
    </div>;
}
