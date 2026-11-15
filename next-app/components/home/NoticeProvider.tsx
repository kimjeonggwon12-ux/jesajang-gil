'use client';
import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {usePathname} from 'next/navigation';
import Link from 'next/link';
import {readApi} from '../../lib/api';
import {loadSession,type Session} from '../../lib/session';
import {initialSeen,acceptNoticeIndex,parseSeen,noticeKey,noticeCounts,openNotice,type NoticeIndex,type NoticePage,type Seen} from '../../lib/home-notices';
type State={token:string;data:NoticeIndex;seen:Seen};
type Context={data:NoticeIndex|null;counts:ReturnType<typeof noticeCounts>|null;error:string;loading:boolean;refresh:()=>void;open:(page:NoticePage)=>void;isNew:(page:'board'|'story'|'etc',at:string)=>boolean};
const Notices=createContext<Context|null>(null);
export const useNotices=()=>{const v=useContext(Notices);if(!v)throw Error('알림 제공자가 필요합니다.');return v;};
export function useNoticeOpened(page:NoticePage|null,ready:boolean){const n=useNotices();useEffect(()=>{if(page&&ready&&n.data)n.open(page);},[page,ready,n.open,n.data?.at]);}
export function NoticeProvider({children}:{children:ReactNode}){
 const path=usePathname(),[owner,setOwner]=useState<Session|null>(null),[state,setState]=useState<State|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),refreshRef=useRef<(force?:boolean)=>void>(()=>{}),opened=useRef<Partial<Record<NoticePage,string>>>({});
 useEffect(()=>{const sync=()=>{const s=loadSession();setOwner(old=>old?.token===s?.token?old:s);};sync();window.addEventListener('storage',sync);window.addEventListener('ts-session-change',sync);return()=>{window.removeEventListener('storage',sync);window.removeEventListener('ts-session-change',sync);};},[]);
 useEffect(()=>{opened.current={};refreshRef.current(false);},[path]);
 useEffect(()=>{
  setState(null);setError('');opened.current={};if(!owner||owner.account.guest||owner.token.startsWith('g')){refreshRef.current=()=>{};return;}
  let live=true,running=false,last=0;
  const refresh=async(force=false)=>{if(!live||running||document.hidden||(!force&&Date.now()-last<5*60e3))return;running=true;last=Date.now();setBusy(true);setError('');try{const data=await readApi<NoticeIndex>('getNoticeIndex',owner.token);if(data.error)throw Error(data.error);if(!live||loadSession()?.token!==owner.token)return;setState(previous=>{let seen=previous?.token===owner.token?previous.seen:null;try{seen=seen||parseSeen(localStorage.getItem(noticeKey(owner.account.memberId)));}catch{}if(!seen){seen=initialSeen(data);try{const old=JSON.parse(localStorage.getItem('kko_seen_coach_replies_'+owner.account.memberId)||'[]');if(Array.isArray(old))seen.replies=old.filter(x=>typeof x==='string');}catch{}}return{token:owner.token,data,seen:acceptNoticeIndex(data,seen)};});}catch(e){if(live&&loadSession()?.token===owner.token){setState(null);setError(e instanceof Error?e.message:'알림을 읽지 못했어요.');}}finally{running=false;if(live)setBusy(false);}};
  refreshRef.current=refresh;void refresh();const visible=()=>{if(!document.hidden)void refresh();};document.addEventListener('visibilitychange',visible);const timer=setInterval(visible,5*60e3);return()=>{live=false;clearInterval(timer);document.removeEventListener('visibilitychange',visible);refreshRef.current=()=>{};};
 },[owner?.token]);
 useEffect(()=>{if(state&&owner&&state.token===owner.token&&loadSession()?.token===owner.token)try{localStorage.setItem(noticeKey(owner.account.memberId),JSON.stringify(state.seen));}catch{}},[state,owner]);
 const open=useCallback((page:NoticePage)=>{setState(old=>{if(!old||loadSession()?.token!==old.token)return old;if(['board','story','etc'].includes(page)&&!opened.current[page])opened.current[page]=old.seen[page as 'board'|'story'|'etc'];const seen=openNotice(old.data,old.seen,page);return JSON.stringify(seen)===JSON.stringify(old.seen)?old:{...old,seen};});},[]);
 const valid=state?.token===owner?.token&&state?.token===loadSession()?.token?state:null;
 const value:Context={data:valid?.data||null,counts:valid?noticeCounts(valid.data,valid.seen):null,error,loading:!!owner&&(!valid&&!error||busy),refresh:()=>refreshRef.current(true),open,isNew:(page,at)=>!!valid&&!!at&&at>(opened.current[page]||valid.seen[page])};
 return <Notices.Provider value={value}>{children}</Notices.Provider>;
}
export function NoticeLink(){const {data,counts}=useNotices(),total=data&&counts?data.encouragements+data.connect.total+data.marks.room+data.center.toDecide+data.center.toSend+data.center.unread+counts.coach+counts.board+counts.story+counts.etc+Number(counts.library)+Number(counts.find)+Number(counts.helps):0;return <Link href="/?view=notices#notices">알림{total?' '+total:''}</Link>;}
