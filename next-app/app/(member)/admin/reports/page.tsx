'use client';
import {useEffect,useState} from 'react';
import ExcusedAdmin from '../../../../components/report-admin/ExcusedAdmin';
import EduRosterAdmin from '../../../../components/report-admin/EduRosterAdmin';
import ReportRoomsAdmin from '../../../../components/report-admin/ReportRoomsAdmin';
import DeliveryReview from '../../../../components/report-admin/DeliveryReview';
import {useMember} from '../../../../components/MemberArea';
export default function Page(){const [tab,setTab]=useState('roster'),{access}=useMember();useEffect(()=>{const t=new URLSearchParams(location.search).get('tab');if(['roster','rooms','excused'].includes(t||''))setTab(t!);},[]);return <><div className="att-actions"><button className={tab==='roster'?'primary':'secondary'} onClick={()=>setTab('roster')}>교육 재적·집계</button><button className={tab==='rooms'?'primary':'secondary'} onClick={()=>setTab('rooms')}>Telegram 보고방</button><button className={tab==='excused'?'primary':'secondary'} onClick={()=>setTab('excused')}>공무 사전보고</button>{access.permissions.canManageBackup?<button className={tab==='delivery'?'primary':'secondary'} onClick={()=>setTab('delivery')}>전달 확인 필요</button>:null}</div>{tab==='roster'?<EduRosterAdmin/>:tab==='rooms'?<ReportRoomsAdmin/>:tab==='delivery'?<DeliveryReview/>:<ExcusedAdmin/>}</>;}
