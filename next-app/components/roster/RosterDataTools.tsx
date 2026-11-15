'use client';
import {useRef,useState,type FormEvent} from 'react';
import {downloadBase64} from '../../lib/download';
import {useQuery} from '../../lib/use-query';
import {useMember} from '../MemberArea';
import {ErrorNote,Loading,Modal} from '../Ui';

type Backup={name:string;sizeKB:number;createdAt:string};
type BackupHealth={state:string;checkedAt:string;lastSuccessAt:string|null;latestAttempt:{status:string;stage?:string}|null};
const backupStates:Record<string,string>={healthy:'정상',missing:'확인된 백업 없음',unverified:'이전 파일만 있음 · 완료 확인 필요',failed:'최근 백업 실패',running:'백업 진행 중',interrupted:'백업 완료 응답 없음',stale:'최근 성공 후 8일 경과',file_invalid:'저장 파일 검증 실패',file_missing:'완료 기록의 파일 없음'};
const backupTime=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const displayTime=(value:string)=>{const date=new Date(value);return Number.isNaN(date.getTime())?'확인 필요':backupTime.format(date);};
function Backups(){
 const result=useQuery<{rows:Backup[];health:BackupHealth}>('getBackups');
 return <><ErrorNote message={result.error} retry={result.reload}/>{result.loading?<Loading/>:null}{result.data?<><div role="status"><p>백업 상태: {backupStates[result.data.health.state]||'확인 필요'}</p><p>마지막 확인된 성공: {result.data.health.lastSuccessAt?displayTime(result.data.health.lastSuccessAt)+' (한국 시간)':'아직 없음'}</p><p className="help">파일 점검 시각: {displayTime(result.data.health.checkedAt)} (한국 시간). 예약 실행 표시와 실제 파일 완료를 구분합니다.</p></div><button className="secondary" disabled={result.loading} onClick={result.reload}>상태 다시 확인</button><div className="table-wrap"><table className="data-table"><caption>보관 중인 백업</caption><thead><tr><th>생성일 (한국 시간)</th><th>파일</th><th>크기</th></tr></thead><tbody>{result.data.rows.map(row=><tr key={row.name}><td>{displayTime(row.createdAt)}</td><td>{row.name}</td><td>{row.sizeKB.toLocaleString()} KB</td></tr>)}</tbody></table>{!result.data.rows.length?<p className="empty">보관된 백업이 없어요.</p>:null}</div></>:null}</>;
}
export default function RosterDataTools(){
 const {request,access}=useMember(),[dialog,setDialog]=useState<'export'|'backup'|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[made,setMade]=useState<{name:string;sizeKB:number;rows:number;tables:number;url:string;retentionWarning?:boolean}|null>(null),[showList,setShowList]=useState(false),[version,setVersion]=useState(0);
 const pending=useRef(false),canBackup=access.permissions.canManageBackup===true;
 async function download(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(pending.current)return;pending.current=true;setBusy(true);setError('');const form=event.currentTarget;
  try{const result=await request<{fileName:string;base64:string}>('exportRosterSheet',{password:String(new FormData(form).get('password'))});downloadBase64(result.fileName,result.base64);setDialog(null);}
  catch(e){setError((e as Error).message);}finally{const input=form.elements.namedItem('password');if(input instanceof HTMLInputElement)input.value='';pending.current=false;setBusy(false);}
 }
 async function backup(){
  if(pending.current)return;pending.current=true;setBusy(true);setError('');
  try{const result=await request<NonNullable<typeof made>>('createBackup');const url=new URL(result.url,location.origin);if(url.protocol!=='https:'&&!(url.protocol==='http:'&&url.hostname==='127.0.0.1'))throw Error('백업 파일 주소를 확인하지 못했어요.');setMade(result);setVersion(v=>v+1);}
  catch(e){setError((e as Error).message);}finally{pending.current=false;setBusy(false);}
 }
 function open(value:'export'|'backup'){setError('');setMade(null);setDialog(value);}
 return <section className="panel" id="backup-tools"><h2>명단 다운로드{canBackup?'·백업':''}</h2><p>원본 명단 엑셀은 전체 명단의 15개 항목을 담습니다.{canBackup?' 전체 자료 백업은 명단 외 활동·계정 자료도 함께 포함합니다.':''}</p><div className="toolbar"><button className="secondary" onClick={()=>open('export')}>원본 명단 엑셀 받기</button>{canBackup?<><button className="secondary" onClick={()=>open('backup')}>전체 자료 백업</button><button className="secondary" aria-expanded={showList} onClick={()=>setShowList(value=>!value)}>보관 중인 백업 {showList?'닫기':'보기'}</button></>:null}</div>{canBackup&&showList?<Backups key={version}/>:null}
  {dialog&&(dialog==='export'||canBackup)?<Modal title={dialog==='export'?'원본 명단 엑셀':'전체 자료 백업'} busy={busy} onClose={()=>setDialog(null)}>{dialog==='export'?<form onSubmit={download}><fieldset disabled={busy}><p>검색어나 현재 페이지와 관계없이 전체 교사 명단을 받습니다. 다운로드 권한·비밀번호를 확인하고 기록을 남깁니다.</p><label htmlFor="raw-roster-password">다운로드 비밀번호</label><input id="raw-roster-password" name="password" type="password" autoComplete="off" required/><ErrorNote message={error}/><button className="primary full">{busy?'만드는 중…':'엑셀 받기'}</button></fieldset></form>:made?<><p role="status">저장된 백업 파일을 확인했어요. {made.tables}개 표 · {made.rows.toLocaleString()}건 · {made.sizeKB.toLocaleString()} KB</p>{made.retentionWarning?<p role="alert">파일은 저장했지만 과거 백업 정리는 확인이 필요해요.</p>:null}<a className="primary download-link" href={made.url} download={made.name}>백업 파일 받기</a><p className="help">이 링크는 10분 동안 사용할 수 있어요. 계정·개인 정보가 포함되어 있으므로 담당자만 보관해 주세요.</p></>:<><p>현재 자료 전체를 백업하고 보관합니다. 확인된 최근 백업 8개를 유지합니다. 이전 미확인 파일은 자동으로 지우지 않습니다.</p><p className="help">이 작업은 현재 명단을 변경하지 않습니다. 명단을 되돌릴 필요가 있으면 복구 담당자에게 요청해 주세요.</p><ErrorNote message={error}/><button className="primary full" disabled={busy} onClick={backup}>{busy?'백업 만드는 중…':'확인하고 백업 만들기'}</button></>}</Modal>:null}
 </section>;
}
