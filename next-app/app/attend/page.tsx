import {Suspense} from 'react';
import AttendanceEntry from '../../components/attendance/AttendanceEntry';
export default function Page(){return <Suspense fallback={<main className="login-page"><p>출석 화면을 여는 중이에요.</p></main>}><AttendanceEntry/></Suspense>;}
