export type CalendarEvent={eventId:string;type:string;title:string;startDate:string;endDate:string;dept:string;place:string;desc:string;createdBy:string;createdAt:string;category:string;region:string;repeatDays:number[];repeatUntil:string;hostDept:string;contactName:string;contactPhone:string;highlight:boolean;audience:string;method:string;purpose:string;staffCount:number;attendeeCount:number;cheerCount:number};
export type WeekItem={cohort:string;theme:string;memo:string};
export type CalendarWeek={weekStart:string;items:WeekItem[];notes:string[];updatedBy:string;updatedAt:string};
export type CalendarData={rows:CalendarEvent[];weeks:CalendarWeek[];deptManager:string;official:boolean};
export type CalendarAd={adId:string;title:string;body:string;sort:number;updatedAt:string;endDate:string;endSet:boolean;expired:boolean};
export type AdQuestion={questionId:string;adId:string;authorId:string;authorName:string;text:string;createdAt:string;answer:string;answererName:string;answeredAt:string;updatedAt:string};
export type Cheer={cheerId:string;memberId:string;name:string;dept:string;body:string;photos:string[];createdAt:string;isMine:boolean};
export type Attendee={id:string;applicantDept:string;applicantRole:string;guestName:string;guestDept:string;guestAge:string;guestStage:string;applicantName?:string;eventTitle?:string};
export type Signups={staff:{dept:string;note:string}|null;attendees:Attendee[];totalAttendees:number};
export type CalendarReport={events:CalendarEvent[];staff:{id:string;name:string;dept:string;note:string;eventTitle:string}[];attendees:Attendee[];total:number;byApplicantDept:Record<string,number>;byApplicantRole:Record<string,number>;byGuestDept:Record<string,number>;byStage:Record<string,number>;staffByDept:Record<string,number>};
export const CAL_VIEWS=[['','전도부'],['교','교역자'],['자','자문회'],['장','장년회'],['부','부녀회'],['청','청년회']];
export const CAL_DEPTS=['교','자','장','부','청'],CAL_DAYS=['일','월','화','수','목','금','토'];
export const CAL_STAGES=['섭외','친분','만남1','만남2','상담1','상담2','복음방','센터소개','센터수강'];
export const CAL_REGIONS=Array.from({length:14},(_,i)=>String(i+1).padStart(2,'0')+'지역').concat('새신자');
export const calendarDate=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export const dateObject=(value:string)=>{const [y,m,d]=value.split('-').map(Number);return new Date(y,m-1,d);};
export const shiftDate=(value:string,days:number)=>{const date=dateObject(value);date.setDate(date.getDate()+days);return calendarDate(date);};
export const repeats=(e:CalendarEvent)=>Array.isArray(e.repeatDays)&&e.repeatDays.length>0&&!!e.repeatUntil;
export function eventsOn(rows:CalendarEvent[],date:string,view:string){const rank:Record<string,number>={'공식':0,'부서':1,'내일정':2};return rows.filter(e=>view?e.category==='부서'&&e.dept.trim().charAt(0)===view:e.category!=='부서').filter(e=>repeats(e)?e.startDate<=date&&date<=e.repeatUntil&&e.repeatDays.includes(dateObject(date).getDay()):e.startDate<=date&&date<=e.endDate).sort((a,b)=>(rank[a.category]??3)-(rank[b.category]??3));}
export function monthWeeks(year:number,month:number){const first=new Date(year,month,1),start=new Date(year,month,1-first.getDay()),weeks:string[][]=[];for(let row=0;row<6;row++){if(row===5&&new Date(year,month,1-first.getDay()+35).getMonth()!==month)break;weeks.push(Array.from({length:7},(_,i)=>calendarDate(new Date(start.getFullYear(),start.getMonth(),start.getDate()+row*7+i))));}return weeks;}
export function upcomingEvents(rows:CalendarEvent[],today:string,view:string,max=10){const found:{event:CalendarEvent;date:string}[]=[],seen=new Set<string>();for(let i=0;i<120&&found.length<max;i++){const date=shiftDate(today,i);for(const event of eventsOn(rows,date,view)){const key=event.eventId||event.title+'|'+event.startDate;if(seen.has(key))continue;seen.add(key);found.push({event,date});if(found.length>=max)break;}}return found;}
export const eventRange=(e:CalendarEvent)=>repeats(e)?`매주 ${e.repeatDays.map(d=>CAL_DAYS[d]).join('·')}요일 (${e.startDate} ~ ${e.repeatUntil})`:e.startDate===e.endDate?e.startDate:`${e.startDate} ~ ${e.endDate}`;
export function eventPrefix(e:CalendarEvent,view:string){if(e.category!=='부서'||!e.dept)return '';const m=e.region.match(/\d+/),no=m?String(Number(m[0])):'';return view?(no?`${no}지역)`:''):(no?`${e.dept}-${no})`:`${e.dept})`);}
export const isNewEvent=(e:CalendarEvent,now=Date.now())=>!!e.createdAt&&e.createdAt>=new Date(now+9*3600e3-3*864e5).toISOString().slice(0,19).replace('T',' ');
export const intentKey=(e:CalendarEvent)=>'calatt_'+(e.eventId||e.title||'')+'_'+(e.startDate||'');
export const canEditEvent=(e:CalendarEvent,data:CalendarData,memberId:string)=>e.category==='공식'?data.official:(e.createdBy.replace(/[\s-]/g,'')===memberId.replace(/[\s-]/g,'')||(e.category==='부서'&&(data.deptManager==='all'||data.deptManager===e.dept.trim().charAt(0))));
export function departmentCounts(events:CalendarEvent[]){const rows=events.filter(e=>e.category==='부서'&&e.dept),depts=CAL_DEPTS.filter(d=>rows.some(e=>e.dept===d)),key=(e:CalendarEvent)=>e.region||'(부서 전체)',regions=[...new Set(rows.map(key))].sort((a,b)=>a==='(부서 전체)'?-1:b==='(부서 전체)'?1:a.localeCompare(b,'ko',{numeric:true}));return {rows,depts,regions,count:(dept:string,region:string)=>rows.filter(e=>(!dept||e.dept===dept)&&(!region||key(e)===region)).length};}

// 이전 공식 일정의 주관 부서는 hostDept가 없으면 옛 dept 칸을 사용한다.
export const eventHost=(event:CalendarEvent)=>event.hostDept||(event.category==='공식'?event.dept:'');
