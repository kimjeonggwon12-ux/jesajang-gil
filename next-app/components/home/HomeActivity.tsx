'use client';
import {useMember} from '../MemberArea';
import {useQuery} from '../../lib/use-query';
import type {ActivitySummary,Target} from '../../lib/activities';
import {ErrorNote,Loading} from '../Ui';
import ActivityRoleSummary from '../activities/ActivityRoleSummary';
export default function HomeActivity({version}:{version:number}){
 const {session}=useMember(),summary=useQuery<ActivitySummary>('getMyActivities',{summary:true,aggregate:true,includeRecent:false,_revision:version}),targets=useQuery<{rows:Target[];stages:string[]}>('getMyTargets',{includeHistory:false,_revision:version});
 return <><ErrorNote message={summary.error} retry={summary.reload}/><ErrorNote message={targets.error} retry={targets.reload}/>{summary.loading||targets.loading?<Loading>역할별 활동을 확인하고 있어요.</Loading>:null}{summary.data&&targets.data?<ActivityRoleSummary summary={summary.data} targets={targets.data.rows} stages={targets.data.stages} memberId={session.account.memberId}/>:null}</>;
}
