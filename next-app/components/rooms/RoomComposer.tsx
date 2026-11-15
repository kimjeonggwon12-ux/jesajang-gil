'use client';
import {useRef,useState,type FormEvent} from 'react';
import {ErrorNote} from '../Ui';
import {roomFileError,type RoomAttachment} from '../../lib/rooms';
import {roomPhoto,uploadRoomDocument} from '../../lib/room-files';
type Request=<T>(action:string,body:Record<string,unknown>)=>Promise<T>;
export default function RoomComposer({request,busy,onBusy,onSent}:{request:Request;busy:boolean;onBusy:(value:boolean)=>void;onSent:()=>Promise<void>}){
  const [text,setText]=useState(''),[pin,setPin]=useState(false),[attachments,setAttachments]=useState<RoomAttachment[]>([]),[error,setError]=useState(''),[status,setStatus]=useState('');
  const pending=useRef(false),nextId=useRef(0),fileInput=useRef<HTMLInputElement>(null);
  async function addFiles(files:File[]){if(pending.current||busy)return;pending.current=true;onBusy(true);setError('');const added:RoomAttachment[]=[];const errors:string[]=[];try{for(const file of files){if(attachments.length+added.length>=10){errors.push('첨부는 한 번에 10개까지 보낼 수 있어요.');break;}const error=roomFileError(file);if(error){errors.push(`${file.name}: ${error}`);continue;}try{added.push({id:++nextId.current,name:file.name,...(file.type.startsWith('image/')?{photo:await roomPhoto(file)}:{file})});}catch(error){errors.push((error as Error).message);}}setAttachments(rows=>[...rows,...added]);setError(errors.join(' '));}finally{pending.current=false;onBusy(false);if(fileInput.current)fileInput.current.value='';}}
  async function send(event:FormEvent){event.preventDefault();if(pending.current||busy||(!text.trim()&&!attachments.length))return;pending.current=true;onBusy(true);setError('');const jobs=attachments.length?attachments:[null],message=text.trim();let sent=0;
    try{for(let i=0;i<jobs.length;i++){const item=jobs[i];setStatus(`보내는 중 ${i+1}/${jobs.length}…`);const body:Record<string,unknown>={text:i===0?message:'',pin};if(item?.photo)body.photo=item.photo;
      if(item?.file){const uploaded=await uploadRoomDocument(item,request);setAttachments(rows=>rows.map(row=>row.id===item.id?{...row,uploaded}:row));body.file=uploaded;}
      await request('sendRoomMessage',body);sent++;if(i===0)setText('');if(item)setAttachments(rows=>rows.filter(row=>row.id!==item.id));
    }setPin(false);setStatus('보냈어요.');}catch(error){setError(`${(error as Error).message} ${sent?`${sent}건은 보냈고 나머지 첨부는 남겨 두었어요.`:'전송 결과가 불확실하면 먼저 대화를 새로고침해 확인해 주세요.'}`);setStatus('');}
    finally{try{if(sent)await onSent();}finally{pending.current=false;onBusy(false);}}
  }
  return <form className="classic-room-composer" onSubmit={send} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();void addFiles([...event.dataTransfer.files]);}}>
    <div className="room-attachments">{attachments.map(item=><div key={item.id}>{item.photo?<img src={item.photo} alt={item.name}/>:<span>{item.name} · {Math.ceil((item.file?.size||0)/1024).toLocaleString()}KB</span>}<button className="text-button" type="button" disabled={busy} onClick={()=>setAttachments(rows=>rows.filter(r=>r.id!==item.id))} aria-label={`${item.name} 첨부 빼기`}>첨부 빼기</button></div>)}</div>
    <div className="tr-in"><button type="button" className="ib" aria-label="사진·문서 첨부" title="사진·파일 첨부 (PPT·한글·PDF·사진)" disabled={busy||attachments.length>=10} onClick={()=>fileInput.current?.click()}>📎</button><input ref={fileInput} type="file" hidden multiple accept="image/*,.pdf,.ppt,.pptx,.pps,.ppsx,.hwp,.hwpx" disabled={busy||attachments.length>=10} onChange={e=>void addFiles([...e.target.files||[]])}/><textarea aria-label="대화 내용" maxLength={3000} rows={1} value={text} disabled={busy} onChange={e=>setText(e.target.value)} onPaste={event=>{const files=[...event.clipboardData.files];if(files.length){event.preventDefault();void addFiles(files);}}} placeholder={pin?'📌 고정할 중요 정보':'메시지 · 파일은 끌어다 놓아도 돼요'}/><button className="send" disabled={busy||(!text.trim()&&!attachments.length)}>{busy?'처리 중…':'보내기'}</button></div>
    <details className="classic-attachment-options"><summary>첨부 안내·중요 정보 설정</summary><label className="check-label"><input type="checkbox" checked={pin} disabled={busy} onChange={e=>setPin(e.target.checked)}/>중요 정보로 고정</label><p>첨부 10개까지 · 문서 한 개 50MB까지. 사진은 표시용 크기로 줄여 보냅니다.</p></details>
<ErrorNote message={error}/>{status?<p role="status">{status}</p>:null}
  </form>;
}
