'use client';
import {useRef,useState,type FormEvent} from 'react';
import {useMember} from '../MemberArea';
import {downloadBase64} from '../../lib/download';
import {ErrorNote,Modal} from '../Ui';
export default function StatusExport({dept,onClose}:{dept:string;onClose:()=>void}){
 const {request}=useMember(),pending=useRef(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function download(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(pending.current)return;pending.current=true;setBusy(true);setError('');const form=event.currentTarget;
  try{const result=await request<{fileName:string;base64:string}>('exportNonParticipants',{dept,password:String(new FormData(form).get('password'))});downloadBase64(result.fileName,result.base64);onClose();}
  catch(error){setError((error as Error).message);}finally{const input=form.elements.namedItem('password');if(input instanceof HTMLInputElement)input.value='';pending.current=false;setBusy(false);}
 }
 return <Modal title="미활동·교육 불참 엑셀" busy={busy} onClose={onClose}><form onSubmit={download}><fieldset disabled={busy}><p>{dept||'전체 부서'}의 미활동·교육 불참·모두 0회 명단을 세 시트로 받습니다. 이름 검색과 현재 페이지는 파일 범위를 줄이지 않습니다.</p><label htmlFor="participation-password">다운로드 비밀번호</label><input id="participation-password" name="password" type="password" autoComplete="off" required/><ErrorNote message={error}/><button className="primary full">{busy?'만드는 중…':'엑셀 받기'}</button></fieldset></form></Modal>;
}
