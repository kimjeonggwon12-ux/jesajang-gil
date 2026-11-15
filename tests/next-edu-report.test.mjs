import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {statOf,cardData,eduExcel} from '../server/lib/edu-attendance.js';
import {REASONS} from '../server/lib/edu-card.js';
import {kstDateTime} from '../server/lib/util.js';
// 운영 커밋의 계산/서식 함수를 그대로 실행한다. 개인별 상수 값은 결과나 파일로 기록하지 않는다.
const original=execFileSync('git',['show','94450a6:server/lib/edu-attendance.js'],{encoding:'utf8'}).replace(/^import .*;\n/gm,'').replace(/export default \{[^}]+\};/g,'').replace(/export /g,'');
const ctx=vm.createContext({normId:s=>String(s).replace(/\D/g,''),kstDateTime,REASONS,workbookFiles:s=>{ctx.sheets=s;return{};},zip:()=>Buffer.alloc(0)});
vm.runInContext(original+';this.oracle={statOf,cardData,eduExcel};',ctx);
const json=x=>JSON.parse(JSON.stringify(x));
const m={meetingId:'MT-FAKE',date:'2026-11-12',title:'가짜 목요 교육'};
const people=[{name:'가짜교사',member_id:'9900000000001',dept:'청년회',region:'01지역',position:'교사',att:{오전:{late:'1분 지각',at:'2026-11-12 09:01:00'},저녁:{late:'정상',at:'2026-11-12 19:30:00'}}},{name:'가짜미참석',member_id:'9900000000002',dept:'부녀회',region:'02지역',position:'담당',att:{}}];
test('교육 보고의 오전·하루 합계·이전 참석률·모든 엑셀 셀은 운영 계산과 같다',()=>{
 for(const sessions of [['오전'],['오전','저녁']]){
  const P={people,outside:[{name:'가짜외부',att:{오전:{late:'정상'}}}],sessions,phase:sessions.length>1?'최종':'오전'};
  assert.deepEqual(statOf(people,sessions),json(ctx.oracle.statOf(people,sessions)));
  const C=cardData(m,P,{'청년회':50,'부녀회':0,'종합':25}),old=ctx.oracle.cardData(m,P,{'청년회':50,'부녀회':0,'종합':25});assert.deepEqual(C,json(old));
  ctx.oracle.eduExcel(m,P,old);const actual=eduExcel(m,P,C);assert.deepEqual(json(actual.sheets),json(ctx.sheets));assert.equal(actual.doc.subarray(0,2).toString(),'PK');
 }
});
