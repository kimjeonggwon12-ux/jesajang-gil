// 원격 A~H 엑셀 배치를 유지한다. 잘못된 인원/중복을 조용히 버려 전체 교체하지 않는다.
export const EDU_ROSTER_COLUMNS=['번호','부서','지역','구역','소속','고유번호','이름','직책'];
const fields=['dept','region','district','affiliation','member_id','name','position'];
const text=v=>String(v??'').trim();
export const eduNid=id=>text(id).replace(/\D/g,'').replace(/^0+/,'')||'0';
export function parseEduRoster(matrix){
 const rows=[],problems=[],seen=new Set();let skipped=0;
 for(let i=0;i<matrix.length;i++){
  const cells=matrix[i]||[],id=text(cells[5]);
  if(!cells.some(v=>text(v))){skipped++;continue;}
  if(id==='고유번호'||id==='고유 번호'){skipped++;continue;}
  // 제목/합계 행은 사람 정보가 없을 때만 제외한다.
  if(!id&&!text(cells[6])){skipped++;continue;}
  if(!/^\d{6,8}-?\d{4,5}$/.test(id)||eduNid(id)==='0'){problems.push(`${i+1}행: 고유번호를 확인해 주세요.`);continue;}
  const row=Object.fromEntries(fields.map((key,j)=>[key,text(cells[j+1])])),nid=eduNid(id);
  if(!row.name||!row.dept){problems.push(`${i+1}행: 이름과 부서가 필요해요.`);continue;}
  if(Object.values(row).some(v=>v.length>120)){problems.push(`${i+1}행: 너무 긴 항목이 있어요.`);continue;}
  if(seen.has(nid)){problems.push(`${i+1}행: 고유번호가 중복돼요.`);continue;}
  seen.add(nid);rows.push({...row,sort_order:rows.length+1});
 }
 if(!rows.length)problems.push('가져올 사람이 없어요. 파일과 탭을 확인해 주세요.');
 if(rows.length>10000)problems.push('한 번에 10,000명까지 가져올 수 있어요.');
 return{rows,problems,skipped};
}
export function eduRosterDelta(before,after){
 const old=new Map(before.map(r=>[eduNid(r.member_id),r])),fresh=new Map(after.map(r=>[eduNid(r.member_id),r]));
 const added=after.filter(r=>!old.has(eduNid(r.member_id))),removed=before.filter(r=>!fresh.has(eduNid(r.member_id))),changed=after.filter(r=>{const b=old.get(eduNid(r.member_id));return b&&(fields.some(k=>text(b[k])!==text(r[k]))||Number(b.sort_order)!==Number(r.sort_order));});
 return{before:before.length,after:after.length,added,removed,changed};
}
export function parsePolicyForm(form){
 const excluded_positions=[...new Set(text(form.excluded).split(/[,\n]/).map(text).filter(Boolean))];
 // 가려진 참조를 숫자로 재구성하지 않는다. 서버 공통 경계가 실제 번호로 복원한다.
 return{policy:{excluded_positions,alwaysPresent:form.present.map(memberId=>({memberId})),overrides:form.overrides.map(r=>({...r})),source_note:text(form.source)},problem:''};
}
