'use client';
import ClassicSectionHeader from '../presentation/ClassicSectionHeader';
import ClassicContact from '../presentation/ClassicContact';
import {useEffect,useState} from 'react';
import {useMember} from '../MemberArea';
import {useQuery} from '../../lib/use-query';
import {ErrorNote,Loading} from '../Ui';
import {emptyConnectCard,type ConnectCard} from '../../lib/connect';
import CardEditor from './CardEditor';
import CardSearch from './CardSearch';
import CardDetail from './CardDetail';
import HelpBoard from './HelpBoard';
import ConnectionAdmin from './ConnectionAdmin';
import PrivateChat from './PrivateChat';
import {takeEntry} from '../../lib/entry-handoff';
import {useNotices} from '../home/NoticeProvider';
type Tab='mine'|'find'|'helps'|'admin';
function MyCard({onChanged}:{onChanged:()=>void}){const {access,session}=useMember(),result=useQuery<{card:ConnectCard|null;name?:string;dept?:string;region?:string}>('getConnectCard',{memberId:session.account.memberId}),[saved,setSaved]=useState<ConnectCard|null>(null);return <><ErrorNote message={result.error} retry={result.reload}/>{result.loading?<Loading/>:result.data?<CardEditor initial={saved||result.data.card||{...emptyConnectCard(result.data.name||access.name),dept:result.data.dept||'',region:result.data.region||''}} exists={!!(saved||result.data.card)} onChanged={onChanged} onSaved={card=>{setSaved(card);onChanged();}} onRemoved={()=>{setSaved(null);result.reload();onChanged();}}/>:null}</>;}
export default function Connect(){
 const notices=useNotices();
 const {access,session}=useMember(),[revision,setRevision]=useState(0),[tab,setTab]=useState<Tab>('find'),[visited,setVisited]=useState<Tab[]>(['find']),[profile,setProfile]=useState(''),[chat,setChat]=useState<{id:string;name:string;text?:string}|null>(null);
 useEffect(()=>{const params=new URLSearchParams(location.search),target=params.get('with');if(target)setProfile(target);const t=params.get('tab');if(t==='mine'||t==='find'||t==='helps'||t==='admin'&&access.isAdmin)change(t);const draft=takeEntry('chat',session.token);if(draft)setChat(draft);},[]);
 function change(value:Tab){setTab(value);setVisited(v=>v.includes(value)?v:[...v,value]);}
 function openChat(id:string,name:string,text?:string){setProfile('');setChat({id,name,text});}
 return <section id="sec-connect"><ClassicSectionHeader title="연결"/><nav id="topTabs" className="kko-tabs l2 fit" aria-label="연결 메뉴">{([['mine','내 명함'],['find','활동신청자'],['helps','도와주세요']] as [Tab,string][]).map(([key,label])=><button key={key} className={tab===key?'on':''} aria-pressed={tab===key} onClick={()=>change(key)}>{label}{key==='find'&&notices.counts?.find||key==='helps'&&notices.counts?.helps?' N':''}</button>)}</nav><ClassicContact part="apply"/><div className="cn-wrap">{!chat&&visited.includes('mine')?<div hidden={tab!=='mine'}><MyCard onChanged={()=>setRevision(v=>v+1)}/></div>:null}{!chat&&visited.includes('find')?<div hidden={tab!=='find'}><CardSearch onOpen={setProfile} revision={revision} active={tab==='find'}/></div>:null}{!chat&&visited.includes('helps')?<div hidden={tab!=='helps'}><HelpBoard onChat={openChat} active={tab==='helps'}/></div>:null}{!chat&&visited.includes('admin')&&access.isAdmin?<div hidden={tab!=='admin'}><ConnectionAdmin onCard={setProfile}/></div>:null}{chat?<PrivateChat inline key={chat.id} otherId={chat.id} name={chat.name} initialText={chat.text} onClose={()=>setChat(null)}/>:null}</div>{profile?<CardDetail key={profile} memberId={profile} onClose={()=>setProfile('')} onChat={openChat}/>:null}</section>;
}
