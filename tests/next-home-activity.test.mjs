import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {targetsByActivityRole,sameMember,growthConditions} from '../next-app/lib/home-activity.ts';
import {TIER_GUIDE,REST_REASONS} from '../next-app/lib/growth-guide.ts';
const html=readFileSync(new URL('../app.html',import.meta.url),'utf8'),part=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a))),plain=x=>JSON.parse(JSON.stringify(x));
test('역할별 대상자는 원본의 누적 역할·겸임·완료 제외·이름 원문 일치와 같은 결과다',()=>{
 const summary={overview:{names:[{name:'가짜가',roles:['교사','인도자']},{name:'가짜가',roles:['섬김이']},{name:'가짜나',roles:['교사']},{name:'공백',roles:['교사']}]}},targets=[{targetId:'A',targetName:'가짜가',completed:false},{targetId:'B',targetName:'가짜나',completed:true},{targetId:'C',targetName:'신규',leaderId:'0099-000',helperId:'99000'},{targetId:'D',targetName:' 공백 '},{targetId:'E',targetName:'가짜가',helperId:'99001'}];
 const ctx={home:{monthlyActRes:summary,targets},memberId:'99000',normIdClient:v=>String(v??'').replace(/\D/g,'').replace(/^0+/,'')||String(v||'').trim()};vm.createContext(ctx);vm.runInContext(part("    const MY_ACTIVITY_ROLES =",'    // 2026-10-02: 협력'),ctx);
 const actual=targetsByActivityRole(summary,targets,'99000');assert.deepEqual(actual,plain(vm.runInContext('targetsByRole()',ctx)));assert.equal(actual.교사.length,2);assert.equal(actual.인도자.length,3);assert.equal(actual.섬김이.length,3);
});
test('타인 가림 참조의 숫자를 본인 번호로 재구성하지 않는다',()=>{
 assert.equal(sameMember(' 0099-000 ','99000'),true);assert.equal(sameMember('r_x99000x','99000'),false);assert.equal(sameMember(undefined,'99000'),false);assert.equal(sameMember('r_abc','r_abc'),true);
});
test('다섯 등급과 네 가지 휴교사 상황 안내 문구를 원본에서 그대로 옮겼다',()=>{
 const ctx={};vm.createContext(ctx);vm.runInContext(part('    const TIER_GUIDE =','    function growthGuideHtml()')+';this.guide=TIER_GUIDE;this.reasons=REST_REASONS;',ctx);assert.deepEqual(TIER_GUIDE,plain(ctx.guide));assert.deepEqual(REST_REASONS,plain(ctx.reasons));
});
test('등급 조건은 서버 수치와 원본 성장 안내의 조건·달성 기준을 보존한다',()=>{
 for(const tier of ['휴교사','기타','활동교사','정교사','우수교사'])for(const nextTier of ['다음',null]){
  const ts={tier,nextTier,recentRecords:7,activeGoal:4,leadGoal:tier==='정교사'?2:tier==='활동교사'?1:null,leadCount:2},captured=[];
  const ctx={home:{tierStatus:ts},document:{getElementById:()=>({open:true})},growthGuideHtml:()=>'',wireGrowthModal:()=>{},esc:x=>x,conditionRowHtml:(label,count,goal,description)=>{captured.push({label,count,goal,description});return '';}};vm.createContext(ctx);vm.runInContext(part('    function openGrowthModal()','    function closeGrowthModal()'),ctx);vm.runInContext('openGrowthModal()',ctx);assert.deepEqual(growthConditions(ts),captured);
 }
});
