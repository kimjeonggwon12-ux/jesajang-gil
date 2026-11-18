'use client';
import Link from 'next/link';
// 11/18(2차, 사용자): 나의 교실엔 일정·광고 대신 "피드백방 + 수업 계획표" 동기부여 배너 하나만
export default function ActivityAds(){
  return <div className="fbp"><span className="fbp-k">🌳 열두 가지 열매 맺는 피드백</span>
    <div className="fbp-t">혼자 고민하지 마세요.<br/><em>한 방에서 함께</em> 열매 맺어요</div>
    <div className="fbp-s">섭외자 한 명에 피드백방 하나. 수업 전에 계획을 나누면 교관·지역장·인도자의 조언이 <b>다음 수업</b>을 바꿉니다.</div>
    <div className="fbp-two"><Link href="/rooms" prefetch={false}><b>💬 피드백방</b><small>보고·자료·조언을<br/>한 방에서 주고받기</small><i>방 만들기 ›</i></Link><Link href="/rooms" prefetch={false}><b>📅 수업 계획표</b><small>날짜별 목표·감동 주기<br/>미리 적고 조언받기</small><i>계획 쓰기 ›</i></Link></div>
    <div className="fbp-flow">계획 ✍️ → 조언 💬 → 수업 📖 → 보고 📝 → 다음 계획 🔁</div></div>;
}
