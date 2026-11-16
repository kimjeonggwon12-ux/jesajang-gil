// 교육 관리 > 화전단·목사교 표시 함수. A(app.html EM-VIEW 블록)와 같은 결과여야 한다(tests/edu-mgmt-ui.test.mjs).
export type EmRow={key:string;label:string;n:number;came:number;onTime:number;late:number;excused:number;absent:number;rate:string;by?:Record<string,number>};
export type EmItem={kind:string;kindLabel:string;meetingId:string;title:string;date:string;sessions:string[];basis:string;basisLabel:string;scope:'all'|'dept';rows:EmRow[];total:EmRow};
export type EmWeek={week:{from:string;to:string};items:EmItem[]};
export type EmPerson={memberId:string;name:string;dept?:string;sub:string;position:string;status:string;sessions:string[];lateMin:number[];selfReason?:string};
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
export function emPersonText(p:EmPerson){return p.name+(p.status==='지각'&&p.lateMin&&p.lateMin.length?'('+p.lateMin.join('·')+'분)':'')+(p.sub?' · '+p.sub:'')+(p.selfReason?' · 본인 신고: '+p.selfReason:'');}
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

// 11/16(4차): 두 교육 테마 + 공무자 관리 줄(A EM-VIEW 블록과 같음)
export const EM_THEME:Record<string,{icon:string;title:string;cls:string}>={화전단:{icon:'🔥',title:'화요 전도단',cls:'tue'},목사교:{icon:'📖',title:'목요 사명자 교육',cls:'thu'}};
export type ExlRow={memberId:string;name:string;group:string;place:string;source:string;registeredBy:string;reason:string;attended:boolean|null;at?:string};
export type ExlList={kind:string;kindLabel:string;date:string;meeting:{title:string;date:string}|null;rows:ExlRow[];counts:{total:number;self:number;admin:number;list:number;attended:number}};
export type ExlHit={memberId:string;name:string;group:string;place:string;position:string};
export function exlPlaceText(r:{group:string;place:string}){return r.group+(r.place?' · '+r.place:'');}
export function exlSourceText(r:ExlRow){return r.source+(r.registeredBy?' ('+r.registeredBy+')':'');}
export function exlStatusText(r:ExlRow){return (r.reason?'사유: '+r.reason:'사유 없음')+(r.attended===true?' · 그날 출석함(참석으로 셈)':r.attended===false?' · 미출석':'');}
export function exlCountsText(L:ExlList){return '공무 '+L.counts.total+'명 · 본인 신고 '+L.counts.self+' · 관리자 등록 '+L.counts.admin+' · 도우미연결 '+L.counts.list+(L.meeting?' · 그날 출석 '+L.counts.attended+'명':'');}
// 11/16(5차): 교자장부청 + 24부서 묶음, 가까운 교육 날짜(A EM-VIEW 블록과 같음)
export const EXL_GROUPS:[string,string][]=[['교역자','교'],['장로·자문회','자'],['장년회','장'],['부녀회','부'],['청년회','청'],['24부서','24부서']];
export function exlGroups(rows:ExlRow[]){
 const known=EXL_GROUPS.map(g=>g[0]);
 const out=EXL_GROUPS.map(([key,short])=>({key,short,rows:rows.filter(r=>r.group===key)}));
 const etc=rows.filter(r=>known.indexOf(r.group)<0);
 if(etc.length)out.push({key:'기타',short:'기타',rows:etc});
 return out;
}
// 11/16(6차): 탭을 열면 더 가까운 교육부터(같은 날이면 목요 사명자 교육)
export function emNextKind(today:string){return emNextDate('화전단',today)<emNextDate('목사교',today)?'화전단':'목사교';}
export function emNextDate(kind:string,today:string){
 const want=kind==='화전단'?2:4;
 for(let i=0;i<7;i++){const d=new Date(Date.parse(today+'T00:00:00Z')+i*864e5);if(d.getUTCDay()===want)return d.toISOString().slice(0,10);}
 return today;
}
