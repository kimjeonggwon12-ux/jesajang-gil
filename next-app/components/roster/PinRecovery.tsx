'use client';
import {useRef,useState,type FormEvent} from 'react';
import {useQuery} from '../../lib/use-query';
import {useMember} from '../MemberArea';
import {ErrorNote,Loading,Modal} from '../Ui';

type Contacts={name:string;memberId:string;depts:string[];contacts:{phone:string;source:string;disputed:boolean}[]};
const SOURCES:Record<string,string>={self_reported:'최초 등록한 번호',existing_roster:'최초 등록 때 명단과 대조한 번호',admin_roster:'관리자 명단 번호',teacher_profile:'교사 프로필 번호'};
function RecoveryTarget({targetId,onClose}:{targetId:string;onClose:()=>void}) {
 const {request}=useMember(),result=useQuery<Contacts>('getPinRecoveryContact',{targetId});
 const [reason,setReason]=useState('PIN 분실'),[confirmed,setConfirmed]=useState(false),[review,setReview]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[code,setCode]=useState('');
 const pending=useRef(false);
 async function issue(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(pending.current||!confirmed)return;
  const form=event.currentTarget,adminPin=String(new FormData(form).get('adminPin')||'');
  pending.current=true;setBusy(true);setError('');
  try{const issued=await request<{recoveryCode:string}>('resetPin',{targetId,reason,identityConfirmed:confirmed,adminPin});setCode(issued.recoveryCode);}
  catch(e){setError((e as Error).message);setReview(false);}
  finally{const input=form.elements.namedItem('adminPin');if(input instanceof HTMLInputElement)input.value='';pending.current=false;setBusy(false);}
 }
 return <Modal title={code?'복구 코드가 발급됐어요':'교사 PIN 복구'} onClose={onClose} busy={busy}>
  {code?<><p>30분 동안 한 번 사용할 수 있어요. 이 화면을 닫으면 다시 볼 수 없어요.</p><p className="recovery-code">{code}</p><p>확인한 본인에게 전달해 주세요. 대상자는 입장 화면에서 ‘PIN 복구’를 선택해 새 PIN을 정하면 됩니다.</p></>:<>
   <ErrorNote message={result.error} retry={result.reload}/>{result.loading?<Loading/>:null}
   {result.data?<section aria-label="등록 연락처"><h3>{result.data.name} · {result.data.depts.join(' / ')}</h3>{result.data.contacts.length?result.data.contacts.map(contact=><p key={contact.phone}>{contact.phone} · {SOURCES[contact.source]||'등록 번호'}{contact.disputed?<strong className="error block">선등록 신고된 번호입니다. 대상자를 별도로 확인해 주세요.</strong>:null}</p>):<p>등록된 전화번호가 없어요. 대상자를 직접 확인해 주세요.</p>}</section>:null}
   {result.data?<form onSubmit={issue}><fieldset disabled={busy}>
    <p className="help">등록 번호로 연락하거나 직접 만나 본인을 확인한 뒤 발급해 주세요. 선등록 신고라면 번호도 다른 사람의 것일 수 있어 별도 확인이 필요합니다.</p>
    <label htmlFor="recovery-reason">복구 사유</label><select id="recovery-reason" value={reason} disabled={review} onChange={e=>{setReason(e.target.value);setConfirmed(false);}}>{['PIN 분실','선등록 신고','명단 연락처 확인'].map(value=><option key={value}>{value}</option>)}</select>
    <label className="check-label recovery-check"><input type="checkbox" checked={confirmed} disabled={review} onChange={e=>setConfirmed(e.target.checked)}/>등록 번호로 연락하거나 직접 만나 본인임을 확인했습니다</label>
    <label htmlFor="recovery-admin-pin">내 PIN 재확인</label><input id="recovery-admin-pin" name="adminPin" type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{6}" maxLength={6} required/>
    <ErrorNote message={error}/>
    {review?<section className="confirmation"><p>{result.data.name}님의 기존 PIN과 로그인이 즉시 중지됩니다. 본인 확인과 복구 사유를 확인하고 발급해 주세요.</p><div className="toolbar"><button type="submit" className="primary">{busy?'발급 중…':'확인하고 복구 코드 발급'}</button><button type="button" className="secondary" onClick={()=>setReview(false)}>취소</button></div></section>:<button type="button" className="primary full" disabled={!confirmed} onClick={()=>setReview(true)}>복구 코드 발급</button>}
   </fieldset></form>:null}
  </>}
 </Modal>;
}
export default function PinRecovery(){
 const [target,setTarget]=useState(''),[selected,setSelected]=useState('');
 return <section className="panel"><h2>교사 PIN 복구</h2><p>대상자의 고유번호로 등록 연락처를 확인하세요. 번호 일치만으로 자동 복구하지 않습니다.</p><form onSubmit={event=>{event.preventDefault();setSelected(target.trim());}}><label htmlFor="recovery-target">대상자 고유번호</label><div className="search-form"><input id="recovery-target" inputMode="numeric" autoComplete="off" maxLength={40} required value={target} onChange={e=>setTarget(e.target.value)}/><button className="primary">등록 연락처 확인</button></div></form>{selected?<RecoveryTarget key={selected} targetId={selected} onClose={()=>setSelected('')}/>:null}</section>;
}
