'use client';
import {useState} from 'react';
import Link from 'next/link';
import {useMember} from '../MemberArea';
import {useCalendarForReminders} from '../entry/AppRuntime';
import {useQuery} from '../../lib/use-query';
import {eventRange,type CalendarData,calendarDate} from '../../lib/calendar';
import {homeEvent} from '../../lib/home-notices';
import {ErrorNote,Loading} from '../Ui';
import {useNotices} from './NoticeProvider';
import {EncouragementInbox} from './Encouragements';
import UnreadChats from './UnreadChats';
export default function HomeUpdates({dept}:{dept:string}){
 const {session}=useMember(),n=useNotices(),cal=useQuery<CalendarData>('getCalendarEvents'),[enc,setEnc]=useState(false),[chats,setChats]=useState(false),today=calendarDate(new Date()),event=homeEvent(cal.data?.rows||[],today,dept,session.account.memberId),c=n.counts,i=n.data;
 useCalendarForReminders(session.token,cal.data);
 return <><section className="panel"><h2>{event.today?'오늘 일정':'이번 주 일정'}</h2><ErrorNote message={cal.error} retry={cal.reload}/>{cal.loading?<Loading/>:!cal.error?<Link className="home-event" href={event.event?'/calendar?event='+encodeURIComponent(event.event.eventId):'/calendar'}><strong>{event.event?.title||'이번 주 전도 일정 없음'}</strong><span>{event.event?eventRange(event.event)+(event.event.place?' · '+event.event.place:''):'일정·공지에서 확인하세요'}</span></Link>:null}</section>
 <section id="notices" className="panel"><div className="section-heading"><h2>새 소식·받은 알림</h2><button className="secondary" disabled={n.loading} onClick={n.refresh}>알림 새로고침</button></div><ErrorNote message={n.error} retry={n.refresh}/>{n.loading&&!i?<Loading/>:null}{i&&c?<><div className="menu-grid"><button className="notice-card" onClick={()=>setEnc(true)}><strong>받은 격려 {i.encouragements}개</strong><span>메시지 확인</span></button><Link href="/coaching?tab=requests"><strong>교관 답변 {c.coach}개</strong><span>내 요청·답변</span></Link><button className="notice-card" onClick={()=>setChats(true)}><strong>개인 대화 {i.connect.unread}개</strong><span>안 읽은 메시지</span></button><Link href="/rooms"><strong>피드백방 {i.marks.room}개</strong><span>방에서 읽지 않은 글</span></Link>{i.center.toDecide||i.center.toSend||i.center.unread?<Link href="/centers"><strong>센터 업무</strong><span>승인 {i.center.toDecide} · 전달 {i.center.toSend} · 새 서류 {i.center.unread}</span></Link>:null}<Link href="/calendar"><strong>일정·전도부 새 글 {c.board}개</strong><span>광고·공지·공식 일정</span></Link><Link href="/community?section=story"><strong>오늘 새 사례 {c.story}개</strong><span>교사들의 이야기</span></Link><Link href="/community?section=yard"><strong>교사 마당 새 글 {c.etc}개</strong><span>질문·나눔·참여</span></Link><Link href="/library"><strong>교재·영상 {c.library?'N':''}</strong><span>새 자료 확인</span></Link><Link href="/connect?tab=find"><strong>교사 찾기 {c.find?'N':''}</strong><span>새 명함 확인</span></Link><Link href="/connect?tab=helps"><strong>도와주세요 {c.helps?'N':''}</strong><span>새 도움 요청</span></Link></div>{i.connect.pendingCoop?<p>이전 협력 요청 {i.connect.pendingCoop}건이 대기 중입니다.</p>:null}</>:null}<p className="help">새 글 표시는 이 기기에서 확인한 기록을 사용합니다. 대화·격려의 읽음 상태는 계정에 저장됩니다.</p></section>{enc?<EncouragementInbox onClose={()=>setEnc(false)}/>:null}{chats?<UnreadChats onClose={()=>setChats(false)}/>:null}</>;
}
