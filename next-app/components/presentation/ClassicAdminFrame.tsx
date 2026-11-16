'use client';
import type {ReactNode} from 'react';
import Link from 'next/link';
import {usePathname,useSearchParams} from 'next/navigation';
import ClassicSectionHeader from './ClassicSectionHeader';
import {useQuery} from '../../lib/use-query';
import type {EmAccess} from '../../lib/edu-mgmt';
const tabs=[['activity','활동','/admin'],['teachers','교사','/admin/required-education'],['events','행사','/calendar?tab=manage'],['attendance','출석','/admin/attendance'],['eduReport','공무결석현황','/admin/edu-report'],['opening','개강피드백','/rooms?view=opening'],['approval','지역장 승인','/centers'],['centers','선교센터','/centers?view=cohorts'],['rooms','도우미연결','/admin/reports?tab=rooms'],['education','교육 관리','/admin/education']];
export default function ClassicAdminFrame({children,isAdmin}:{children:ReactNode;isAdmin:boolean}){
 const path=usePathname(),params=useSearchParams(),em=useQuery<EmAccess>('eduMgmtAccess',{},isAdmin),shown=tabs.filter(([id])=>id!=='eduReport'||!!(em.data?.enabled&&em.data.visible));   // 11/16 교육보고는 서버가 켜짐·권한을 알려 줄 때만(A 와 같음)
 const key=path==='/admin'||path==='/status'?'activity':path.startsWith('/admin/required-education')||path.startsWith('/admin/roster')||path==='/members'?'teachers':path==='/admin/attendance'?'attendance':path==='/admin/edu-report'?'eduReport':path==='/calendar'&&['manage','report','ads'].includes(params.get('tab')||'')?'events':path==='/rooms'&&params.get('view')==='opening'?'opening':path==='/centers'?(params.get('view')==='cohorts'?'centers':'approval'):path==='/admin/reports'?'rooms':path==='/admin/education'?'education':path.startsWith('/admin')?'other':'';
 if(!isAdmin||!key)return children;
 return <section id="sec-admin"><ClassicSectionHeader title="관리자"/><nav id="admin-subtabs" className="kko-tabs l2 fit" aria-label="관리자 업무">{shown.map(([id,label,href])=><Link prefetch={false} key={id} href={href} className={'kko-tab'+(key===id?' kko-tab-active on':'')} aria-current={key===id?'page':undefined}>{label}</Link>)}</nav><div className="classic-admin-content">{children}</div><details className="classic-admin-tools"><summary>추가 관리</summary><nav className="toolbar"><Link href="/admin/education">교육 과정 운영</Link><Link href="/admin/reports">교육 재적·집계</Link><Link href="/admin/analysis">전체 현황 AI 분석</Link><Link href="/members">교사 명단</Link><Link href="/connect?tab=admin">연결 현황 관리</Link></nav></details></section>;
}
