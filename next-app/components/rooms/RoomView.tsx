'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useRoomSession} from './RoomArea';
import {ErrorNote,Loading,Modal} from '../Ui';
import RoomMedia from './RoomMedia';
import {mergeRoomMessages,roomUnread,type Room,type RoomMessage} from '../../lib/rooms';
import RoomComposer from './RoomComposer';
import RoomMembers from './RoomMembers';
import RoomRecords from './RoomRecords';
export default function RoomView({targetId,onClose}:{targetId:string;onClose:()=>void}){
  const {request}=useRoomSession(),[room,setRoom]=useState<Room|null>(null),[tab,setTab]=useState('chat'),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[deleting,setDeleting]=useState<RoomMessage|null>(null),[recordOpened,setRecordOpened]=useState(false),[hasEntered,setHasEntered]=useState(false);
  const alive=useRef(true),reading=useRef(false),fullPending=useRef(false),writing=useRef(false),current=useRef<Room|null>(null),initial=useRef(true),last=useRef(0),pane=useRef<HTMLDivElement>(null),nearBottom=useRef(true),tabRef=useRef(tab);tabRef.current=tab;
  const call=useCallback(<T,>(action:string,body:Record<string,unknown>={})=>request<T>(action,{...body,targetId}),[request,targetId]);
  const load=useCallback(async(full=false):Promise<void>=>{
    if(!alive.current)return;if(reading.current){if(full)fullPending.current=true;return;}reading.current=true;
    try{let nextFull=full||!current.current;for(let page=0;page<5;page++){
      const data=await call<Room>('getTargetRoom',nextFull?{}:{afterId:last.current});if(!alive.current)return;
      const value=nextFull?data:{...current.current!,...data,messages:mergeRoomMessages(current.current!.messages,data.messages)};
      current.current=value;last.current=value.messages.at(-1)?.id||0;setRoom(value);setHasEntered(true);setError('');
      if(initial.current){initial.current=false;if((data.isOwner&&data.members.length<=1)||(data.canManage&&!data.isOwner&&data.crew.some(p=>!p.joined&&p.key)))setTab('members');}
      if(nextFull||data.messages.length<200)break;nextFull=false;
    }}catch(error){if(alive.current){setError((error as Error).message);setRoom(null);current.current=null;}}
    finally{reading.current=false;if(alive.current){setLoading(false);if(fullPending.current){fullPending.current=false;queueMicrotask(()=>void load(true));}}}
  },[call]);
  useEffect(()=>{alive.current=true;void load(true);const poll=()=>{if(!document.hidden&&tabRef.current==='chat'&&!writing.current)void load();};const timer=setInterval(poll,15000);document.addEventListener('visibilitychange',poll);window.addEventListener('focus',poll);return()=>{alive.current=false;clearInterval(timer);document.removeEventListener('visibilitychange',poll);window.removeEventListener('focus',poll);};},[load]);
  useEffect(()=>{if(pane.current&&nearBottom.current)pane.current.scrollTop=pane.current.scrollHeight;},[room?.messages.at(-1)?.id,tab]);
  function setWorking(value:boolean){writing.current=value;setBusy(value);}
  function exit(){if(alive.current)onClose();}
  async function run(work:()=>Promise<void>){if(writing.current)return;setWorking(true);setError('');try{await work();if(alive.current)await load(true);}catch(error){if(alive.current)setError((error as Error).message);}finally{if(alive.current)setWorking(false);}}
  function message(row:RoomMessage){const unread=roomUnread(row,room?.reads||[]),role=room?.members.find(m=>m.key===row.fk)?.role;return <article className={'tr-msg'+(row.mine?' mine':'')} key={row.id}><div className="tr-who">{row.from||'알림'}{role==='관리자'?<span className="tr-adm">관리자 피드백</span>:null}</div><div className={'tr-bub'+(row.deleted?' del':row.pinned?' pinned':'')}>{row.deleted?'지운 글이에요.':<>{row.pinned?<strong>📌 중요 정보</strong>:null}<div className="pre-wrap">{row.text}</div>{row.photo?<RoomMedia targetId={targetId} id={row.id} kind="photo" name="대화사진.jpg"/>:null}{row.file?<RoomMedia targetId={targetId} id={row.id} kind="file" name={row.file.name}/>:null}</>}</div><div className="tr-meta">{unread?<span className="tr-unread">{unread} </span>:null}{row.at}</div>{!row.deleted&&(row.from||row.mine)?<details className="classic-message-actions"><summary>메시지 메뉴</summary><div className="tr-acts"><button disabled={busy} onClick={()=>void run(async()=>{await call('pinRoomMessage',{id:row.id,pinned:!row.pinned});})}>{row.pinned?'📌 고정 풀기':'📌 고정'}</button>{row.text?<button onClick={async()=>{try{await navigator.clipboard.writeText(row.text);setNotice('글을 복사했어요.');}catch{setError('글을 선택해 복사해 주세요.');}}}>글 복사</button>:null}{row.mine||room?.isOwner?<button className="red" disabled={busy} onClick={()=>setDeleting(row)}>글 지우기</button>:null}</div></details>:null}</article>;}
  const recordTabs=['info','acts','stageFb','plans','hearts','master','history','infoFeedback'];
  return <div className="tr-layer"><div className="tr-bar"><button type="button" aria-label="방 목록" disabled={busy} onClick={exit}>‹</button><div className="tr-t"><b>💬 {room?.target.name||'피드백방'}</b><small>{room?[room.target.stage,room.target.gender,room.target.ageGroup,`${room.members.length}명`].filter(Boolean).join(' · '):''}</small></div><button type="button" aria-label="대화 새로고침" disabled={busy||loading} onClick={()=>void load(true)}>↻</button></div><ErrorNote message={error}/>{notice?<p role="status">{notice}</p>:null}{loading?<Loading/>:null}
    {room?<><nav className="tr-tabs" aria-label="방 메뉴">{[['members',`👥 초대 ${room.members.length}`],['chat','💬 대화'],['info','🗂 정보 기록'],['acts','📝 활동 이력'],['stageFb','📈 단계향상 피드백'],['plans',`🧭 ${room.target.goalMonth?room.target.goalMonth+'월 ':''}센터 인도 계획`],['hearts','❤️ HEARTS 상세피드백'],['master','🧠 종합 피드백']].map(([value,label])=><button disabled={busy} key={value} className={tab===value?'on':''} aria-pressed={tab===value} onClick={()=>{setTab(value);if(recordTabs.includes(value))setRecordOpened(true);if(value==='members')void load(true);}}>{label}</button>)}</nav>
      <div className="tr-body" ref={pane} onScroll={()=>{if(pane.current)nearBottom.current=pane.current.scrollHeight-pane.current.scrollTop-pane.current.clientHeight<100;}}>
       <div hidden={tab!=='chat'}><button className="tr-pinbar" onClick={()=>setTab('pins')}>📌 중요 정보 {room.pins.length}개</button><div role="log" aria-label="대화 내용 목록" aria-live="polite">{room.messages.map(message)}{!room.messages.length?<div className="tr-note">아직 글이 없어요.<br/>이 섭외자에 관한 <b>중요 정보</b>는 여기서 나누세요.{room.isOwner?<><br/>맨 앞 <b>👥 초대</b> 칸에서 함께할 분을 초대할 수 있어요.</>:null}</div>:null}</div></div>
       {tab==='pins'?<section><h2>중요 정보 {room.pins.length}개</h2>{room.pins.map(message)}{!room.pins.length?<p className="tr-note">고정한 글이 없어요. 대화에서 중요한 글의 메뉴를 열고 📌 고정을 누르세요.</p>:null}</section>:null}
       {recordOpened?<div hidden={!recordTabs.includes(tab)}><RoomRecords targetId={targetId} view={recordTabs.includes(tab)?tab as 'info'|'acts'|'stageFb'|'plans'|'hearts'|'master'|'history'|'infoFeedback':'info'}/></div>:null}
       {tab==='members'?<RoomMembers room={room} busy={busy} request={call} run={run} onExit={exit}/>:null}
      </div>
    </>:null}
    {hasEntered?<div hidden={!room||tab!=='chat'}><RoomComposer request={call} busy={busy||!room} onBusy={setWorking} onSent={async()=>{nearBottom.current=true;await load(true);}}/></div>:null}
    {deleting?<Modal title="이 글을 지울까요?" busy={busy} onClose={()=>setDeleting(null)}><p>본문과 첨부가 제거되고 지운 글 표시가 남습니다. 되돌릴 수 없습니다.</p><div className="toolbar"><button className="secondary" disabled={busy} onClick={()=>setDeleting(null)}>취소</button><button className="primary danger" disabled={busy} onClick={()=>void run(async()=>{await call('deleteRoomMessage',{id:deleting.id});setDeleting(null);})}>글 삭제</button></div></Modal>:null}
  </div>;
}
