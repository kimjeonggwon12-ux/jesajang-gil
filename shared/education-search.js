// 원본 이수 관리의 이름/고유번호 부분 일치·명단 순서·8명·부서 원문 구분을 유지한다.
// 응답에서 번호를 가리기 전에 서버에서 검색한다. 브라우저에서 r_ 참조를 풀지 않는다.
/** @template {{memberId:string,name:string,dept:string}} T @param {T[]} rows @param {string} query @param {string} dept */
export function educationCandidates(rows,query,dept) {
 const q=query.trim();if(!q)return [];
 const main=['교역자','자문회','장년회','부녀회','청년회'];
 return rows.filter(r=>(String(r.memberId||'').includes(q)||String(r.name||'').includes(q))&&(!dept||(main.includes(r.dept)?r.dept:'기타')===dept)).slice(0,8);
}
