'use client';
import Link from 'next/link';
import {useMember} from '../MemberArea';
import {useQuery} from '../../lib/use-query';
import {backupSummaryView,backupTime,type BackupSummary} from '../../lib/backup-summary';

function OwnerBackupStatus(){
  const result=useQuery<BackupSummary>('getBackupSummary');
  const view=result.data?backupSummaryView(result.data):null;
  const warning=!!result.error||view?.warning===true;
  return <section className="panel" aria-labelledby="backup-summary-title" aria-busy={result.loading}>
    <h2 id="backup-summary-title">백업 상태</h2>
    <p className={warning?'error':'notice'} role={warning?'alert':'status'}>
      {result.loading?'백업 기록을 확인하고 있어요.':result.error?'백업 상태를 불러오지 못했어요. 다시 확인해 주세요.':view?.title}
    </p>
    {result.data?<><p>최근 백업 완료: <strong>{backupTime(result.data.lastSuccessAt)}</strong></p>
      <p className="muted"><small>기록 확인: {backupTime(result.data.checkedAt)} · 한국 시간</small></p>
      <p className="muted">완료 기록 기준입니다. 파일 내용은 백업 관리에서 확인할 수 있어요.</p></>:null}
    <div className="toolbar"><button className="secondary" disabled={result.loading} onClick={result.reload}>상태 다시 확인</button>
      <Link href="/admin/roster?tab=data#backup-tools">백업 관리로 이동</Link></div>
  </section>;
}

export default function BackupStatus(){
  const {access}=useMember();
  // 서버가 판정한 책임자 권한. 비대상은 컴포넌트/조회 자체를 만들지 않는다.
  return access.permissions.canViewBackupStatus===true?<OwnerBackupStatus/>:null;
}
