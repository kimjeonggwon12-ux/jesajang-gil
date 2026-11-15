export type AttendanceQuestion={id:string;label:string;type:'choice'|'multi'|'text';required:boolean;options:string[]};
export type AttendanceMeeting={sessionLabel?:string;sessionStart?:string;meetingId:string;title:string;date:string;start:string;end:string;start2?:string;place:string;openBefore:number;slots:{start:string;end:string}[];org:string;district:string|number|null;questions:AttendanceQuestion[];open?:boolean;reason?:string;status?:string;askDistrict?:boolean;askDept?:boolean};
export type AttendanceRecord={additionalRecords?:AttendanceRecord[];tierNow?:string;tierUpdatePending?:boolean;recordId:string;meetingId:string;memberId:string;name:string;dept:string;position:string;answers:Record<string,string|string[]>;at:string;method:string;pickOrg:string;pickDistrict:string|number;dept24:string;late:string};
export type AttendanceMine=AttendanceRecord|{meetingId:string;limited:true};
export type AttendanceData={meeting:AttendanceMeeting;mine:AttendanceMine|null;me?:{guest?:boolean;name?:string;position:string;label?:string;dept?:string;region?:string;sameName?:string[];late:string}};
export type MyAttendance={meetings:AttendanceMeeting[];records:AttendanceRecord[]};
export type AttendanceIdentity={memberId:string;name:string;token:string};
export const ATTEND_ORGS=['교역자','자문','장년','부녀','청년'];
const maxima:Record<string,number>={자문:10,장년:13,부녀:12,청년:6};
const extras:Record<string,string[]>={자문:['새신자'],장년:['새신자'],부녀:['유아모','새신자'],청년:['기타']};
export const attendanceDistricts=(org:string)=>maxima[org]?Array.from({length:maxima[org]},(_,i)=>String(i+1)).concat(extras[org]):[];
export const districtLabel=(value:string|number)=>/^\d+$/.test(String(value))?value+'지역':String(value);
export function attendanceLabel({org,district}:{org?:string;district?:string|number|null}){return [org?org+(maxima[org]?'회':''):'',district!=null&&district!==''?districtLabel(district):''].filter(Boolean).join(' ');}
export const attendanceWhen=(m:AttendanceMeeting)=>String(m.date||'').slice(5).replace('-','/')+((m.slots||[]).length>1?' '+m.slots.map(t=>t.start+'~'+t.end).join(' · '):`${m.start?' '+m.start:''}${m.end?'~'+m.end:''}`);
export const attendanceAnswer=(value:string|string[]|undefined)=>Array.isArray(value)?value.join(', '):String(value==null?'':value);
export const attendancePick=(r:AttendanceRecord)=>[attendanceLabel({org:r.pickOrg,district:r.pickDistrict}),r.dept24].filter(Boolean).join(' · ');
// 저장된 지각 표시를 우선하고 옛 기록만 기존 화면과 같은 시각 계산으로 보완한다.
export function attendanceLate(m:AttendanceMeeting,r:AttendanceRecord){
 if(r.late!=null&&r.late!=='')return /지각/.test(r.late)?r.late:'';
 if(!m.start||!m.date)return '';
 const at=String(r.at||''),hm=at.slice(11,16),minutes=(t:string)=>{const [h,m]=String(t).split(':').map(Number);return h*60+m;};
 let base=m.start2&&hm>='15:00'?m.start2:m.start;
 if((m.slots||[]).length>1){base=m.slots[0].start;for(const slot of m.slots)if(minutes(slot.start)-(m.openBefore||0)<=minutes(hm))base=slot.start;}
 if(at.slice(0,10)!==m.date||at<=m.date+' '+base+':00')return '';
 const p=at.slice(11).split(':'),q=base.split(':'),sec=(Number(p[0])*3600+Number(p[1])*60+Number(p[2]||0))-(Number(q[0])*3600+Number(q[1])*60);
 return sec>0?Math.max(1,Math.floor(sec/60))+'분 지각':'';
}
export function attendanceRows(data:MyAttendance){const byMeeting=new Map(data.records.map(r=>[r.meetingId,r]));return data.meetings.flatMap(m=>{const r=byMeeting.get(m.meetingId);return r?[{meeting:m,record:r,late:attendanceLate(m,r)}]:[];});}
export function missingAttendanceAnswer(questions:AttendanceQuestion[],answers:Record<string,string|string[]>){return questions.find(q=>q.required&&(!answers[q.id]||(Array.isArray(answers[q.id])?!(answers[q.id] as string[]).length:!String(answers[q.id]).trim())));}
// QR의 외부 주소로 이동하지 않고 모임 ID만 읽어 현재 앱으로 전달한다.
export function attendanceId(text:string){const raw=String(text||'').trim();if(/^(MT|RS|CH)[A-Za-z0-9_-]{1,38}$/.test(raw))return raw;const m=raw.match(/[#&?](?:attend|meeting)=([A-Za-z0-9_-]+)(?:[&#]|$)/);return m&&/^(MT|RS|CH)[A-Za-z0-9_-]{1,38}$/.test(m[1])?m[1]:'';}
export const attendancePath=(id:string,method='qr')=>'/attend?meeting='+encodeURIComponent(id)+(method==='scan'?'&method=scan':'');
export const attendanceMemberId=(value:string)=>String(value).replace(/\D/g,'').padStart(13,'0');

// 일일 인원은 원래 records로, 시각·설문·모임 CSV만 모든 타임으로 펼친다.
export function attendanceSessions(record:AttendanceRecord){const {additionalRecords=[],...first}=record;return [first,...additionalRecords];}
