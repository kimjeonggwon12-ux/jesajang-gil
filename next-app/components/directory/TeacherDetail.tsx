'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {useQuery} from '../../lib/use-query';
import {scheduleText,type Teacher} from '../../lib/directory';
import {useMember} from '../MemberArea';
import {Counts,ErrorNote,Loading,Modal} from '../Ui';
import {DETAIL_GROUPS,teacherExtraFields,educationSummary,type RequiredEducation} from '../../lib/directory-detail';
import {EncouragementComposer} from '../home/Encouragements';

type LeaderReview={review:string;before:{position:string};after:{position:string}};
type Card={dept:string;region:string;roles:string[];targets:string[];fields:string[];schedType:string;from:string;to:string;days:string[];times:string[];intro:string;phone:string;expired:boolean};

const POSITIONS=['회장','총무','지역장','섭외 교관','복음방 교관','교육부장','전도부장','전도과장','전도팀장','서기','전도 과장','교육 과장','교관','총교관','교육부'];
export default function TeacherDetail({teacher,onClose,onChanged}:{teacher:Teacher;onClose:()=>void;onChanged:()=>void}) {
 const {access,request,refreshAccess}=useMember(),card=useQuery<{card:Card|null}>('getConnectCard',{memberId:teacher.memberId}),edu=useQuery<RequiredEducation>('getRequiredEducation',{memberId:teacher.memberId});
 const [position,setPosition]=useState(teacher.position),[busy,setBusy]=useState(false),[error,setError]=useState(''),[review,setReview]=useState<LeaderReview|null>(null),pending=useRef(false),reviewRef=useRef<HTMLDivElement>(null);
 const education=edu.data?educationSummary(edu.data):null;
 const change={memberId:teacher.memberId,name:teacher.name,dept:teacher.dept,region:teacher.region,position,expected:{name:teacher.name,dept:teacher.dept,region:teacher.region,position:teacher.position}};
 useEffect(()=>{if(review)reviewRef.current?.focus();},[review]);
 async function assign(save=false){
  if(pending.current||save&&!review)return;pending.current=true;setBusy(true);setError('');
  try{
   if(!save)setReview(await request<LeaderReview>('previewRosterLeader',change));
   else{await request('upsertRosterLeader',{...change,review:review!.review,confirmed:true});onChanged();await refreshAccess().catch(()=>{});onClose();}
  }catch(e){setError((e as Error).message);setReview(null);}finally{pending.current=false;setBusy(false);}
 }
 return <Modal title={`${teacher.name} 교사`} onClose={onClose} busy={busy}>
  <dl className="detail-list">{Object.entries({'부서·지역':[teacher.dept,teacher.region].filter(Boolean).join(' · '),'소속':teacher.affiliation,'직책':teacher.position,'교사 구분':teacher.tier,'최근 변경':teacher.tierChangedAt,'마지막 활동':teacher.lastActivityDate,'활동 신청':scheduleText(teacher.apply),'비고':teacher.note}).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value||'-'}</dd></div>)}</dl>
  <dl className="counts"><div><dt>센터 등록(명단)</dt><dd>{teacher.regLeads??'-'}</dd></div><div><dt>센터 미등록</dt><dd>{teacher.unregLeads??'-'}</dd></div></dl>
  <dl className="detail-list">{Object.entries(teacherExtraFields(teacher)).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
  <Counts values={{'이번 달 활동':teacher.monthlyCount,'지난 달 활동':teacher.prevCount,'누적 활동':teacher.actTotal,'최근 1년 인도':teacher.leads1y,'출석(1개월)':teacher.attend1m,'사례':teacher.cases}}/>
  {teacher.caseRank?<p>{teacher.dept} 사례 {teacher.caseRank}위</p>:null}
  <p className="help">{teacher.conditionText}</p>{teacher.suggestion?<p className="suggestion">제안: {teacher.suggestion.suggestedTier} — {teacher.suggestion.reason}</p>:null}
  <h3>활동 항목별 · 이번 달 / 누적</h3><dl className="detail-list">{DETAIL_GROUPS.map(([group,description])=><div key={group}><dt title={description}>{group}</dt><dd><strong>{teacher.groupsMonth?.[group]||0}</strong> / {teacher.groups?.[group]||0}건</dd></div>)}</dl>
  <h3>활동 항목별 기록</h3><Counts values={teacher.actTypes}/>
  <h3>연결 명함</h3><ErrorNote message={card.error} retry={card.reload}/>{card.loading?<Loading/>:card.data?.card?<dl className="detail-list">{Object.entries({'소속':[card.data.card.dept,card.data.card.region].filter(Boolean).join(' · '),'가능 역할':card.data.card.roles?.join(' · '),'가능 대상':card.data.card.targets?.join(' · '),'전문 분야':card.data.card.fields?.join(' · '),'일정':[card.data.card.schedType,card.data.card.from,card.data.card.to,card.data.card.days?.join('·'),card.data.card.times?.join('·'),card.data.card.expired?'기간 지남':''].filter(Boolean).join(' · '),'소개':card.data.card.intro,'연락처':card.data.card.phone}).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value||'-'}</dd></div>)}</dl>:!card.error?<p className="muted">아직 등록한 명함이 없어요.</p>:null}
  <Link className="secondary" href={`/connect?with=${encodeURIComponent(teacher.memberId)}`}>전체 명함 · 개인 대화</Link>
  <EncouragementComposer memberId={teacher.memberId} name={teacher.name}/>
  <h3>이수교육</h3><ErrorNote message={edu.error} retry={edu.reload}/>{edu.loading?<Loading/>:edu.data&&education?<><p>{education.completed} / {education.total} 과목 이수</p><dl className="detail-list">{education.categories.map(category=>{const value=edu.data?.[category];const date=typeof value==='object'&&value!==null?String((value as {date?:string}).date||'이수'):typeof value==='string'?(value||'미이수'):value?'이수':'미이수';return <div key={category}><dt>{category}</dt><dd>{date}</dd></div>;})}</dl></>:null}
  {access.permissions.canManageRoster?<section className="panel"><h3>직책 지정</h3><label htmlFor="leader-position">직책</label><select id="leader-position" value={position} onChange={e=>{setPosition(e.target.value);setReview(null);}} disabled={busy}><option value="">직책 없음</option>{POSITIONS.map(p=><option key={p}>{p}</option>)}</select><ErrorNote message={error}/>{review?<div ref={reviewRef} tabIndex={-1}><p>{teacher.name}님의 직책: {review.before.position||'없음'} → {review.after.position||'없음'}</p><button className="primary" disabled={busy} onClick={()=>assign(true)}>{busy?'저장 중…':'변경 확인'}</button><button className="secondary" disabled={busy} onClick={()=>setReview(null)}>취소</button></div>:<button className="secondary" disabled={busy||position===teacher.position} onClick={()=>assign()}>{busy?'확인 중…':'직책 변경'}</button>}{error?<button className="secondary" disabled={busy} onClick={()=>{onChanged();onClose();}}>명단 다시 조회</button>:null}</section>:null}
 </Modal>;
}
