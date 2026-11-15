'use client';
import {useEffect,useRef,useState} from 'react';
import {useNoticeOpened} from '../home/NoticeProvider';
import ClassicInstallCard from '../presentation/ClassicInstallCard';
import ClassicContact from '../presentation/ClassicContact';
import ClassicPlazaHeader from '../presentation/ClassicPlazaHeader';
import Community from '../community/Community';
import {useMember} from '../MemberArea';
import {useCalendarForReminders} from '../entry/AppRuntime';
import {useQuery} from '../../lib/use-query';
import {ErrorNote,Loading,Modal} from '../Ui';
import {CAL_DAYS,CAL_VIEWS,calendarDate,dateObject,eventsOn,eventPrefix,eventRange,isNewEvent,monthWeeks,shiftDate,upcomingEvents,type CalendarData,type CalendarEvent} from '../../lib/calendar';
import EventDetail from './EventDetail';
import EventEditor from './EventEditor';
import WeekEditor from './WeekEditor';
import CalendarAds from './CalendarAds';
import CalendarReport from './CalendarReport';
import CalendarEventList from './CalendarEventList';
const empty:CalendarData={rows:[],weeks:[],deptManager:'',official:false};
export default function Calendar(){
  const {access,session}=useMember(),result=useQuery<CalendarData>('getCalendarEvents'),data=result.data||empty;
  const [today]=useState(()=>calendarDate(new Date())),[month,setMonth]=useState(()=>new Date().getFullYear()*12+new Date().getMonth()),[view,setView]=useState(''),[tab,setTab]=useState('calendar'),[more,setMore]=useState(false),[day,setDay]=useState(''),[selected,setSelected]=useState<CalendarEvent|null>(null),[editor,setEditor]=useState<{event?:CalendarEvent;category:string}|null>(null),[week,setWeek]=useState(''),[selectedTab,setSelectedTab]=useState('info');
  const [folds,setFolds]=useState({cal:true,week:true,up:false});useEffect(()=>{try{setFolds(old=>({...old,...JSON.parse(localStorage.getItem('pz_fold')||'{}')}));}catch{}},[]);
  useNoticeOpened('board',!!result.data&&!result.error);
 useEffect(()=>{const mode=new URLSearchParams(location.search).get('tab');if(access.isAdmin&&['manage','report','ads'].includes(mode||''))setTab(mode!);},[access.isAdmin]);
 const linked=useRef(false);useEffect(()=>{if(!result.data||linked.current)return;linked.current=true;const id=new URLSearchParams(location.search).get('event'),event=result.data.rows.find(e=>e.eventId===id);if(event)setSelected(event);},[result.data]);
 const year=Math.floor(month/12),m=month%12,weekStart=shiftDate(today,-dateObject(today).getDay()),canDept=data.deptManager==='all'||!!view&&data.deptManager===view;
  function fold(key:keyof typeof folds){const next={...folds,[key]:!folds[key]};setFolds(next);try{localStorage.setItem('pz_fold',JSON.stringify(next));}catch{}}
  function move(delta:number){setMonth(value=>value+delta);}
  const eventButton=(event:CalendarEvent,date?:string)=><button className={`calendar-event ${event.category==='부서'?'department':event.category==='내일정'?'personal':'official'}`} key={event.eventId} onClick={()=>{setSelectedTab('info');setSelected(event);}}>{event.highlight?'● ':''}{date?date+' · ':''}{eventPrefix(event,view)} {event.title}{isNewEvent(event)?<small> NEW</small>:null}</button>;
  useCalendarForReminders(session.token,result.data);
  return <section id="sec-calendar"><ClassicPlazaHeader title="일정·광고"/><div className="pz-wrap">
    {access.isAdmin?<details className="classic-calendar-tools" open={tab!=='calendar'}><summary>일정 관리</summary><nav className="tabs"><button className="secondary" aria-pressed={tab==='calendar'} onClick={()=>setTab('calendar')}>일정·광고</button><button className="secondary" aria-pressed={tab==='manage'} onClick={()=>setTab('manage')}>전체 일정 관리</button><button className="secondary" aria-pressed={tab==='ads'} onClick={()=>setTab('ads')}>전도부 광고</button><button className="secondary" aria-pressed={tab==='report'} onClick={()=>setTab('report')}>행사 집계·부서 현황</button></nav></details>:null}
    {tab==='manage'?<><ErrorNote message={result.error} retry={result.reload}/>{result.loading?<Loading/>:<CalendarEventList events={data.rows} onSelect={e=>{setSelectedTab('info');setSelected(e);}}/>}</>:tab==='report'?<CalendarReport events={data.rows}/>:tab==='ads'?<CalendarAds/>:<>
      <ErrorNote message={result.error} retry={result.reload}/>{result.loading?<Loading/>:<>
        <div className="pz-evs">{data.rows.filter(e=>e.category==='공식'&&e.type==='행사'&&(e.endDate||e.startDate)>=today).sort((a,b)=>a.startDate.localeCompare(b.startDate)).slice(0,3).map(e=><article className="pz-ev" key={e.eventId}><div className="pz-ev-top"><span className="pz-ev-tag">🙋 신청 받는 행사{isNewEvent(e)?<b className="pz-new">NEW</b>:null}</span><span className="pz-ev-dd">{e.startDate>today?'D-'+Math.round((dateObject(e.startDate).getTime()-dateObject(today).getTime())/864e5):'오늘'}</span></div><button className="pz-ev-t classic-event-title" onClick={()=>{setSelectedTab('info');setSelected(e);}}>{e.title}</button><div className="pz-ev-m">📅 {eventRange(e)}{e.place?' · 📍 '+e.place:''}{e.hostDept?' · 🏢 '+e.hostDept:''}</div>{[['🎯 대상자',e.audience],['🛠 어떻게',e.method],['💡 목적',e.purpose]].map(([label,value])=>value?<div className="pz-ev-p" key={label}><span>{label}</span><b>{value}</b></div>:null)}<div className="pz-ev-btns"><button onClick={()=>{setSelectedTab('signup');setSelected(e);}}>스탭·기능자 신청</button><button onClick={()=>{setSelectedTab('attendees');setSelected(e);}}>참석자 신청</button></div></article>)}<ClassicInstallCard/></div>
        <div className="pz-sec-title c-cal"><span className="pz-sec-ic">📅</span><span className="pz-sec-txt">전도 일정</span><ClassicContact part="cal"/><button className="pz-sec-act" onClick={()=>setEditor({category:view&&canDept?'부서':'내일정'})}>＋ 일정 추가</button></div>
        <div className="pz-box c-cal pz-cal-box"><nav className="cal-dtabs" aria-label="일정 부서">{CAL_VIEWS.map(([value,label])=><button className={view===value?'on':''} key={value} aria-pressed={view===value} onClick={()=>setView(value)}>{value||label}{data.rows.some(e=>isNewEvent(e)&&(value?e.category==='부서'&&e.dept.trim().charAt(0)===value:e.category==='공식'))?<b className="pz-new">N</b>:null}</button>)}</nav>
          <div className="cal-dtab-note">{view?view+' 부서 전도 일정':'공식 일정과 내 일정을 함께 볼 수 있어요.'}{!view&&data.official?<button className="text-button" onClick={()=>setEditor({category:'공식'})}>공식 일정 추가</button>:null}</div>
          <div className="pz-cal-layout"><div className="pz-cal-main">
            <button className="pz-fold-h" aria-expanded={folds.cal} onClick={()=>fold('cal')}><span>🗓️ 달력</span><i>{folds.cal?'︿':'﹀'}</i></button>
            {folds.cal?<div className="pz-cal-full"><div className="cal-head"><button className="cal-nav-btn" aria-label="이전 달" onClick={()=>move(-1)}>‹</button><b>{year}년 {m+1}월</b><button className="cal-nav-btn" aria-label="다음 달" onClick={()=>move(1)}>›</button></div><div className="classic-calendar-today"><button className="cal-today-btn" onClick={()=>setMonth(dateObject(today).getFullYear()*12+dateObject(today).getMonth())}>오늘</button></div>
              <div className="calendar-grid">{CAL_DAYS.map(d=><strong className="calendar-dow" key={d}>{d}</strong>)}{monthWeeks(year,m).map(dates=><div className="calendar-week" key={dates[0]}>{dates.map(date=>{const rows=eventsOn(data.rows,date,view);return <button className={`calendar-day ${date.slice(0,7)!==`${year}-${String(m+1).padStart(2,'0')}`?'outside':''} ${date===today?'today':''}`} key={date} aria-label={`${date} 일정 ${rows.length}개`} onClick={()=>rows.length===1?setSelected(rows[0]):setDay(date)}><strong>{dateObject(date).getDate()}</strong>{rows.slice(0,4).map(e=><span key={e.eventId} className={e.category==='내일정'?'personal':e.category==='부서'?'department':'official'}>{e.highlight?'● ':''}{eventPrefix(e,view)} {e.title}{isNewEvent(e)?' N':''}</span>)}{rows.length>4?<small>+{rows.length-4}개</small>:null}</button>;})}{!view&&(data.weeks.some(w=>w.weekStart===dates[0])||access.isAdmin)?<button className="calendar-week-note" onClick={()=>setWeek(dates[0])}>주간 안내 · {data.weeks.find(w=>w.weekStart===dates[0])?.items.map(i=>`${i.cohort} ${i.theme}`).join(' / ')||'안내 보기·쓰기'}</button>:null}</div>)}</div>
              <div className="cal-legend">🔵 공식 일정 · 🟢 부서 일정 · 🟠 내 일정</div></div>:null}
            <button className="pz-fold-h sub" aria-expanded={folds.up} onClick={()=>fold('up')}><span>📋 다가오는 전도 일정</span><i>{folds.up?'︿':'﹀'}</i></button>{folds.up?<><div className="classic-calendar-upcoming">{upcomingEvents(data.rows,today,view,more?30:10).map(({event,date})=>eventButton(event,date))}</div><button className="pz-more" onClick={()=>setMore(!more)}>{more?'접기 ︿':'더보기 ›'}</button></>:null}
          </div><aside className="pz-week"><button className="pz-fold-h" aria-expanded={folds.week} onClick={()=>fold('week')}><span>⭐ 이번 주 일정</span><i>{folds.week?'︿':'﹀'}</i></button>{folds.week?Array.from({length:7},(_,i)=>shiftDate(weekStart,i)).map(date=><div className="calendar-agenda" key={date}><strong>{date.slice(5)} {CAL_DAYS[dateObject(date).getDay()]}</strong><div>{eventsOn(data.rows,date,view).map(e=>eventButton(e))}{!eventsOn(data.rows,date,view).length?<small>일정 없음</small>:null}</div></div>):null}</aside></div>
        </div>
      </>}
      <CalendarAds/><Community embeddedSection="evangelism"/>
    </>}
    </div>
    {day?<Modal title={`${day} 일정`} onClose={()=>setDay('')}><div className="activity-cards">{eventsOn(data.rows,day,view).map(e=><button className="secondary" key={e.eventId} onClick={()=>{setDay('');setSelected(e);}}>{e.title}</button>)}{!eventsOn(data.rows,day,view).length?<p>등록된 일정이 없어요.</p>:null}</div></Modal>:null}
    {selected&&!editor?<EventDetail key={selected.eventId} initialTab={selectedTab} event={selected} data={data} onClose={()=>{setSelected(null);setSelectedTab('info');}} onEdit={()=>setEditor({event:selected,category:selected.category})} onChanged={result.reload}/>:null}
    {editor?<EventEditor key={editor.event?.eventId||editor.category} event={editor.event} category={editor.category} dept={view} data={data} onClose={()=>setEditor(null)} onSaved={()=>{setEditor(null);setSelected(null);result.reload();}}/>:null}
    {week?<WeekEditor start={week} week={data.weeks.find(w=>w.weekStart===week)} onClose={()=>setWeek('')} onSaved={result.reload}/>:null}
  </section>;
}
