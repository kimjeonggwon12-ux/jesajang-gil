'use client';
// 11/18(7차, 사용자): 알림판 — 노란 쪽지 제목 + 압정 꽂은 쪽지 3장. 내 활동 보고·피드백방 같은 배너
const SHARED=["대화","수업 계획표","정보 기록","활동 이력","단계향상 피드백","감동주기 방법","센터 인도 계획","HEARTS 상세피드백","종합 피드백"];
export default function ActivityAds(){
  return <div className="fbp"><div className="fbp-t"><span className="fbp-siren">🚨</span>교사님! 지금 어서 피드백방을 만드세요.</div>
    <div className="fbp-note"><span className="fbp-pill">피드백방 만드는 방법</span><div className="fbp-steps">섭외자 누르기<i>›</i>피드백방<i>›</i>함께할 분 초대</div></div>
    <div className="fbp-note"><span className="fbp-pill">피드백방에서 교관 / 인교섬이 함께 보는 것</span><div className="lpc">{SHARED.map(x=><span key={x}>{x}</span>)}</div></div>
    <div className="fbp-note fbp-alert"><div className="fbp-must">상담 이상의 모든 교사는<br/><mark>수업 계획표</mark>를 작성하세요.</div></div></div>;
}
