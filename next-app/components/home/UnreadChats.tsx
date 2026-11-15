'use client';
import {useState} from 'react';
import {useQuery} from '../../lib/use-query';
import {ErrorNote,Loading,Modal} from '../Ui';
import PrivateChat from '../connect/PrivateChat';
import {useNotices} from './NoticeProvider';
type Chat={chatId:string;otherId:string;otherName:string;otherDept:string;otherRegion:string;lastMessage:string;lastAt:string;unreadCount:number};
// 폐지된 대화함 탭을 복원하지 않고 홈에서 아직 읽지 않은 상대만 선택한다.
export default function UnreadChats({onClose}:{onClose:()=>void}){
 const result=useQuery<{rows:Chat[]}>('getChatList'),[chat,setChat]=useState<Chat|null>(null),[limit,setLimit]=useState(30),n=useNotices(),rows=(result.data?.rows||[]).filter(r=>r.unreadCount>0);
 if(chat)return <PrivateChat key={chat.chatId} otherId={chat.otherId} name={chat.otherName} onClose={()=>{setChat(null);result.reload();n.refresh();}}/>;
 return <Modal title="읽지 않은 개인 대화" onClose={onClose}><button className="secondary" onClick={result.reload}>목록 새로고침</button><ErrorNote message={result.error} retry={result.reload}/>{result.loading?<Loading/>:<><div className="activity-cards">{rows.slice(0,limit).map(r=><button className="activity-card" key={r.chatId} onClick={()=>setChat(r)}><strong>{r.otherName||'교사'} · 안 읽은 글 {r.unreadCount}개</strong><span>{r.otherDept} {r.otherRegion}</span><span>{r.lastMessage}</span><small>{r.lastAt}</small></button>)}</div>{!rows.length&&!result.error?<p>읽지 않은 개인 대화가 없어요.</p>:null}{rows.length>limit?<button className="secondary" onClick={()=>setLimit(v=>v+30)}>더 보기</button>:null}</>}</Modal>;
}
