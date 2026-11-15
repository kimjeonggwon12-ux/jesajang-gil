'use client';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import ClassicIcon from './ClassicIcon';
import {ClassicAccountActions,ClassicAccountLink} from './ClassicIdentity';
export default function ClassroomHeader({rooms=false}:{rooms?:boolean}){
 const router=useRouter();
 return <><div className="act-appbar"><h1 className="act-appbar-title room-name"><span className="room-ic"><ClassicIcon name="activity"/></span>나의 교실</h1><div className="act-appbar-actions"><ClassicAccountActions/><Link prefetch={false} href="/device#notifications" title="알림 설정" aria-label="알림 설정"><ClassicIcon name="bell"/></Link><ClassicAccountLink className="classic-classroom-account"><ClassicIcon name="account"/></ClassicAccountLink></div></div>
 <nav className="l2" id="actTabs" aria-label="나의 교실"><button type="button" className={!rooms?'on':''} aria-current={!rooms?'page':undefined} onClick={()=>router.push('/activities')}>내 활동 보고</button><button type="button" className={rooms?'on':''} aria-current={rooms?'page':undefined} onClick={()=>router.push('/rooms')}>피드백방</button></nav></>;
}
