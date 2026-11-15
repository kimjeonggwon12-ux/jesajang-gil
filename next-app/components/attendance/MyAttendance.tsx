'use client';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useCallback,useMemo,useState} from 'react';
import {useMember} from '../MemberArea';
import {useQuery} from '../../lib/use-query';
import {attendanceSessions,attendanceLate,attendanceRows,attendanceWhen,attendanceLabel,attendanceAnswer,attendancePick,attendanceId,attendancePath,type MyAttendance as Data} from '../../lib/attendance';
import AttendanceScanner from './AttendanceScanner';
export default function MyAttendance(){
 const {access}=useMember(),query=useQuery<Data>('getMyAttendance'),router=useRouter(),[scan,setScan]=useState(false),[link,setLink]=useState(''),[error,setError]=useState(''),[limit,setLimit]=useState(20);
 const rows=useMemo(()=>query.data?attendanceRows(query.data):[],[query.data]),late=rows.filter(r=>r.late).length;
 const found=useCallback((id:string)=>{setScan(false);router.push(attendancePath(id,'scan'));},[router]);
 return <><div className="page-title"><div><p className="eyebrow">나의 교실</p><h1>모임 출석</h1><p className="muted">내가 출석한 모임과 설문 답변을 확인해요.</p></div><button className="secondary" onClick={query.reload} disabled={query.loading}>새로고침</button></div>
 <section className="panel"><button className="primary" onClick={()=>setScan(true)}>QR로 출석하기</button><details><summary>출석 링크로 열기</summary><form onSubmit={e=>{e.preventDefault();const id=attendanceId(link);if(!id){setError('출석 QR의 링크나 모임 번호를 확인해 주세요.');return;}setError('');router.push(attendancePath(id));}}><label>출석 링크 또는 모임 번호<input value={link} maxLength={2048} onChange={e=>setLink(e.target.value)}/></label><button className="secondary">모임 열기</button>{error?<p className="error" role="alert">{error}</p>:null}</form></details></section>
 {scan?<AttendanceScanner onFound={found} onClose={()=>setScan(false)}/>:null}
 {query.loading?<p role="status">출석 기록을 불러오는 중이에요.</p>:query.error?<p role="alert" className="error">{query.error}</p>:<><div className="attendance-summary"><div><b>{rows.length}</b>출석</div><div><b>{rows.length-late}</b>정상 출석</div><div><b>{late}</b>지각</div></div>{query.data?.records.some(r=>r.additionalRecords?.length)?<p className="help">같은 모임은 여러 타임에 참석해도 한 번으로 집계해요. 정상·지각 합계는 첫 출석 기준이에요.</p>:null}{!rows.length?<p className="panel">아직 출석한 모임이 없어요. 모임에서 QR을 찍어 보세요.</p>:<div className="attendance-list">{rows.slice(0,limit).map(({meeting:m,record:r,late})=><article className="panel" key={m.meetingId}><div className="attendance-row"><h2>{m.title}</h2><strong className={late?'attendance-late':''}>{late||'정상 출석'}</strong></div><p className="muted">{attendanceWhen(m)}</p>{attendanceSessions(r).map(session=><section key={session.at}><h3>{session.at.slice(11,16)} 출석 · {attendanceLate(m,session)||'정상 출석'}</h3><p>{[attendanceLabel(m),attendancePick(session)].filter(Boolean).join(' · ')}</p><dl className="attendance-answers">{m.questions.filter(q=>attendanceAnswer(session.answers[q.id])).map(q=><div key={q.id}><dt>{q.label}</dt><dd>{attendanceAnswer(session.answers[q.id])}</dd></div>)}</dl></section>)}</article>)}</div>}{rows.length>limit?<button className="secondary" onClick={()=>setLimit(n=>n+20)}>더 보기 ({Math.min(limit,rows.length)}/{rows.length})</button>:null}</>}
 {access.isAdmin?<p><Link href="/admin/attendance">출석 관리 열기</Link></p>:null}<p><Link href="/menu">전체 메뉴</Link></p></>;
}
