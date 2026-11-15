'use client';
import {useState} from 'react';
import {useMember} from '../MemberArea';
import {useQuery} from '../../lib/use-query';
import {useAttendanceTask} from '../attendance/useAttendanceTask';
import {ErrorNote,Loading,Modal} from '../Ui';
import {useNotices} from './NoticeProvider';
type Message={messageKey:number;fromName:string;message:string;sentAt:string};
export function EncouragementInbox({onClose}:{onClose:()=>void}){
 const {request}=useMember(),result=useQuery<{rows:Message[]}>('getMyEncouragements'),task=useAttendanceTask(),notices=useNotices(),[done,setDone]=useState<number[]>([]),[limit,setLimit]=useState(20);
 async function close(){if(!result.data||result.error){onClose();return;}await task.run(async()=>{const ids=result.data!.rows.filter(r=>!done.includes(r.messageKey)).map(r=>r.messageKey),completed:number[]=[];let failed=0;for(let i=0;i<ids.length;i+=10){if(!task.active())return;const slice=ids.slice(i,i+10),answers=await Promise.allSettled(slice.map(messageKey=>request('markEncouragementRead',{messageKey})));answers.forEach((r,j)=>r.status==='fulfilled'?completed.push(slice[j]):failed++);}if(!task.active())return;setDone(old=>[...old,...completed]);notices.refresh();if(failed)throw Error(`${failed}개 메시지를 읽음으로 바꾸지 못했어요. 다시 닫기를 눌러 확인해 주세요.`);onClose();});}
 const rows=(result.data?.rows||[]).filter(r=>!done.includes(r.messageKey));
 return <Modal title="받은 격려 메시지" onClose={()=>{void close();}} busy={task.busy}><ErrorNote message={result.error} retry={result.reload}/><ErrorNote message={task.error}/>{result.loading?<Loading/>:<><p>닫으면 이번에 불러온 메시지 {rows.length}개를 읽음으로 표시합니다.</p>{rows.slice(0,limit).map(r=><article className="report-preview" key={r.messageKey}><h3>{r.fromName||'지역장'}님</h3><p className="muted">{r.sentAt}</p><p className="pre-wrap">{r.message}</p></article>)}{rows.length>limit?<button className="secondary" onClick={()=>setLimit(n=>n+20)}>격려 더 보기</button>:null}{!rows.length?<p>아직 읽지 않은 격려가 없어요.</p>:null}<button className="primary" disabled={task.busy} onClick={()=>{void close();}}>확인하고 닫기</button></>}</Modal>;
}
export function EncouragementComposer({memberId,name}:{memberId:string;name:string}){
 const {request,access}=useMember(),task=useAttendanceTask(),[open,setOpen]=useState(false),[text,setText]=useState('');
 return <section><button className="secondary" onClick={()=>setOpen(v=>!v)} aria-expanded={open}>격려 메시지 보내기</button>{open?<form className="panel" onSubmit={e=>{e.preventDefault();void task.run(async()=>{await request('sendEncouragement',{toId:memberId,message:text.trim()});if(task.active()){setText('');task.setNotice(`${name}님께 격려를 보냈어요.`);}});}}><h3>{name}님께 격려</h3><p>보내는 사람: {access.name}</p><label>격려 내용<textarea value={text} disabled={task.busy} onChange={e=>setText(e.target.value)}/></label><ErrorNote message={task.error}/>{task.notice?<p role="status">{task.notice}</p>:null}<button className="primary" disabled={task.busy||!text.trim()}>격려 보내기</button></form>:null}</section>;
}
