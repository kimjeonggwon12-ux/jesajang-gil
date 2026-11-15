'use client';
import {createContext,useContext,type ReactNode} from 'react';
import Link from 'next/link';
import ClassicIcon from './ClassicIcon';
type Identity={name:string;tier?:string;logout:()=>void;openAccount?:()=>void};
const Context=createContext<Identity|null>(null);
export function ClassicIdentity({children,...identity}:Identity&{children:ReactNode}){return <Context.Provider value={identity}>{children}</Context.Provider>;}
export function useClassicIdentity(){return useContext(Context);}
export function ClassicAccountLink({children,className}:{children:ReactNode;className?:string}){const identity=useClassicIdentity();return <Link prefetch={false} href="/account" className={className} aria-label="내 계정" onClick={e=>{if(identity?.openAccount){e.preventDefault();identity.openAccount();}}}>{children}</Link>;}
export function ClassicAccountActions(){const identity=useClassicIdentity();return <span className="classic-mobile-account"><Link className="hdr-inst" prefetch={false} href="/device#install"><ClassicIcon name="install"/>앱 설치</Link><button type="button" className="classic-home" aria-label="홈으로 (처음부터 다시)" onClick={()=>identity?.logout()}><ClassicIcon name="home"/></button><ClassicAccountLink className="hdr-me"><span className="classic-account-label"><b>{identity?.name}</b>{identity?.tier?<small>{identity.tier==='휴교사'?'⚪':identity.tier==='활동교사'?'🟡':identity.tier==='정교사'?'🟢':'💎'}{identity.tier}</small>:null}</span><ClassicIcon name="account"/></ClassicAccountLink></span>;}
