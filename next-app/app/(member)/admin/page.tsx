'use client';
import Link from 'next/link';
import BackupStatus from '../../../components/backup/BackupStatus';
import {useMember} from '../../../components/MemberArea';
import StatusDashboard from '../../../components/status/StatusDashboard';
export default function AdminHome(){const {access}=useMember();if(!access.isAdmin)return <section className="panel"><h1>업무 관리</h1><p>관리자 권한이 필요한 화면이에요.</p><Link href="/activities">내 활동으로 이동</Link></section>;return <><BackupStatus/><StatusDashboard/></>;}
