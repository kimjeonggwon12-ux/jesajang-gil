'use client';
import {useEffect,useRef,useState} from 'react';
import {useMember} from '../MemberArea';
import {ErrorNote,Modal} from '../Ui';
import {canEditEvent,eventHost,eventRange,intentKey,repeats,type CalendarEvent,type CalendarData} from '../../lib/calendar';
import EventCheers from './EventCheers';
import EventSignups from './EventSignups';
export default function EventDetail({event,data,onClose,onEdit,onChanged,initialTab='info'}:{event:CalendarEvent;data:CalendarData;initialTab?:string;onClose:()=>void;onEdit:()=>void;onChanged:()=>void}){
  const {session,request}=useMember(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[deleting,setDeleting]=useState(false),[intent,setIntent]=useState(''),[tab,setTab]=useState(initialTab==='attendees'?'signup':initialTab),pending=useRef(false),officialEvent=event.category==='공식'&&event.type==='행사';
  useEffect(()=>{try{setIntent(localStorage.getItem(intentKey(event))||'');}catch{}},[event]);
  function chooseIntent(value:string){try{localStorage.setItem(intentKey(event),value);setIntent(value);}catch{setError('기기에 참석 예정 표시를 저장하지 못했어요.');}}
  async function erase(){if(pending.current)return;pending.current=true;setBusy(true);setError('');try{await request('deleteCalendarEvent',{eventId:event.eventId});onChanged();onClose();}catch(error){setError((error as Error).message);}finally{pending.current=false;setBusy(false);}}
  return <Modal title={event.title} busy={busy} onClose={onClose}><p className="muted">{event.category} · {eventRange(event)}{event.place?' · '+event.place:''}</p><nav className="tabs"><button className="secondary" disabled={busy} aria-pressed={tab==='info'} onClick={()=>setTab('info')}>일정 안내</button>{officialEvent?<button className="secondary" disabled={busy} aria-pressed={tab==='signup'} onClick={()=>setTab('signup')}>스탭·참석자 신청</button>:null}</nav>
    <div hidden={tab!=='info'}>{eventHost(event)?<p>주관: {eventHost(event)}</p>:null}{event.contactName||event.contactPhone?<p>문의: {event.contactName} {event.contactPhone?<a href={'tel:'+event.contactPhone.replace(/[^0-9+]/g,'')}>{event.contactPhone}</a>:null}</p>:null}{[['대상자',event.audience],['어떻게',event.method],['목적',event.purpose],['안내',event.desc]].map(([label,value])=>value?<section key={label}><h3>{label}</h3><p className="pre-wrap">{value}</p></section>:null)}
      {event.category!=='내일정'?<><h3>참석 예정</h3><p className="muted">이 기기에만 남기는 표시예요. 행사 신청은 별도로 해 주세요.</p><div className="toolbar">{[['yes','참석'],['maybe','미정'],['no','불참']].map(([value,label])=><button className="secondary" key={value} aria-pressed={intent===value} disabled={busy} onClick={()=>chooseIntent(value)}>{label}</button>)}</div></>:null}
      {canEditEvent(event,data,session.account.memberId)?<div className="toolbar"><button className="secondary" disabled={busy} onClick={onEdit}>일정 수정</button><button className="text-button danger" disabled={busy} onClick={()=>setDeleting(true)}>일정 삭제</button></div>:null}
      {event.category!=='내일정'?<EventCheers eventId={event.eventId} busy={busy} onBusy={setBusy} onChanged={onChanged}/>:null}
    </div>
    {officialEvent&&tab==='signup'?<EventSignups initialMode={initialTab==='attendees'?'attendees':'staff'} eventId={event.eventId} busy={busy} onBusy={setBusy} onChanged={onChanged}/>:null}
    {deleting?<div className="panel" role="alert"><p>{repeats(event)?'반복 일정 전체':'이 일정'}와 스탭·참석 신청이 함께 삭제됩니다. 되돌릴 수 없습니다.</p><button className="secondary" disabled={busy} onClick={()=>setDeleting(false)}>취소</button><button className="primary danger" disabled={busy} onClick={()=>void erase()}>일정 삭제 확인</button></div>:null}<ErrorNote message={error}/>
  </Modal>;
}
