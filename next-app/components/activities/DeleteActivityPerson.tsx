'use client';
import {useRef,useState} from 'react';
import {useMember} from '../MemberArea';
import {Modal,ErrorNote} from '../Ui';
import {maskName} from '../../lib/status-extra';
export default function DeleteActivityPerson({person,onClose,onDeleted}:{person:{name:string;total:number;targetId?:string};onClose:()=>void;onDeleted:(message:string)=>void}){
 const {request}=useMember(),lock=useRef(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function remove(){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{const result=await request<{deletedActivities:number}>('deleteTarget',{targetId:person.targetId||'',targetName:person.name});onDeleted(`${maskName(person.name)}님의 연결 활동 ${result.deletedActivities}건을 삭제했어요.`);}catch(e){setError((e as Error).message);}finally{lock.current=false;setBusy(false);}}
 return <Modal title="대상자 기록 영구 삭제" onClose={onClose} busy={busy}><h3>{maskName(person.name)}</h3><p>내 활동 기록 {person.total}건이 집계에서 빠집니다.</p><p>같은 이름의 담당 대상자가 있으면 대상자 정보·단계 이력·AI 피드백·개강 계획·피드백방과 담당자들의 연결 활동도 함께 삭제됩니다. 담당 대상자가 없으면 내가 이 이름으로 남긴 활동만 삭제됩니다.</p><p>되돌릴 수 없습니다. 이미 Telegram에 올라간 보고는 남습니다.</p><ErrorNote message={error}/><div className="toolbar"><button className="secondary" disabled={busy} onClick={onClose}>취소</button><button className="primary danger" disabled={busy} onClick={()=>void remove()}>{busy?'삭제 중…':'연결 기록까지 영구 삭제'}</button></div></Modal>;
}
