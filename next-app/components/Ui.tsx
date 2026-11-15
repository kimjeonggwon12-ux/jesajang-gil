'use client';
import {useEffect,useId,useRef,type ReactNode} from 'react';
import {useDialogHistory,useRootHistory} from '../lib/use-dialog-history';
import type {DialogAddress} from '../lib/dialog-history';
export function ExitNotice({token}:{token:string}){const message=useRootHistory(token);return message?<p className="exit-notice" role="status">{message}</p>:null;}
export function ErrorNote({message,retry}:{message:string;retry?:()=>void}){return message?<p role="alert" className="error">{message} {retry?<button className="text-button" onClick={retry}>다시 불러오기</button>:null}</p>:null;}
export function Loading({children='불러오는 중이에요.'}:{children?:ReactNode}){return <p className="loading-card" role="status">{children}</p>;}
export function Pager({page,pages,total,loading,onPage}:{page:number;pages:number;total:number;loading?:boolean;onPage:(page:number)=>void}) {
  return <nav className="pager" aria-label="페이지"><span>전체 {total.toLocaleString()}명 · {page} / {pages}쪽</span><div><button className="secondary" disabled={loading||page<=1} onClick={()=>onPage(page-1)}>이전</button><button className="secondary" disabled={loading||page>=pages} onClick={()=>onPage(page+1)}>다음</button></div></nav>;
}
export function Modal({title,children,onClose,busy=false,address,variant}:{title:string;children:ReactNode;onClose:()=>void;busy?:boolean;address?:DialogAddress;variant?:'activity'|'tier'}) {
  const ref=useRef<HTMLDialogElement>(null),titleId=useId();
  useDialogHistory(onClose,busy,true,address);
  useEffect(()=>{const dialog=ref.current;dialog?.showModal();return()=>dialog?.close();},[]);
  return <dialog ref={ref} className={'modal'+(variant?' classic-modal classic-modal-'+variant:'')} aria-labelledby={titleId} onCancel={event=>{event.preventDefault();event.stopPropagation();if(!busy)onClose();}}>{variant==='activity'?<button type="button" className="classic-sheet-back" disabled={busy} onClick={onClose}>‹ 뒤로</button>:null}<div className="modal-heading"><h2 id={titleId}>{title}</h2><button type="button" className="secondary" aria-label="닫기" disabled={busy} onClick={onClose}>{variant==='activity'?<span aria-hidden="true">×</span>:'닫기'}</button></div>{children}</dialog>;
}
export function Counts({values}:{values:Record<string,number>}){return <dl className="counts">{Object.entries(values).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value.toLocaleString()}</dd></div>)}</dl>;}
