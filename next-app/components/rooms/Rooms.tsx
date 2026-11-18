'use client';
import Link from 'next/link';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {useRoomQuery,useRoomSession} from './RoomArea';
import {ErrorNote,Loading,Modal} from '../Ui';
import {maskName} from '../../lib/status-extra';
import {cleanRoomCode,type RoomRow,type OpeningRoom} from '../../lib/rooms';
import type {Target} from '../../lib/activities';
import RoomView from './RoomView';
import ActivityAds from '../calendar/ActivityAds';
import ClassroomHeader from '../presentation/ClassroomHeader';
import OpeningRooms,{type OpeningView} from './OpeningRooms';
export default function Rooms({targetId,code,navigate}:{targetId:string;code:string;navigate:(id:string)=>void}){
  const [openingView,setOpeningView]=useState<OpeningView>({filter:{dept:'전체',regions:[],stages:[],query:'',only:false},page:1});
  const {request,session,isAdmin}=useRoomSession(),[choose,setChoose]=useState(false),[tab,setTab]=useState('mine'),[revision,setRevision]=useState(0),[joinCode,setJoinCode]=useState(code),[busy,setBusy]=useState(false),[error,setError]=useState(''),pending=useRef(false);
  useEffect(()=>{if(isAdmin&&new URLSearchParams(location.search).get('view')==='opening')setTab('opening');},[isAdmin]);
  const my=useRoomQuery<{rows:RoomRow[]}>('listMyRooms',{_revision:revision},!targetId),targets=useRoomQuery<{rows:Target[]}>('getMyTargets',{includeHistory:false,_revision:revision},!targetId&&!session.account.guest),opening=useRoomQuery<{rows:OpeningRoom[]}>('listOpeningRooms',{_revision:revision},!targetId&&isAdmin&&tab==='opening');
  async function join(event:FormEvent){event.preventDefault();if(pending.current)return;pending.current=true;setBusy(true);setError('');try{const result=await request<{targetId:string}>('joinRoomByCode',{code:cleanRoomCode(joinCode)});navigate(result.targetId);}catch(error){setError((error as Error).message);}finally{setBusy(false);pending.current=false;}}
  const missing=(targets.data?.rows||[]).filter(t=>!my.data?.rows.some(r=>r.id===t.targetId));
  function createRoom(){if(missing.length===1)navigate(missing[0].targetId);else setChoose(true);}
  if(targetId)return <RoomView key={targetId} targetId={targetId} onClose={()=>{setRevision(v=>v+1);navigate('');}}/>;
  return <section id="sec-activity">{!session.account.guest&&tab!=='opening'?<ClassroomHeader rooms/>:null}<div className={session.account.guest?'classic-guest-room-body':'classic-room-body'}><div className="page-title"><div><p className="eyebrow">함께 이어가는 기록</p><h1>피드백방</h1><p className="muted">{session.account.guest?'초대받은 방의 대화와 기록을 볼 수 있어요.':'대상자의 기록과 피드백을 담당자들과 함께 나눠요.'}</p></div><button className="secondary" onClick={()=>setRevision(v=>v+1)}>목록 새로고침</button></div>
    {!session.account.guest&&tab!=='opening'?<><ActivityAds/>{missing.length&&my.data?<button className="fbh-go" style={{margin:'10px 0 12px'}} onClick={createRoom}>지금 피드백방 만들기 <i>{missing.length}명 기다리는 중</i></button>:null}</>:null}
    <form className="tr-search" onSubmit={join}><input aria-label="초대 코드" value={joinCode} maxLength={9} autoComplete="off" autoCapitalize="characters" onChange={e=>setJoinCode(e.target.value)} placeholder="초대 코드 (예: K7P2-9QXM)"/><button disabled={busy||cleanRoomCode(joinCode).length!==8}>{busy?'입장 중…':'들어가기'}</button></form><ErrorNote message={error}/>
    {isAdmin?<nav className="tr-tabs" aria-label="피드백방 목록"><button className={tab==='mine'?'on':''} aria-pressed={tab==='mine'} onClick={()=>setTab('mine')}>참여 중인 방</button><button className={tab==='opening'?'on':''} aria-pressed={tab==='opening'} onClick={()=>setTab('opening')}>개강 피드백</button></nav>:null}

    {tab==='mine'?<><ErrorNote message={my.error} retry={my.reload}/>{my.loading?<Loading/>:<div className="classic-room-list">{my.data?.rows.map(room=><button className="tr-list-item" key={room.id} onClick={()=>navigate(room.id)}><span className="classic-room-avatar">{room.name.charAt(0)}</span><span className="m"><b>{room.name}</b><i>{room.stage} · {room.members}명{room.isOwner?' · 내 섭외자':' · 담당 '+room.teacher}</i><small>{room.last?[room.last.from,room.last.text].filter(Boolean).join(': '):'아직 글이 없어요'}</small></span>{room.unread?<span className="tr-n">{room.unread>99?'99+':room.unread}</span>:null}</button>)}{my.data&&!my.data.rows.length?<p className="tr-note">아직 들어가 있는 피드백방이 없어요.</p>:null}</div>}</>:tab==='targets'?<><ErrorNote message={targets.error} retry={targets.reload}/>{targets.loading?<Loading/>:<div className="activity-cards">{targets.data?.rows.map(target=><button className="activity-card" key={target.targetId} onClick={()=>navigate(target.targetId)}><strong>{maskName(target.targetName)}</strong><span>{target.stage} · 피드백방 열기</span></button>)}</div>}</>:<OpeningRooms result={opening} navigate={navigate} view={openingView} setView={setOpeningView}/>}
  {choose?<Modal title="💬 피드백방 만들기" variant="activity" onClose={()=>setChoose(false)}><p>누구의 피드백방을 만들까요? 누르면 방이 바로 열리고, 함께할 분을 초대할 수 있어요.</p>{missing.map(t=><button className="tr-list-item" key={t.targetId} onClick={()=>navigate(t.targetId)}>💬 {t.targetName}<span>{t.stage}</span></button>)}</Modal>:null}</div></section>;
}
