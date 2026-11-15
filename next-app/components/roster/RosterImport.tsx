'use client';
import {useRef,useState} from 'react';
import type {WorkBook} from 'xlsx';
import {defaultKeepIds,toggleId,type ImportChoice,type ImportList,type ImportPreview,type ImportRow,type ParsedRoster} from '../../lib/roster-import';
import {monthTabs,parse} from '../../lib/roster-excel.mjs';
import {useMember} from '../MemberArea';
import {Counts,ErrorNote,Loading,Modal} from '../Ui';

type WorkbookTools=typeof import('xlsx');
function People({title,list,selected,onSelect}:{title:string;list:ImportList;selected?:string[];onSelect?:(id:string,checked:boolean)=>void}) {
 const [query,setQuery]=useState(''),[page,setPage]=useState(1);
 const rows=list.rows.filter(row=>[row.name,row.dept,row.region].some(value=>value.includes(query))),pages=Math.max(1,Math.ceil(rows.length/50)),current=Math.min(page,pages),selectedSet=new Set(selected);
 if(!list.count)return null;
 return <section className="import-people"><h3>{title} {list.count.toLocaleString()}명</h3><label>이름·부서·지역 찾기<input type="search" value={query} onChange={event=>{setQuery(event.target.value);setPage(1);}}/></label><div className="pager"><span>{rows.length}명 · {current}/{pages}쪽</span><div><button type="button" className="secondary" disabled={current===1} onClick={()=>setPage(current-1)}>이전</button><button type="button" className="secondary" disabled={current===pages} onClick={()=>setPage(current+1)}>다음</button></div></div><div className="import-scroll">{rows.slice((current-1)*50,current*50).map(row=><div className="import-person" key={row.memberId}>{onSelect?<label className="check-label"><input type="checkbox" checked={selectedSet.has(row.memberId)} onChange={event=>onSelect(row.memberId,event.target.checked)}/><span><strong>{row.name}</strong> · {row.dept} {row.region} · {row.position||row.adminPosition||''}{row.excelName?` → ${row.excelName}`:' · 명단에 남기기'}</span></label>:<p><strong>{row.name}</strong> · {row.dept} {row.region}{row.from||row.to?` · ${row.from} → ${row.to}`:row.tier?` · ${row.tier}`:''}</p>}</div>)}</div></section>;
}
function Review({rows,source,problems,onClose,onApplied}:{rows:ImportRow[];source:string;problems:string[];onClose:()=>void;onApplied:(count:number)=>void}) {
 const {access,request}=useMember(),[choice,setChoice]=useState<ImportChoice>({applyTiers:access.permissions.canChangeTier,keepIds:[],renameIds:[]});
 const [view,setView]=useState<{data:ImportPreview;key:string}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[confirm,setConfirm]=useState(false);
 const initialized=useRef(false),pending=useRef(false),choiceKey=JSON.stringify(choice),fresh=view?.key===choiceKey;
 function change(next:ImportChoice){setChoice(next);setConfirm(false);}
 async function preview(){
  if(pending.current)return;pending.current=true;setBusy(true);setError('');setConfirm(false);
  try{let next=choice;let data=await request<ImportPreview>('previewRosterImport',{rows,...next,detailsAll:true});
   if(!initialized.current){next={...next,keepIds:defaultKeepIds(data)};if(next.keepIds.length)data=await request<ImportPreview>('previewRosterImport',{rows,...next,detailsAll:true});initialized.current=true;setChoice(next);}
   setView({data,key:JSON.stringify(next)});
  }catch(e){setError((e as Error).message);setView(null);}finally{pending.current=false;setBusy(false);}
 }
 async function apply(){
  if(pending.current||!view||!fresh)return;pending.current=true;setBusy(true);setError('');
  try{const result=await request<{after:number}>('applyRosterImport',{rows,...choice,source,expectAfter:view.data.after,expectReview:view.data.review,requireReview:true});onApplied(result.after);}
  catch(e){setError((e as Error).message);setView(null);setConfirm(false);}finally{pending.current=false;setBusy(false);}
 }
 const data=view?.data;
 return <Modal title="명단 가져오기 확인" onClose={onClose} busy={busy}><p>{source}</p><p>파일에서 {rows.length.toLocaleString()}명을 읽었습니다. 반영 전 변경 내용과 남길 사람을 확인해 주세요.</p>{problems.length?<p className="help">{problems.join(' ')}</p>:null}
  <fieldset disabled={busy||confirm}><label className="check-label"><input type="checkbox" checked={choice.applyTiers} disabled={!access.permissions.canChangeTier} onChange={event=>change({...choice,applyTiers:event.target.checked})}/>등급도 엑셀 기준으로 바꾸기</label>{!access.permissions.canChangeTier?<p className="muted">등급 반영은 전도 담당자가 합니다. 기존 등급은 유지하고 새 교사는 활동교사로 등록합니다.</p>:null}
   <button type="button" className="secondary full" onClick={preview}>{data?'고른 대로 다시 계산':'변경 내용 미리보기'}</button>
   {data?<><Counts values={{'기존 명단':data.before,'반영 후':data.after,'새로 등록':data.added.count,'명단에서 제외':data.removed.count,'남김':data.kept.count,'부서·지역 변경':data.moved.count}}/>{!fresh?<p className="notice">선택이 바뀌었습니다. 다시 계산한 뒤 반영해 주세요.</p>:null}
    <p className="help">엑셀에 없는 사람 중 직책이 있거나 관리자로 지정된 사람은 처음에 남기는 것으로 선택합니다. 다른 페이지의 선택도 함께 반영합니다. 활동·출석 기록과 관리자 명단은 그대로 유지합니다.</p>
    <People title="엑셀에 없는 사람" list={{count:data.removed.count+data.kept.count,rows:[...data.removed.rows,...data.kept.rows]}} selected={choice.keepIds} onSelect={(id,on)=>change({...choice,keepIds:toggleId(choice.keepIds,id,on)})}/>
    <People title="엑셀 이름으로 바꿀 사람 선택" list={data.renamed} selected={choice.renameIds} onSelect={(id,on)=>change({...choice,renameIds:toggleId(choice.renameIds,id,on)})}/>
    <People title="등급 차이" list={data.tierChanges}/><People title="새로 등록" list={data.added}/><People title="부서·지역 변경" list={data.moved}/><h3>반영 후 등급</h3><Counts values={data.tierTotals}/>
   </>:null}
  </fieldset><ErrorNote message={error}/>{busy?<Loading>명단을 처리하고 있어요.</Loading>:null}
  {data&&fresh?<>{confirm?<section className="confirmation"><h3>이 내용으로 명단에 반영할까요?</h3><p>{data.before.toLocaleString()}명 → {data.after.toLocaleString()}명 · 새로 등록 {data.added.count}명 · 제외 {data.removed.count}명 · 등급 변경 {choice.applyTiers?data.tierChanges.count:0}명</p><p>직전 명단을 보관하고 변경 기록을 남깁니다. 확인 후 명단이 바뀌면 반영을 중단합니다.</p><div className="toolbar"><button className="primary" disabled={busy} onClick={apply}>확인하고 명단에 반영</button><button className="secondary" disabled={busy} onClick={()=>setConfirm(false)}>취소</button></div></section>:<button className="primary full" disabled={busy} onClick={()=>setConfirm(true)}>명단에 반영</button>}</>:null}
 </Modal>;
}
export default function RosterImport(){
 const workbook=useRef<WorkBook|null>(null),tools=useRef<WorkbookTools|null>(null),pending=useRef(false);
 const [fileName,setFileName]=useState(''),[tabs,setTabs]=useState<string[]>([]),[tab,setTab]=useState(''),[parsed,setParsed]=useState<ParsedRoster|null>(null),[review,setReview]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 function readTab(value:string){setTab(value);setReview(false);setMessage('');const book=workbook.current,xlsx=tools.current;if(!book||!xlsx)return;setParsed(parse((name:string)=>book.Sheets[name]?xlsx.utils.sheet_to_json(book.Sheets[name],{header:1,defval:'',raw:true}):null,value) as ParsedRoster);}
 async function readFile(file?:File){
  if(!file||pending.current)return;pending.current=true;setBusy(true);setError('');setParsed(null);setTabs([]);setMessage('');workbook.current=null;setFileName(file.name);
  try{const [xlsx,bytes]=await Promise.all([import('xlsx'),file.arrayBuffer()]);const book=xlsx.read(bytes,{type:'array'}),months=monthTabs(book.SheetNames);if(!months.length)throw Error('“9월”처럼 달 이름으로 된 탭이 없어요. 교사관리 엑셀을 확인해 주세요.');tools.current=xlsx;workbook.current=book;setTabs(months);readTab(months[0]);}
  catch(e){setError((e as Error).message);}finally{pending.current=false;setBusy(false);}
 }
 return <section className="panel"><h2>월별 엑셀 가져오기</h2><p>행정에서 받은 교사관리 엑셀을 읽고, 변경 내용을 확인한 뒤 반영합니다.</p><label htmlFor="roster-file">엑셀 파일</label><input id="roster-file" type="file" accept=".xlsx,.xls" disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.target.value='';void readFile(file);}}/><ErrorNote message={error}/>{busy?<Loading>엑셀을 읽고 있어요.</Loading>:null}
  {tabs.length?<><p>{fileName}</p><label htmlFor="roster-sheet">읽을 탭</label><select id="roster-sheet" value={tab} disabled={busy} onChange={event=>readTab(event.target.value)}>{tabs.map(name=><option key={name}>{name}</option>)}</select></>:null}
  {parsed?<><p>{parsed.rows.length.toLocaleString()}명을 읽었습니다.</p>{parsed.problems.length?<p className="help">{parsed.problems.join(' ')}</p>:null}<button className="primary" disabled={!parsed.rows.length} onClick={()=>setReview(true)}>명단과 비교하기</button></>:null}
  {message?<p className="notice" role="status">{message}</p>:null}
  {review&&parsed?<Review rows={parsed.rows} source={`${fileName} "${tab}" 탭`} problems={parsed.problems} onClose={()=>setReview(false)} onApplied={count=>{setReview(false);setMessage(`명단에 반영했어요 — 교사 ${count.toLocaleString()}명`);}}/>:null}
 </section>;
}
