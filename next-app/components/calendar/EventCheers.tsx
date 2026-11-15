'use client';
import {useRef,useState,type FormEvent} from 'react';
import {useMember} from '../MemberArea';
import {ErrorNote,Loading} from '../Ui';
import {useQuery} from '../../lib/use-query';
import {imageSource} from '../../lib/activity-photo';
import {calendarPhoto} from '../../lib/calendar-photo';
import type {Cheer} from '../../lib/calendar';
export default function EventCheers({eventId,busy,onBusy,onChanged}:{eventId:string;busy:boolean;onBusy:(v:boolean)=>void;onChanged:()=>void}){
  const {request,access}=useMember(),result=useQuery<{rows:Cheer[]}>('getEventCheers',{eventId}),pending=useRef(false),[text,setText]=useState(''),[photos,setPhotos]=useState<string[]>([]),[error,setError]=useState(''),[remove,setRemove]=useState('');
  async function pick(files:File[]){if(pending.current||busy)return;pending.current=true;onBusy(true);setError('');try{const added:string[]=[];for(const file of files.slice(0,4-photos.length)){if(!file.type.startsWith('image/'))throw Error('사진 파일을 골라 주세요.');added.push(await calendarPhoto(file));}setPhotos(p=>[...p,...added]);}catch(error){setError((error as Error).message);}finally{pending.current=false;onBusy(false);}}
  async function send(e:FormEvent){e.preventDefault();if(pending.current||busy||(!text.trim()&&!photos.length))return;pending.current=true;onBusy(true);setError('');try{await request('saveEventCheer',{eventId,body:text.trim(),photos});setText('');setPhotos([]);result.reload();onChanged();}catch(error){setError((error as Error).message);}finally{pending.current=false;onBusy(false);}}
  async function erase(){if(pending.current||busy)return;pending.current=true;onBusy(true);try{await request('deleteEventCheer',{cheerId:remove});setRemove('');result.reload();onChanged();}catch(error){setError((error as Error).message);}finally{pending.current=false;onBusy(false);}}
  return <section><h3>응원·행사 사진</h3><ErrorNote message={result.error} retry={result.reload}/>{result.loading?<Loading/>:result.data?.rows.map(row=><article className="panel" key={row.cheerId}><p className="muted">{row.name} · {row.dept} · {row.createdAt}</p><p className="pre-wrap">{row.body}</p><div className="photo-grid">{row.photos.map(url=><a key={url} href={url} target="_blank" rel="noreferrer"><img alt="행사 사진 · 원본 보기" src={imageSource(url,960)} loading="lazy" onError={e=>{if(!e.currentTarget.dataset.original){e.currentTarget.dataset.original='true';e.currentTarget.src=url;}}}/></a>)}</div>{row.isMine||access.isAdmin?<button className="text-button danger" disabled={busy} onClick={()=>setRemove(row.cheerId)}>응원 삭제</button>:null}</article>)}
    <form onSubmit={send}><fieldset disabled={busy}><label>응원 내용<textarea rows={3} value={text} maxLength={500} onChange={e=>setText(e.target.value)}/></label><div className="room-attachments">{photos.map((photo,i)=><div key={photo}><img src={photo} alt={`첨부 사진 ${i+1}`}/><button type="button" className="text-button" onClick={()=>setPhotos(p=>p.filter((_,n)=>n!==i))}>사진 빼기</button></div>)}</div><label>사진 첨부 · 최대 4장<input type="file" accept="image/*" multiple disabled={busy||photos.length>=4} onChange={e=>{void pick([...e.target.files||[]]);e.target.value='';}}/></label><button className="primary" disabled={!text.trim()&&!photos.length}>응원 남기기</button></fieldset></form>
    {remove?<div className="panel"><p>응원과 사진을 화면에서 지울까요?</p><button className="secondary" disabled={busy} onClick={()=>setRemove('')}>취소</button><button className="primary danger" disabled={busy} onClick={()=>void erase()}>응원 삭제 확인</button></div>:null}<ErrorNote message={error}/>
  </section>;
}
