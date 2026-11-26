'use client';
import Link from 'next/link';
import {ClassicAccountLink} from './ClassicIdentity';
import {useEffect,useState} from 'react';
import {usePathname,useSearchParams,useRouter} from 'next/navigation';
import {classicNav,classicSection} from '../../lib/classic-navigation.mjs';
import {useNotices} from '../home/NoticeProvider';
import ClassicIcon,{type ClassicIconName} from './ClassicIcon';
export default function ClassicNavigation({name,tier,isAdmin,logout}:{name:string;tier?:string;isAdmin:boolean;logout:()=>void}){
 const notice=useNotices(),counts=notice.counts,index=notice.data;
 // 11/24(사용자): 새로 바뀐 '함께' 탭 — 한 번 열어 보기 전까지 N(A 와 같은 localStorage 열쇠)
 const [joinSeen,setJoinSeen]=useState(true);
 useEffect(()=>{try{setJoinSeen(!!localStorage.getItem('ts_join_seen_v1'));}catch{}},[]);
 const badges:Record<string,number|string>={calendar:counts?.board||0,story:counts?.story||0,join:counts?.etc||(joinSeen?0:'N'),connect:index?.connect.total||0,activity:index?.marks.room||0,ai:counts?.coach||0,textbook:counts?.library?'N':0};
 const path=usePathname(),search=useSearchParams(),active=classicSection(path,search.toString()),items=classicNav(isAdmin),plaza=['calendar','story','join'].includes(active),title=items.find(i=>i.id===active)?.label||'교사광장',router=useRouter(),[q,setQ]=useState(search.get('q')||'');
 useEffect(()=>{if(active==='join'&&!joinSeen){try{localStorage.setItem('ts_join_seen_v1','1');}catch{}setJoinSeen(true);}},[active,joinSeen]);
 useEffect(()=>{setQ(search.get('q')||'');},[active,search]);
 return <><header className="dk-nav"><div className="dk-nav-in"><Link href="/calendar" prefetch={false} className="dk-logo">{plaza?<><span className="room-ic"><ClassicIcon name={active as ClassicIconName}/></span>{title}</>:<><i>✦</i>교사광장</>}</Link><nav className="pz-gnb" aria-label="주 메뉴">{items.map(item=><Link key={item.id} prefetch={false} href={item.href} className={active===item.id?'on':''} aria-current={active===item.id?'page':undefined}>{item.label}{badges[item.id]?<small className="classic-nav-badge">{badges[item.id]}</small>:null}</Link>)}</nav>{plaza?<form className="classic-desktop-search" style={active==='calendar'?{visibility:'hidden'}:undefined} onSubmit={e=>{e.preventDefault();const p=new URLSearchParams(search.toString());p.set('section',search.get('section')||(active==='join'?'questions':'story'));if(q.trim())p.set('q',q.trim());else p.delete('q');router.push('/community?'+p.toString());}}><input type="search" aria-label="게시글 검색" placeholder="검색" value={q} maxLength={40} onChange={e=>setQ(e.target.value)}/><button type="submit" aria-label="검색">⌕</button></form>:null}<Link href="/device#install" prefetch={false} className="hdr-inst"><ClassicIcon name="install"/>앱 설치</Link><button className="classic-home" title="홈으로 (처음부터 다시)" aria-label="홈으로 (처음부터 다시)" onClick={logout}><ClassicIcon name="home"/></button><ClassicAccountLink className="dk-acc"><span className="classic-account-label"><b>{name}</b>{tier?<small>{tier==='휴교사'?'⚪':tier==='활동교사'?'🟡':tier==='정교사'?'🟢':tier==='우수교사'?'💎':''} {tier}</small>:null}</span><ClassicIcon name="account"/></ClassicAccountLink></div></header>
 <nav id="bottomTabBar" aria-label="모바일 주 메뉴">{items.map(item=><Link prefetch={false} key={item.id} href={item.href} className={'tab'+(active===item.id?' tab-active':'')} aria-label={item.label} aria-current={active===item.id?'page':undefined}><span className="tab-icon"><ClassicIcon name={item.id as ClassicIconName}/>{badges[item.id]?<small className="classic-nav-badge mobile">{badges[item.id]}</small>:null}</span><span className="tab-label">{item.label}</span></Link>)}</nav></>;
}
