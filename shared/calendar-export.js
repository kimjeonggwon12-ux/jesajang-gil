// 기존 8열과 BOM을 유지하되 스프레드시트 수식 실행은 막는다.
const csvCell = value => {
  let text = String(value ?? '');
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
};
export function calendarCsv(attendees) {
  const header = ['신청자','신청자부서','신청자역할','섭외자','섭외자부서','나이','전도단계','행사'];
  return '\ufeff' + [header.join(','), ...attendees.map(a => [a.applicantName,a.applicantDept,a.applicantRole,a.guestName,a.guestDept,a.guestAge,a.guestStage,a.eventTitle].map(csvCell).join(','))].join('\n');
}
