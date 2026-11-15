import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import {seedEduReport,ER,today} from './helpers/edu-report-fixture.mjs';
import {ids,sql,jwt,PIN} from './helpers/local-db.mjs';
const next='http://127.0.0.1:58434';
async function api(action,data={},token,base=next){const r=await fetch(base+'/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...data,...(token?{_tk:token}:{})})});return{status:r.status,body:await r.json()};}
async function ok(action,data,token,base=next){const r=await api(action,data,token,base);assert.equal(r.status,200,action);assert.ok(!r.body.error,action+': '+r.body.error);return r.body;}
async function deny(action,data,token){const r=await api(action,data,token);assert.ok(r.status>=400||r.body.error,action);return r;}
let reports,attendance,member;
beforeEach(async()=>{seedEduReport();[reports,attendance,member]=await Promise.all([[ids.admin,'테스트교육','청년회'],[ids.evangel,'테스트전도','전도부'],[ids.member,'테스트교사','청년회']].map(async([memberId,name,dept])=>(await ok('verifyLogin',{memberId,name,dept,pin:PIN})).token));});
const params={meetingId:ER.meeting,phase:'최종'};
test('별도 재적·지속/임시 예외·하루 중복·재적 밖 참석과 이전 주를 기존 API와 대조한다',async()=>{
 const r=await ok('getEduAttendanceReport',params,reports);assert.deepEqual(r,await ok('getEduAttendanceReport',params,reports,'http://127.0.0.1:58433'));
 assert.equal(r.summary.total.n,7);assert.equal(r.summary.total.came,4);assert.equal(r.summary.total.rate,'57.1%');assert.equal(r.summary.total.prev,'28.6%');assert.equal(r.summary.total.late,2);assert.equal(r.summary.total.absent,3);assert.equal(r.outside,1);assert.deepEqual(r.summary.total.by,{오전:3,저녁:3});
 const am=await ok('getEduAttendanceReport',{...params,phase:'오전'},reports);assert.equal(am.summary.total.came,3);assert.equal(am.summary.total.late,1);
 assert.ok(r.summary.rows.some(x=>x.label==='협력 교회'&&x.n===1));assert.ok(!JSON.stringify(r).includes('가짜제외자'));assert.equal(sql('select count(*) from edu_delivery_log'),'0');
 // 같은 날 다른 모임의 먼저 찍힌 출석은 이 교육 참석을 지우지 않는다.
 assert.ok(r.parts.some(p=>p.text.includes('테스트교사')));
});
test('교육 방 순서·지역 범위·중복 제외와 24부서 포함 4시트 엑셀 전체 인원을 확인한다',async()=>{
 const r=await ok('getEduAttendanceReport',params,reports),parts=r.parts.filter(p=>p.room==='#교육:'+ER.series);
 assert.equal(parts.at(-1).part,'종합');assert.equal(parts.at(-2).part,'엑셀');assert.ok(parts.findIndex(p=>p.part==='청년회')<parts.findIndex(p=>p.part==='교역자'));assert.ok(!r.parts.some(p=>p.room.includes('#총합')||p.room==='부녀회/기타'));
 const region=r.parts.find(p=>p.room==='청년회/01지역');assert.ok(region.text.includes('테스트교사'));assert.ok(!region.text.includes('테스트대상'));assert.ok(!parts.some(p=>p.room.includes('/')));
 const file=await ok('getEduAttendanceAsset',{...params,revision:r.revision,partId:parts.at(-2).id},reports),book=XLSX.read(Buffer.from(file.base64,'base64'),{type:'buffer'});
 assert.deepEqual(book.SheetNames,['총합','24부서','명단','재적 밖 참석']);const rows=XLSX.utils.sheet_to_json(book.Sheets['명단'],{header:1});assert.equal(rows.length,10);assert.ok(!JSON.stringify(rows).includes('가짜제외자'));assert.ok(JSON.stringify(rows).includes('가짜인정자'));assert.ok(JSON.stringify(book.Sheets['재적 밖 참석']).includes('가짜외부참석'));
 const img=await ok('getEduAttendanceAsset',{...params,revision:r.revision,partId:parts.at(-1).id},reports);assert.equal(Buffer.from(img.base64,'base64').subarray(1,4).toString(),'PNG');
});
test('24부서 소속을 DB에서 읽고 카드·명단·엑셀과 부분 미리보기에 같은 범위로 반영한다',async()=>{
 sql(`update edu_roster set affiliation='가짜기획부',district='02' where member_id='9900000000106';
 insert into edu_roster(roster_key,member_id,name,dept,affiliation,district,position,sort_order) values
 ('${ER.key}','9900000000201','가짜행서담당','24부서','가짜행서부','01','담당',9),
 ('${ER.key}','9900000000202','가짜교육사명자','24부서','가짜기획부','02','담당',10);
 insert into attend_records(record_id,meeting_id,member_id,name,dept,position,at,late) values
 ('AT190201','${ER.meeting}','9900000000201','가짜행서담당','24부서','담당','${today()} 09:00:00','정상'),
 ('AT190202','${ER.meeting}','9900000000202','가짜교육사명자','24부서','담당','${today()} 19:33:00','3분 지각');`);
 const r=await ok('getEduAttendanceReport',params,reports),parts=r.parts.filter(p=>p.part==='24부서');
 assert.equal(parts.length,2);assert.equal(parts[0].type,'image');assert.equal(parts[1].type,'text');
 assert.ok(parts.every(p=>p.room==='#교육:'+ER.series));assert.match(parts[0].text,/전체 참석률 66.7%/);
 assert.match(parts[1].text,/가짜행서부\(1\): 가짜행서담당/);assert.match(parts[1].text,/가짜기획부\(1\): 가짜교육사명자/);assert.match(parts[1].text,/불참자 1명/);
 const p=r.parts.find(p=>p.type==='excel'),asset=await ok('getEduAttendanceAsset',{...params,revision:r.revision,partId:p.id},reports),book=XLSX.read(Buffer.from(asset.base64,'base64'),{type:'buffer'}),rows=XLSX.utils.sheet_to_json(book.Sheets['24부서'],{header:1});
 assert.equal(rows[3][0],'가짜행서부');assert.equal(rows[4][0],'가짜기획부');assert.equal(rows[5][0],'종합');assert.equal(rows[5][1],3);assert.equal(rows[5][2],2);assert.ok(JSON.stringify(rows).includes('가짜교육사명자(저녁3분)'));
 const before=await(await fetch('http://127.0.0.1:58433/__local_report_fixture/stats')).json(),key='local-only-education-webhook-key';
 const dry=await ok('tsEduAttSend',{...params,key,wholeDept:'24부서',dry:true});assert.equal(dry.sent.length,2);assert.ok(dry.sent.every(t=>!t.includes('청년회 전체')));
 const dryFile=await ok('tsEduAttSend',{meetingId:ER.meeting,key,excel:true,dry:true});const dryBook=XLSX.read(Buffer.from(dryFile.b64,'base64'),{type:'buffer'});assert.deepEqual(dryBook.SheetNames,book.SheetNames);assert.deepEqual(XLSX.utils.sheet_to_json(dryBook.Sheets['24부서'],{header:1}),rows);
 await deny('tsEduAttSend',{...params,key,wholeDept:'없는부서',dry:true});await deny('tsEduAttSend',{...params,wholeDept:'24부서',dry:true});
 const after=await(await fetch('http://127.0.0.1:58433/__local_report_fixture/stats')).json();assert.deepEqual(after,before);assert.equal(after.externalRequests,0);assert.equal(sql('select count(*) from edu_delivery_log'),'0');
 // 재적 소속 변경 뒤에는 이전 미리보기로 다운로드/발송하지 않는다.
 sql("update edu_roster set affiliation='가짜변경부' where member_id='9900000000201'");
 await deny('getEduAttendanceAsset',{...params,revision:r.revision,partId:p.id},reports);await deny('sendEduAttendanceReport',{...params,revision:r.revision,confirmed:true},reports);
});
test('자료 위임·사칭·회수와 미리보기 이후 변경·미확인 전달을 거절한다',async()=>{
 for(const tk of [undefined,member,attendance])await deny('getEduAttendanceReport',params,tk);
 await deny('getEduAttendanceReport',{...params,memberId:ids.admin},member);
 const r=await ok('getEduAttendanceReport',params,reports);await deny('sendEduAttendanceReport',{...params,revision:r.revision},reports);
 sql("update report_rooms set chat_id='-990198' where dept='청년회/01지역'");await deny('sendEduAttendanceReport',{...params,revision:r.revision,confirmed:true},reports);await deny('getEduAttendanceAsset',{...params,revision:r.revision,partId:0},reports);assert.equal(sql('select count(*) from edu_delivery_log'),'0');
 sql(`update education_delegations set revoked=true where nid='${ids.admin}'`);await deny('getEduAttendanceReport',params,reports);
});
test('연결된 빈 재적·미설정 예외·잘못된 수신 모드는 일반 교사 집계로 바뀌지 않는다',async()=>{
 sql('delete from edu_roster_policy');await deny('getEduAttendanceReport',params,reports);seedEduReport();sql('delete from edu_roster');await deny('getEduAttendanceReport',params,reports);seedEduReport();sql(`update attend_series set summary_to='잘못된값' where series_id='${ER.series}'`);await deny('getEduAttendanceReport',params,reports);
 seedEduReport();sql('delete from report_rooms');const r=await ok('getEduAttendanceReport',params,reports);assert.equal(r.parts.length,0);await deny('sendEduAttendanceReport',{...params,revision:r.revision,confirmed:true},reports);await deny('tsEduAttSend',{...params,key:'local-only-education-webhook-key',part:'없는종류'});assert.equal(sql('select count(*) from edu_delivery_log'),'0');
});
test('기존 MT QR은 당일 정기 모임을 가리키며 중지·삭제·단독 모임 경계를 유지한다',async()=>{
 const r=await ok('getAttendMeeting',{meetingId:ER.previous});assert.equal(r.meeting.meetingId,ER.meeting);assert.equal(r.meeting.date,today());
 await ok('setAttendSeriesStatus',{seriesId:ER.series,status:'멈춤'},attendance);await deny('getAttendMeeting',{meetingId:ER.previous});
 await ok('setAttendSeriesStatus',{seriesId:ER.series,status:'삭제'},attendance);await deny('getAttendMeeting',{meetingId:ER.previous});
 assert.equal((await ok('getAttendMeeting',{meetingId:ER.other})).meeting.meetingId,ER.other);
});
test('실제 격리 DB에서 동시 자동 전달은 한 번만 실행하고 불명확한 결과는 재시도하지 않는다',async()=>{
 const originalFetch=globalThis.fetch,keys=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','ATT_BOT_TOKEN','TEACHERSQUARE_BOT_TOKEN'],saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));let calls=0,fail=false;
 process.env.SUPABASE_URL='http://127.0.0.1:58433';process.env.SUPABASE_SERVICE_ROLE_KEY=jwt('service_role');process.env.ATT_BOT_TOKEN='fake-local-only';delete process.env.TEACHERSQUARE_BOT_TOKEN;
 globalThis.fetch=async(input,init)=>{const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(u.hostname==='api.telegram.org'){calls++;if(fail)throw Error('가짜 통신 중단');return Response.json({ok:true,result:{message_id:190001}});}if(u.hostname!=='127.0.0.1'||u.port!=='58433')throw Error('외부 호출 차단');return originalFetch(input,{...init,redirect:'error'});};
 try{
  const {deliverEduParts}=await import('../server/lib/edu-delivery.js'),m={meetingId:ER.meeting,date:today()},parts=[{room:{dept:'가짜 동시 전달 방',chat_id:'-990199',title:'가짜 방'},text:'가짜 보고'}];
  const outcomes=await Promise.all([deliverEduParts(m,'최종',parts),deliverEduParts(m,'최종',parts)]);assert.equal(calls,1);assert.equal(outcomes.reduce((n,r)=>n+r.sent.length,0),1);assert.equal(sql("select count(*) from edu_delivery_log where status='sent'"),'1');
  fail=true;const failed=await deliverEduParts(m,'오전',parts);assert.equal(failed.failed.length,1);assert.equal(sql("select count(*) from edu_delivery_log where status='unknown'"),'1');await deliverEduParts(m,'오전',parts);assert.equal(calls,2);
 }finally{globalThis.fetch=originalFetch;for(const k of keys)if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}
});
test('1,000명 뒤의 교육 재적도 합계·명단 엑셀에 남고 DB 직접 공개 접근은 차단한다',async()=>{
 seedEduReport(true);const r=await ok('getEduAttendanceReport',params,reports);assert.equal(r.summary.total.n,1012);assert.equal(r.summary.total.came,4);
 const p=r.parts.find(p=>p.type==='excel'),file=await ok('getEduAttendanceAsset',{...params,revision:r.revision,partId:p.id},reports),book=XLSX.read(Buffer.from(file.base64,'base64'),{type:'buffer'});assert.equal(XLSX.utils.sheet_to_json(book.Sheets['명단'],{header:1}).length,1015);assert.ok(JSON.stringify(book.Sheets['명단']).includes('가짜대량1005'));
 for(const role of ['anon','authenticated'])for(const table of ['edu_roster','edu_roster_policy','edu_delivery_log']){const res=await fetch('http://127.0.0.1:58432/'+table+'?select=*',{headers:{authorization:'Bearer '+jwt(role)}});assert.ok(res.status>=400);}
});
