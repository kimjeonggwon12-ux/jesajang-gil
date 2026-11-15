'use client';
import {ClassicAccountActions} from './ClassicIdentity';
import ClassicIcon from './ClassicIcon';
export default function ClassicSectionHeader({title}:{title:string}){return <div className="kko-header"><h1 className="kko-title room-name"><span className="room-ic"><ClassicIcon name={title==='AI상담'?'ai':title==='관리자'?'admin':title==='연결'?'connect':'textbook'}/></span>{title}</h1><ClassicAccountActions/></div>;}
