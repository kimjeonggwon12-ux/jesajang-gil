'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import type {Target} from '../../lib/activities';
import type {RoomRow} from '../../lib/rooms';
import {useQuery} from '../../lib/use-query';
import {Modal} from '../Ui';
export default function ClassicRoomPrompt({targets,version}:{targets:Target[];version:number}){
 const router=useRouter(),[choose,setChoose]=useState(false),rooms=useQuery<{rows:RoomRow[]}>('listMyRooms',{_revision:version},targets.length>0);
 const need=rooms.data?targets.filter(t=>!rooms.data!.rows.some(r=>r.id===t.targetId)):[];
 const open=(id:string)=>router.push('/rooms?target='+encodeURIComponent(id));
 return <><span>{rooms.data&&targets.length&&!need.length?<>✅ 모든 섭외자의 <b>피드백방</b>이 있어요. 방에서 교관·지역장님과 계속 나눠 주세요!</>:<>💬 섭외자를 등록했다면 <b>피드백방</b>을 꼭 만드세요! 교관·지역장님과 함께하면 열매가 빨라져요.</>}</span>
 {need.length?<button className="fbn-b" onClick={()=>need.length===1?open(need[0].targetId):setChoose(true)}>💬 피드백방 만들기 · {need.length}명 아직 없어요 ›</button>:null}
 {choose?<Modal title="💬 피드백방 만들기" onClose={()=>setChoose(false)}><p>누구의 피드백방을 만들까요? 누르면 방이 바로 열리고, 함께할 분을 초대할 수 있어요.</p><div className="activity-cards">{need.map(t=><button className="secondary" key={t.targetId} onClick={()=>open(t.targetId)}>💬 {t.targetName||'섭외자'} · {t.stage}</button>)}</div></Modal>:null}</>;
}
