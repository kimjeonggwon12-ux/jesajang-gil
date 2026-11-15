// 기존 미참여자 엑셀의 세 시트·부서 범위·표시값을 공용 계약으로 유지한다.
export const NON_PART_LABELS={act:'미활동 교사',edu:'교육 불참 교사',both:'활동·교육 모두 0회'};
export function nonParticipantRows(report,kind,dept='') {
  return (report.rows||[]).filter(row=>(kind==='both'?row.inactive&&row.noEdu:kind==='edu'?row.noEdu:row.inactive)&&(!dept||row.dept===dept));
}
export function nonParticipantSheets(report,dept='') {
  return ['act','edu','both'].map(kind=>{
    const people=nonParticipantRows(report,kind,dept);
    return {name:{act:'미활동',edu:'교육불참',both:'모두0회'}[kind],rows:[
      [`${NON_PART_LABELS[kind]} (${report.from} ~ ${report.asOf})${dept?' · '+dept:''} ${people.length}명`],[],
      ['번호','이름','부서','지역','등급','이번 달 활동','이번 달 교육'],
      ...people.map((row,index)=>[index+1,row.name,row.dept,row.region||'',row.tier||'',row.inactive?'0건':'있음',row.noEdu?'0번':'있음']),
    ]};
  });
}
