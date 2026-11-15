import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {calendarDate,dateObject,shiftDate,eventsOn,monthWeeks,upcomingEvents,eventRange,eventPrefix,intentKey,departmentCounts,canEditEvent,eventHost} from '../next-app/lib/calendar.ts';
import {calendarCsv} from '../shared/calendar-export.js';
const rows=Array.from({length:85},(_,i)=>({eventId:String(i),category:['공식','내일정','부서'][i%3],dept:['청','부','교','장','자','청년회'][i%6],region:i%2?'01지역':'',title:'가짜'+i,startDate:`2026-11-${String(i%28+1).padStart(2,'0')}`,endDate:'2026-12-01',repeatDays:i%4===0?[0,3]:[],repeatUntil:i%4===0?'2026-12-15':'',createdBy:'9900000000001'}));
test('반복·기간·부서 탭·같은 날짜 순서는 기존 HTML 계산과 같다',()=>{
  const html=readFileSync(new URL('../app.html',import.meta.url),'utf8'),a=html.indexOf('    const calDow ='),b=html.indexOf('    const CAL_CHIPS',a),context={calSt:{events:rows,view:''}};vm.createContext(context);vm.runInContext(html.slice(a,b)+'\nthis.on=calEventsOn;',context);
  for(const view of ['','청','부','교','자','장'])for(let day=0;day<70;day++){const date=shiftDate('2026-10-28',day);context.calSt.view=view;assert.deepEqual(eventsOn(rows,date,view),JSON.parse(JSON.stringify(context.on(date))));}
});
test('달력 35/42칸과 일요일 시작은 윤년·연말에도 날짜가 빠지지 않는다',()=>{
  for(let year=2024;year<=2030;year++)for(let month=0;month<12;month++){const weeks=monthWeeks(year,month),dates=weeks.flat();assert.ok([35,42].includes(dates.length));assert.equal(dateObject(dates[0]).getDay(),0);assert.equal(dateObject(dates.at(-1)).getDay(),6);for(let day=1;day<=new Date(year,month+1,0).getDate();day++)assert.ok(dates.includes(calendarDate(new Date(year,month,day))));for(let i=1;i<dates.length;i++)assert.equal(dates[i],shiftDate(dates[i-1],1));}
  assert.equal(monthWeeks(2026,1).length,5);
});
test('다가오는 일정은 120일 안 첫 회차만 보여 주며 반복 기간과 기기 참석 키를 보존한다',()=>{
  const first=upcomingEvents(rows,'2026-11-01','청',30);assert.equal(new Set(first.map(x=>x.event.eventId)).size,first.length);for(const {event,date}of first)assert.ok(eventsOn([event],date,'청').length);
  assert.equal(upcomingEvents([{...rows[0],startDate:'2027-11-01',endDate:'2027-11-01',repeatDays:[]}],'2026-11-01','').length,0);
  assert.equal(eventRange({...rows[0],repeatDays:[0,3],repeatUntil:'2026-12-01'}),'매주 일·수요일 (2026-11-01 ~ 2026-12-01)');assert.equal(intentKey(rows[0]),'calatt_0_2026-11-01');assert.equal(eventHost({...rows[0],hostDept:'',dept:'옛 주관부서'}),'옛 주관부서');assert.equal(eventHost({...rows[2],hostDept:'',dept:'청'}),'');assert.equal(eventPrefix({...rows[2],dept:'청',region:'01지역'},'청'),'1지역)');
});
test('부서 현황은 기존 원문 지역명을 보존하고 다른 부서의 같은 지역을 합치지 않는다',()=>{
  const events=[{...rows[2],dept:'청',region:'01지역'},{...rows[2],dept:'청',region:'1지역'},{...rows[2],dept:'부',region:'01지역'}],summary=departmentCounts(events);assert.equal(summary.count('청','01지역'),1);assert.equal(summary.count('부','01지역'),1);assert.equal(summary.count('청',''),2);assert.deepEqual(summary.depts,['부','청']);
  const data={official:false,deptManager:'청'};assert.equal(canEditEvent(events[0],data,'outsider'),true);assert.equal(canEditEvent(events[2],data,'outsider'),false);assert.equal(canEditEvent({...rows[0],category:'공식'},data,rows[0].createdBy),false);
});
test('참석자 CSV는 기존 8열/BOM과 모든 행을 보존하고 셀 수식을 문자열로 만든다',()=>{
  const result=calendarCsv([{applicantName:'이름',applicantDept:'청',applicantRole:'교',guestName:'쉼표,따옴표"',guestDept:'부',guestAge:'30',guestStage:'친분',eventTitle:'행사'},{guestName:' =HYPERLINK("bad")',guestAge:'\t=1'}]);assert.equal(result.charCodeAt(0),0xfeff);assert.equal(result.split('\n')[0].split(',').length,8);assert.ok(result.includes('"쉼표,따옴표"""'));assert.ok(result.includes('"\' =HYPERLINK'));assert.ok(result.includes('"\'\t=1"'));assert.equal(calendarCsv(Array(1005).fill({guestName:'가짜'})).split('\n').length,1006);
});
