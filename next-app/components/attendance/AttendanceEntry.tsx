'use client';
import Link from 'next/link';
import {useSearchParams} from 'next/navigation';
import {useCallback,useEffect,useState} from 'react';
import {readApi,SessionExpired} from '../../lib/api';
import {loadSession,MEMBER_KEY,TOKEN_KEY,type Session} from '../../lib/session';
import type {MemberAccess} from '../../lib/contracts';
import {attendanceId,attendanceMemberId,type AttendanceIdentity} from '../../lib/attendance';
import AttendanceCheck from './AttendanceCheck';

export default function AttendanceEntry(){const params=useSearchParams(),id=attendanceId(params.get('meeting')||params.get('attend')||''),method=params.get('method')==='scan'?'scan':'qr';return <main className="attendance-entry"><Link className="brand" href="/">✦ 교사광장</Link>{id?<Entry key={id+'|'+method} meetingId={id} method={method}/>:<section className="panel"><h1>출석 QR을 확인해 주세요</h1><p>모임 화면의 QR을 다시 찍거나 출석 링크를 열어 주세요.</p><Link href="/attendance">내 출석으로 이동</Link></section>}</main>;}
function Entry({meetingId,method}:{meetingId:string;method:string}){
 const [snapshot,setSnapshot]=useState<{key:string;session:Session|null}|null>(null),[identity,setIdentity]=useState<AttendanceIdentity|null>(null),[ready,setReady]=useState(false),[loadedKey,setLoadedKey]=useState<string|null>(null),[message,setMessage]=useState(''),[name,setName]=useState(''),[memberId,setMemberId]=useState(''),[error,setError]=useState('');
 useEffect(()=>{
  const sync=()=>{const session=loadSession(),key=session?.token||'';setSnapshot(old=>old&&old.key===key?old:{key,session});};
  const changed=(e:StorageEvent)=>{if(e.key===TOKEN_KEY||e.key===MEMBER_KEY||e.key===null)sync();};
  sync();window.addEventListener('storage',changed);window.addEventListener('focus',sync);return()=>{window.removeEventListener('storage',changed);window.removeEventListener('focus',sync);};
 },[]);
 useEffect(()=>{
  if(!snapshot)return;let active=true;setReady(false);setLoadedKey(snapshot.key);setIdentity(null);setName('');setMemberId('');setError('');setMessage('');
  const session=snapshot.session;
  if(!session||session.account.guest||!session.token.startsWith('m')){setReady(true);return;}
  readApi<MemberAccess>('checkAdmin',session.token).then(r=>{if(!active||(loadSession()?.token||'')!==snapshot.key)return;if(r.error)throw Error(r.error);const value={name:r.name,memberId:attendanceMemberId(session.account.memberId),token:session.token};setIdentity(value);setName(value.name);setMemberId(value.memberId);setReady(true);}).catch(e=>{if(!active)return;setMessage(e instanceof SessionExpired?'로그인이 만료됐어요. 출석만 하려면 이름과 고유번호를 입력해 주세요.':(e instanceof Error?e.message:'로그인 정보를 확인하지 못했어요.'));setReady(true);});return()=>{active=false;};
 },[snapshot]);
 const current=useCallback(()=>snapshot!==null&&(loadSession()?.token||'')===snapshot.key,[snapshot]);
 if(!ready||!snapshot||loadedKey!==snapshot.key)return <p role="status">출석 정보를 확인하고 있어요.</p>;
 if(identity)return <AttendanceCheck key={snapshot.key+'|'+identity.memberId+'|'+identity.token} meetingId={meetingId} method={method} identity={identity} current={current} onChange={()=>{setIdentity(null);setError('');setMessage('이름과 고유번호를 다시 확인해 주세요.');}}/>;
 return <section className="panel"><h1>모임 출석</h1><p>이름과 고유번호로 출석 정보를 확인해요.</p>{message?<p role="status">{message}</p>:null}<form onSubmit={e=>{e.preventDefault();const digits=memberId.replace(/\D/g,''),nm=name.replace(/\s/g,'');if(!nm||digits.length!==13){setError('이름과 고유번호 13자리를 입력해 주세요.');return;}if(!current())return;setError('');setIdentity({memberId:digits,name:nm,token:''});}}><label>이름<input autoComplete="name" maxLength={20} required value={name} onChange={e=>setName(e.target.value)}/></label><label>고유번호 13자리<input inputMode="numeric" autoComplete="off" maxLength={20} required value={memberId} onChange={e=>setMemberId(e.target.value)}/></label>{error?<p className="error" role="alert">{error}</p>:null}<button className="primary">확인하고 출석하기</button></form><p className="help">출석 입력은 교사광장 로그인과 별개예요. 이전 설문 답변은 본인 계정으로 로그인하면 확인할 수 있어요.</p><Link href="/attendance">로그인하고 내 출석 보기</Link></section>;
}
