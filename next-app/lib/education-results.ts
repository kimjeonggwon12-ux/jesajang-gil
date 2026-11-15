import {shortDate,weekday,type CourseSheet} from './education.ts';
export const visibleStudentId=(id:string)=>id.startsWith('r_')?'보호됨':id;
export function scoreResults(s:CourseSheet){
 const columns=s.exams.map((exam,index)=>({exam,index})).sort((a,b)=>a.exam.date.localeCompare(b.exam.date));
 const mean=(values:number[])=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
 const rows=s.rows.map(student=>{const values=columns.map(c=>student.scores[c.index]).filter((v):v is number=>v!=null);return{student,average:mean(values),taken:values.length,rank:null as number|null};}).sort((a,b)=>(b.average??-1)-(a.average??-1)||(a.student.seq||0)-(b.student.seq||0));
 let rank=0,previous:number|null=null;rows.forEach((r,i)=>{if(r.average!=null){if(r.average!==previous)rank=i+1;previous=r.average;r.rank=rank;}});
 const all=columns.flatMap(c=>s.rows.map(r=>r.scores[c.index])).filter((v):v is number=>v!=null);
 return{columns,rows,averages:columns.map(c=>mean(s.rows.map(r=>r.scores[c.index]).filter((v):v is number=>v!=null))),average:mean(all),taken:all.length,subjects:[...new Set(s.exams.map(e=>e.subject))]};
}
type Cell=string|number|null;
export function educationWorkbook(s:CourseSheet,today:string){
 const sheets:{name:string;rows:Cell[][]}[]=[],day=(d:string)=>`${shortDate(d)}(${weekday(d)})`,score=scoreResults(s),rounded=(v:number|null)=>v==null?'':Math.round(v*10)/10;
 const add=(name:string,rows:Cell[][],title=name)=>sheets.push({name,rows:[[s.cohort.title+' '+title],['작성 '+today],[],...rows]});
 add('종합', [['번호','교회','이름','고유번호','출석','과제',...s.assignments.map(a=>'과제 '+a.title),...s.exams.map(e=>shortDate(e.date)+' '+e.subject)],...s.rows.map(r=>[r.seq,r.church,r.name,visibleStudentId(r.memberId),`${r.attended}/${r.held}`,`${r.submitted}/${r.expected}`,...r.perAssign,...r.scores.map(v=>v??'')])],'종합 보고');
 const classes=s.dates.map((date,index)=>({date,index})).filter(c=>s.classDates.includes(c.date));
 add('출석부',[['번호','교회','이름',...classes.map(c=>day(c.date))],...s.rows.map(r=>[r.seq,r.church,r.name,...classes.map(c=>r.attend[c.index]||'결석')])]);
 add('과제 제출 현황',[['번호','교회','이름',...s.dates.map(day)],...s.rows.map(r=>[r.seq,r.church,r.name,...r.daily])]);
 const exams:Cell[][]=[];
 if(score.columns.length){exams.push(['['+score.subjects.join(' · ')+']'],['순위','번호','이름','교회',...score.columns.map(({exam:e})=>day(e.date)+(score.columns.filter(c=>c.exam.date===e.date).length>1?' '+e.subject:'')),'응시','평균']);for(const x of score.rows)exams.push([x.rank??'-',x.student.seq,x.student.name,x.student.church,...score.columns.map(c=>x.student.scores[c.index]??'미응시'),`${x.taken}/${score.columns.length}`,rounded(x.average)]);exams.push(['','','평균(당일)','',...score.averages.map(rounded),score.taken+'회',rounded(score.average)]);}
 add('시험 결과',exams,'시험 결과 및 순위');
 add('결석·빠진 교육',[['날짜','요일','교회','이름','구분','내용','빠진 교육'],...s.absences.map(a=>[a.date,weekday(a.date),a.church,a.name,a.type,a.text,a.missed])],'결석 및 빠진 교육');
 add('과제 내용',[['날짜','과제','교회','이름','제출 시각','늦음','경로','내용'],...(s.submissions||[]).map(s=>[s.workDate,s.title||'',s.church||'',s.name,s.at,s.late?'늦음':'',s.source,s.content||''])],'과제 제출 내용');
 return sheets;
}
