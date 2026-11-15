'use client';
import {Suspense,useState} from 'react';
import RequiredEducationAdmin from '../../../../components/education/RequiredEducationAdmin';
import RosterAdmin from '../../../../components/roster/RosterAdmin';
import {useMember} from '../../../../components/MemberArea';
export default function Page(){const {access}=useMember(),[opened,setOpened]=useState(false);return <>{access.permissions.canManageRoster?<details className="edu-roster-box" onToggle={e=>{if(e.currentTarget.open)setOpened(true);}}><summary>📋 교사명단 <small>찾기·고치기·추가·엑셀 반영</small></summary>{opened?<Suspense fallback={<p role="status">명단을 여는 중이에요.</p>}><RosterAdmin/></Suspense>:null}</details>:null}<RequiredEducationAdmin/></>;}
