'use client';
// 관리자 > 교육보고(출석 옆) — A app.html 의 eduReport 탭과 같은 화면(화전단·목사교 주간 출석 현황 + 부서 공무 사전보고).
import EduMgmt from '../../../../components/education/EduMgmt';
import {useQuery} from '../../../../lib/use-query';
import {ErrorNote,Loading} from '../../../../components/Ui';
import type {EmAccess} from '../../../../lib/edu-mgmt';
export default function Page(){const em=useQuery<EmAccess>('eduMgmtAccess');if(em.error)return <ErrorNote message={em.error} retry={em.reload}/>;if(!em.data)return <Loading/>;return em.data.enabled&&em.data.visible?<EduMgmt access={em.data}/>:<section className="panel"><h1>공무결석현황</h1><p>{em.data.enabled?'교육 담당자나 지정된 부서장만 사용할 수 있어요.':'공무결석현황 기능이 아직 꺼져 있어요.'}</p></section>;}
