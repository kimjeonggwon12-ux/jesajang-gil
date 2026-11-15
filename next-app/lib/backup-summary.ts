export type BackupSummary = {
  state:string; checkedAt:string; lastSuccessAt:string|null;
  verification:'completion-record-and-size'; latestAttemptAt:string|null;
};
const labels:Record<string,string>={
  healthy:'백업 완료 기록 확인', missing:'확인된 백업이 없어요', unverified:'백업 완료 확인이 필요해요',
  failed:'최근 백업이 실패했어요', running:'백업이 진행 중이에요', interrupted:'백업이 끝났는지 확인이 필요해요',
  stale:'최근 백업이 오래되었어요', overdue:'이번 주 백업 완료가 늦어지고 있어요',
  file_missing:'완료된 백업 파일을 찾지 못했어요', file_invalid:'백업 파일 확인이 필요해요',
};
const formatter=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export function backupTime(value:string|null){const date=value?new Date(value):null;return date&&!Number.isNaN(date.getTime())?formatter.format(date):'아직 확인되지 않음';}
export function backupSummaryView(summary:BackupSummary){
  const known=Object.hasOwn(labels,summary.state)&&summary.verification==='completion-record-and-size'&&Number.isFinite(Date.parse(summary.checkedAt));
  const state=known?summary.state:'unknown';
  return {title:labels[state]||'백업 상태를 확인해 주세요',warning:!['healthy','running'].includes(state)};
}
