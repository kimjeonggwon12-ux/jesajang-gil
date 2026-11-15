// 교육 관리 > 화전단·목사교 표시 함수. A(app.html EM-VIEW 블록)와 같은 결과여야 한다(tests/edu-mgmt-ui.test.mjs).
export type EmRow={key:string;label:string;n:number;came:number;onTime:number;late:number;excused:number;absent:number;rate:string;by?:Record<string,number>};
export type EmItem={kind:string;kindLabel:string;meetingId:string;title:string;date:string;sessions:string[];basis:string;basisLabel:string;scope:'all'|'dept';rows:EmRow[];total:EmRow};
export type EmWeek={week:{from:string;to:string};items:EmItem[]};
export type EmPerson={memberId:string;name:string;dept?:string;sub:string;position:string;status:string;sessions:string[];lateMin:number[]};
export type EmDetail={kind:string;meetingId:string;date:string;title:string;group:{key:string;label:string};sessions:string[];hasSub:boolean;rows:EmRow[];total:EmRow;people:EmPerson[]};
export type EmScopePerson={memberId:string;name:string;position:string;excused:boolean;source:string;reason:string;followMethod:string;followResult:string;followDone:boolean;version:number|null;updatedAt:string|null};
export type EmHistory={id:number;memberId:string;name:string;action:'register'|'update'|'cancel'|'followup';actorName:string;actorRole:string;at:string;reason:string;cancelReason:string;followMethod:string;followResult:string;followDone:boolean};
export type EmScope={kind:string;date:string;affiliation:string;role:'head'|'manager';revision:string;options:string[];people:EmScopePerson[];history:EmHistory[]};
export type EmAccess={enabled:boolean;owner?:boolean;manager?:boolean;heads?:string[];visible?:boolean};
export type EmDraft={on:boolean;reason:string;followMethod:string;cancelReason:string};
export type EmChange={memberId:string;op:'register'|'cancel';reason:string;followMethod?:string};

export const EM_HEAD=['조직','재적','참석','정시','지각','공무','불참','참석률'];
export const EM_STATUS=['참석','지각','공무','불참'];
export const EM_ACTION:Record<string,string>={register:'공무 등록',update:'사유 수정',cancel:'공무 취소',followup:'교육 결과'};
export const EM_SOURCE:Record<string,string>={dept:'부서 보고',list:'전체 명단 등록',released:'전체 화면에서 해제됨'};
export function emCells(r:EmRow){return [r.label,r.n,r.came,r.onTime,r.late,r.excused,r.absent,r.rate];}
export function emPeopleGroups(people:EmPerson[]){return EM_STATUS.map(status=>({status,people:people.filter(p=>p.status===status)})).filter(g=>g.people.length);}
export function emPersonText(p:EmPerson){return p.name+(p.status==='지각'&&p.lateMin&&p.lateMin.length?'('+p.lateMin.join('·')+'분)':'')+(p.sub?' · '+p.sub:'');}
export function emItemHead(it:EmItem){return it.kindLabel+' · '+it.date+' · '+it.title;}
export function emSessionsText(it:EmItem){return it.sessions.length>1?it.sessions.join('·')+' (두 번 온 분은 한 번)':(it.sessions[0]||'');}
export function emDraft(p:EmScopePerson):EmDraft{return {on:!!p.excused,reason:p.reason||'',followMethod:p.followMethod||'',cancelReason:''};}
export function emChanges(people:EmScopePerson[],drafts:Record<string,EmDraft>){
 const out:EmChange[]=[];
 for(const p of people){
  const d=drafts[p.memberId];if(!d)continue;
  const reason=String(d.reason||'').trim(),followMethod=String(d.followMethod||'').trim();
  if(d.on&&(!p.excused||reason!==(p.reason||'')||followMethod!==(p.followMethod||'')))out.push({memberId:p.memberId,op:'register',reason,followMethod});
  else if(!d.on&&p.excused)out.push({memberId:p.memberId,op:'cancel',reason:String(d.cancelReason||'').trim()});
 }
 return out;
}
export function emChangeProblem(changes:EmChange[]){
 if(!changes.length)return '바뀐 내용이 없어요.';
 if(changes.some(c=>c.op==='register'&&!c.reason))return '공무로 고른 사람마다 사유를 적어 주세요.';
 if(changes.some(c=>c.reason.length>300||(c.followMethod||'').length>300))return '사유와 교육 방법은 300자 이내로 적어 주세요.';
 return '';
}
export function emHistoryText(h:EmHistory){
 const who=h.actorName+'('+(h.actorRole==='head'?'부서장':'교육 담당')+')';
 const what=h.action==='cancel'?(h.cancelReason?' — '+h.cancelReason:''):h.action==='followup'?' — '+(h.followMethod||'')+(h.followResult?' / '+h.followResult:'')+(h.followDone?' (완료)':''):' — '+h.reason;
 return String(h.at||'').slice(0,16).replace('T',' ')+' · '+who+' · '+h.name+' '+EM_ACTION[h.action]+what;
}
export const emToday=()=>new Date(Date.now()+9*3600e3).toISOString().slice(0,10);
