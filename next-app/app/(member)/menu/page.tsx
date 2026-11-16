'use client';
import Link from 'next/link';
import {useMember} from '../../../components/MemberArea';
export default function MenuPage(){const {access}=useMember();return <><div className="page-title"><div><p className="eyebrow">교사광장</p><h1>전체 메뉴</h1><p className="muted">{access.name}님, 오늘의 활동을 이어가세요.</p></div></div><div className="menu-grid">
  <Link href="/"><strong>나의 현황</strong><span>교사 구분 · 활동 기록</span></Link>
  <Link href="/account"><strong>내 계정</strong><span>현재 PIN 확인 · PIN 변경</span></Link>
  {access.permissions.canManagePilot?<Link href="/admin/pilot"><strong>사이트 운영</strong><span>새 사이트 사용자 지정 · 전체 복귀 · 변경 이력</span></Link>:null}
  <Link href="/members"><strong>교사 명단</strong><span>부서 · 지역 · 활동 · 이수교육</span></Link>
  <Link href="/status"><strong>전체·지역 현황</strong><span>조직별 집계 · 활동 현황</span></Link>
  <Link href="/activities?view=tools"><strong>활동 보고</strong><span>작성 · 수정 · 대상자 · 누적 기록</span></Link>
  <Link href="/device"><strong>앱 설치·기기 알림</strong><span>설치용 QR · 알림 설정</span></Link>
  <Link href="/rooms"><strong>피드백방</strong><span>대화 · 누적 기록 · 초대</span></Link>
  <Link href="/attendance"><strong>모임 출석</strong><span>QR 출석 · 출석 기록 · 설문 답변</span></Link>
  <Link href="/calendar"><strong>일정·광고</strong><span>일정 · 공지 · 행사</span></Link>
  <Link href="/community"><strong>교사 이야기</strong><span>사례 · 나눔</span></Link>
  <Link href="/connect"><strong>연결</strong><span>명함 · 도움 요청 · 대화</span></Link>
  <Link href="/coaching"><strong>AI 상담</strong><span>상담 · 교관 피드백</span></Link>
  <Link href="/library"><strong>교재·영상</strong><span>자료 · 영상 · 교육</span></Link>
  <Link href="/community?section=questions"><strong>참여</strong><span>질문 · 의견 · 공모</span></Link>
  {access.isAdmin?<Link href="/admin/required-education"><strong>필수교육 이수 관리</strong><span>이수일 등록 · 등록 이력</span></Link>:null}
  {access.permissions.canManageRoster?<Link href="/admin/roster"><strong>명단 관리</strong><span>교사 정보 · 관리자 지정 · PIN 복구</span></Link>:null}
  {access.isAdmin?<Link href="/admin/attendance"><strong>출석 관리</strong><span>모임 · QR · 설문 · 집계</span></Link>:null}
  {access.isAdmin?<Link href="/admin/education"><strong>교육 과정 운영</strong><span>교육생 · 시간표 · 출석 · 담당자</span></Link>:null}
  {access.isAdmin?<Link href="/admin/analysis"><strong>전체 현황 AI 분석</strong><span>명단 · 상담 집계 · 결산</span></Link>:null}
  {access.isAdmin?<Link href="/admin/reports"><strong>교육 재적·보고방</strong><span>명단 가져오기 · 집계 기준 · 수신 방</span></Link>:null}
  {access.isAdmin?<Link href="/admin"><strong>업무 관리</strong><span>행사 · 출석 · 교육 · 센터</span></Link>:null}
</div></>;}
