'use client';
import {useRef,useState,type FormEvent} from 'react';
import Link from 'next/link';
import {useClassicIdentity} from './presentation/ClassicIdentity';
import {useMember} from './MemberArea';
import {useQuery} from '../lib/use-query';
import {ErrorNote,Loading,Modal} from './Ui';

function PinSettings({onClose}:{onClose:()=>void}) {
 const {request,renewPinSession}=useMember(),status=useQuery<{hasPin:boolean}>('pinStatus');
 const [oldPin,setOldPin]=useState(''),[pin,setPin]=useState(''),[confirm,setConfirm]=useState(''),[show,setShow]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const pending=useRef(false);
 async function submit(event:FormEvent){
  event.preventDefault();if(pending.current)return;
  if(!/^\d{6}$/.test(pin)||pin!==confirm){setError('새 PIN은 같은 숫자 6자리로 두 번 입력해 주세요.');return;}
  pending.current=true;setBusy(true);setError('');
  try{const result=await request<{ok?:boolean;token?:string;pinVer?:string;ver?:string}>('setPin',{oldPin,pin});renewPinSession(result);}
  catch(e){setError((e as Error).message);}finally{pending.current=false;setBusy(false);}
 }
 return <Modal title="PIN 바꾸기" onClose={onClose} busy={busy}>
  <ErrorNote message={status.error} retry={status.reload}/>{status.loading?<Loading/>:status.data?.hasPin?<form onSubmit={submit}>
   <p>현재 PIN을 확인하고 새 PIN으로 바꿔요. 변경하면 이전 로그인 정보는 만료돼요.</p>
   <fieldset disabled={busy}><label>현재 PIN<input type={show?'text':'password'} inputMode="numeric" pattern="[0-9]{4,6}" maxLength={6} autoComplete="current-password" required value={oldPin} onChange={e=>setOldPin(e.target.value)}/></label>
    <label>새 PIN<input type={show?'text':'password'} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="new-password" required value={pin} onChange={e=>setPin(e.target.value)}/></label>
    <label>새 PIN 확인<input type={show?'text':'password'} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="new-password" required value={confirm} onChange={e=>setConfirm(e.target.value)}/></label>
    <label><input type="checkbox" checked={show} onChange={e=>setShow(e.target.checked)}/> 숫자 보이기</label>
    <ErrorNote message={error}/><button className="primary">{busy?'바꾸는 중…':'PIN 변경'}</button>
   </fieldset>
  </form>:status.data?<p>PIN 최초 등록 또는 담당자 복구가 필요해요. 입장 화면에서 진행해 주세요.</p>:null}
  <p className="help">PIN을 잊었거나 다른 사람이 먼저 등록했다면 교육·전도 담당자에게 본인 확인 후 복구 코드를 받아 주세요.</p>
 </Modal>;
}
export default function AccountSettings({onClose}:{onClose?:()=>void}){
 const {access,session}=useMember(),identity=useClassicIdentity(),[open,setOpen]=useState(false);
 const content=<><div className="page-title"><div><h1>🍇 {access.name}</h1><p>{access.roster?.dept||access.dept} · {access.roster?.tier}</p><p>내 고유번호: {session.account.memberId}</p></div></div><section className="panel"><p>이 기기에 입장 정보가 저장돼 있어요. 로그인이 만료되면 PIN을 다시 확인해 주세요.</p><div className="toolbar"><Link href="/menu" onClick={()=>onClose?.()}>전체 메뉴</Link>{access.permissions.canManagePilot?<Link href="/admin/pilot" onClick={()=>onClose?.()}>사이트 운영·A/B 사용자 지정</Link>:null}<Link href="/activities" onClick={()=>onClose?.()}>내 등급·조건 보기</Link>{access.permissions.canManageRoster?<Link href="/admin/roster" onClick={()=>onClose?.()}>명단 관리·교사 PIN 복구</Link>:null}</div><h2>로그인 보호</h2><p>새 PIN은 숫자 6자리로 정해 주세요. 연속되거나 모두 같은 숫자는 사용할 수 없어요.</p><button className="primary" onClick={()=>setOpen(true)}>🔒 PIN 변경</button><button className="kko-btn-outline" onClick={()=>identity?.logout()}>🏠 홈으로 (표지부터 다시 시작)</button></section>{open?<PinSettings onClose={()=>setOpen(false)}/>:null}</>;
 return onClose?<Modal title="내 계정" onClose={onClose}><div className="classic-account-sheet">{content}</div><button className="kko-btn-main" onClick={onClose}>닫기</button></Modal>:content;
}
