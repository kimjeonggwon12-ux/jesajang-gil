import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
import {createReportTools,ROLE_OPTIONS,activityOptionsForRoles,COOP_ACTIVITY_OPTIONS,ROLE_ACTIVITY_ALL} from '../next-app/lib/activity-report.mjs';
import {activityPeople,activityDeliveryNotice,emptyActivity,activityPayload,applyTarget,editActivity,normalizeActivity,selectActivityItem,selectActivityRole,addLesson,removeLesson,readDrafts,writeDrafts,draftForm} from '../next-app/lib/activities.ts';
import {imageSource} from '../next-app/lib/activity-photo.ts';
const html=readFileSync(new URL('../app.html',import.meta.url),'utf8'),part=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a))),clone=x=>JSON.parse(JSON.stringify(x));
const context={name:'가짜교사',memberId:'9900000000001',dept:'청년회',today:'2026-11-12',targets:[{targetId:'FAKE',targetName:'가짜대상',stage:'복음방',gender:'여',ageGroup:'30대',goalCohort:'2027-01',goalPlan:'가짜 계획',reportProfile:{center:'가짜센터',course:'초등',lessons:[{date:'2026-11-01',title:'첫 수업'},{date:'2026-11-02',title:'둘째 수업'},{date:'2026-11-03',title:'셋째 수업'}]}}],overview:{people:[{name:'가짜대상',feedbackCount:3}]}};
test('저장 성공과 보고방 전달 결과를 분리하고 일부 방 실패를 숨기지 않는다',()=>{
 for(const [success,error]of [['reported','reportError'],['reposted','repostError']]){
  const partial=activityDeliveryNotice({[success]:true,[error]:'가짜 둘째 방: 연결 거절'});
  assert.match(partial,/일부 보고방/);assert.match(partial,/가짜 둘째 방: 연결 거절/);assert.doesNotMatch(partial,/보고방에도 올렸어요/);
  assert.match(activityDeliveryNotice({[success]:false,[error]:'연결 없음'}),/전달은 완료하지 못/);
  assert.equal(activityDeliveryNotice({[success]:true}),' 보고방에도 올렸어요.');
 }
 assert.equal(activityDeliveryNotice({reported:false}),'');
});
function legacy(){const home={targets:clone(context.targets),tierStatus:{dept:context.dept},monthlyActRes:{overview:context.overview},form:{}},ctx={App:{name:context.name,memberId:context.memberId},name:context.name,memberId:context.memberId,home,todayStr:()=>context.today};vm.createContext(ctx);vm.runInContext(part("const ROLE_OPTIONS = ['인도자'",'    const HEARTS_STAGE_MAP =')+part('    const RP_TIER =','    function rpRefreshPreview()'),ctx);return ctx;}
test('활동 옵션·대표 항목·협력 단독/다중 역할 전환을 기존 규칙과 대조한다',()=>{
 const old=legacy(),tools=createReportTools(context);
 for(const roles of [[],...ROLE_OPTIONS.map(role=>[role]),['인도자','교사','섬김이']]){old.roles=roles;assert.deepEqual(activityOptionsForRoles(roles),clone(vm.runInContext('activityOptionsForRoles(roles)',old)));}
 for(const items of [ROLE_ACTIVITY_ALL,COOP_ACTIVITY_OPTIONS,['상담1','복음방','만남1'],['만남 동행','잎사귀']]){old.items=items;assert.equal(tools.rpPrimary(items),vm.runInContext('rpPrimary(items)',old));}
 const f=emptyActivity(context);selectActivityRole(f,'교사');selectActivityRole(f,'인도자');assert.deepEqual(f.roles,['교사','인도자']);selectActivityItem(f,'복음방');assert.equal(f.targetStage,'복음방');selectActivityRole(f,'협력교사');assert.deepEqual(f.roles,['협력교사']);assert.ok(!f.items.includes('복음방'));selectActivityRole(f,'교사');assert.deepEqual(f.roles,['교사']);
});
test('모든 보고 유형의 본문·전송 칸·자동 체크와 누적 교육 순서가 기존 HTML과 같다',()=>{
 const old=legacy(),tools=createReportTools(context);
 for(const item of [...new Set([...ROLE_ACTIVITY_ALL,...COOP_ACTIVITY_OPTIONS])])for(const edited of [false,true]){
  const f=emptyActivity(context);applyTarget(f,context.targets[0],context);Object.assign(f,{roles:['교사','인도자'],activityItem:item,items:[item,'동아리'],extraTitle:' 오늘 수업 ',todayWork:'첫 줄\n둘째 줄',nextWork:'다음 주제',reaction:'긍정적',reactionNote:'이해함',rpTodayAt:1,rpLessonsEdited:edited});Object.assign(f.rp,{age:'35',phone4:'1234',faith:'무교',recruitType:'지인',request:' 요청 ',time:'오후 3시',nextDate:'2026-11-13',enroll:'11',center:'가짜',cohortNo:'431기',course:'중등',plan:{interview:'2026-12-01'},checks:{affil:'O',record:'X'}});normalizeActivity(f,context);old.f=clone(f);
  assert.equal(tools.rpReportText(f),vm.runInContext('rpReportText(f)',old),item);assert.deepEqual(clone(tools.rpPayload(f)),clone(vm.runInContext('rpPayload(f)',old)),item);
  const payload=activityPayload(f,context);assert.equal(payload.reportText,tools.rpReportText(f));assert.deepEqual(payload.activities,[item,'동아리'].filter((v,i,a)=>a.indexOf(v)===i));assert.equal(payload.target.name,'가짜대상');
 }
});
test('수정 폼은 원래 교육 제목 자리·센터 칸·사진·미입력 필드를 유지한다',async()=>{
 const old=legacy(),a={id:20,submittedAt:'2026-11-02 12:00:00',roles:['교사'],activities:['복음방','만남1'],targetName:'가짜대상',targetStage:'복음방',targetGender:'여',targetAgeGroup:'30대',todayWork:'기존 내용',nextWork:'다음',note:'기존 요청',reaction:'중립',reactionNote:'기존 반응',report:{lesson:'둘째 수업',center:'새센터',eduTotal:'9',time:'오후',photos:['https://example.test/old.jpg'],team:{teacher:'다른 이름'},plan:{mapal:'2026-10-01'}}};
 old.fullActivity=async()=>clone(a);old.window={};old.renderActivityFormSheet=()=>{vm.runInContext('rpSyncSelf(home.form)',old);};
 vm.runInContext(part('    function rpResetForm(f)','    const rpRow =')+part('    window.rpOpenEdit =','    window.rpPostRow ='),old);await old.window.rpOpenEdit(a.id);
 const f=editActivity(a,context);assert.equal(f.rpTodayAt,1);assert.deepEqual(f.photos,a.report.photos);assert.deepEqual(clone(activityPayload(f,context).report),clone(vm.runInContext('rpPayload(home.form)',old)));assert.equal(activityPayload(f,context).reportText,vm.runInContext('rpReportText(home.form)',old));
});
test('누적 제목 추가·제거 후 이번 기록 위치와 전체 교체 계약을 보존한다',()=>{
 const f=emptyActivity(context);applyTarget(f,context.targets[0],context);f.extraTitle='오늘';addLesson(f);assert.equal(f.rpTodayAt,3);f.rp.lessons[3].title='추가';assert.deepEqual(createReportTools(context).rpLessons(f),['첫 수업','둘째 수업','셋째 수업','오늘','추가']);removeLesson(f,1);assert.equal(f.rpTodayAt,2);assert.deepEqual(activityPayload(f,context).report.lessons.map(x=>x.title),['첫 수업','셋째 수업','오늘','추가']);
});
test('빈 누적 제목은 객체 문자열로 보고하지 않고 옛 문자열 제목은 유지한다',()=>{
 const f=emptyActivity(context);f.rp.lessons=['옛 제목',{date:'2026-11-01',title:''},{date:'2026-11-02',title:'  '}];f.extraTitle='오늘';
 assert.deepEqual(createReportTools(context).rpLessons(f),['옛 제목','오늘']);
 addLesson(f);assert.equal(f.rp.lessons.length,2);assert.equal(f.rp.lessons[0],'옛 제목');
 const report=activityPayload(f,context).report;assert.deepEqual(report.lessons.map(x=>x.title),['옛 제목','오늘']);assert.doesNotMatch(JSON.stringify(report),/\[object Object\]/);
});
test('기존 기기 임시 저장을 계정별로 읽으며 용량 부족 때 기존 사진을 지우지 않는다',()=>{
 const previous=globalThis.localStorage,values=new Map();globalThis.localStorage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
 try{const f=emptyActivity(context),draft={id:'d123',at:'2026-11-12T01:00:00Z',name:'가짜',item:'복음방',form:{...f,photos:['data:image/jpeg;base64,AA==']}};writeDrafts(context.memberId,[draft]);assert.equal(readDrafts(context.memberId).length,1);assert.equal(readDrafts('9900000000002').length,0);assert.deepEqual(draftForm(draft,context).photos,draft.form.photos);const saved=values.get('ts_rp_drafts_'+context.memberId);globalThis.localStorage.setItem=()=>{throw Error('quota');};assert.throws(()=>writeDrafts(context.memberId,[]),/공간/);assert.equal(values.get('ts_rp_drafts_'+context.memberId),saved);}finally{globalThis.localStorage=previous;}
});
test('표시 사진은 명시된 사본만 사용하고 원본 링크·옛 주소는 바꾸지 않는다',()=>{
 const old=legacy();old.URL=URL;vm.runInContext(part('    function imageSource(','    function imageAttrs('),old);
 for(const url of ['https://example.test/original.jpg','https://example.test/00000000-0000-0000-0000-000000000001.iv1-320-960.jpg','https://example.test/00000000-0000-0000-0000-000000000001.iv1-320.jpg?token=1'])for(const side of [320,960,1600]){old.url=url;old.side=side;assert.equal(imageSource(url,side),vm.runInContext('imageSource(url,side)',old));}
});
test('대상자별 건수·최고 단계·동명 연결·순서가 기존 누적 요약 화면과 같다',()=>{
 const old=legacy(),stages=['섭외','친분','만남1','만남2','상담1','상담2','복음방','센터소개','센터수강'];old.home.stages=stages;old.stageIndex=s=>stages.indexOf(s);
 const targets=[{targetName:' 가짜대상 ',stage:'복음방',targetId:'first'},{targetName:'가짜대상',stage:'센터수강',targetId:'second'},{targetName:'다른대상',stage:'알수없음'}];
 const overview={people:[{name:'가짜대상',total:1205,edu:340,feedbackCount:99,stageCandidates:['친분','센터소개','동아리'],last:'2026-11-12'},{name:'다른대상',total:5,edu:2,stageCandidates:['알수없음','동아리']},{name:'대상없음',total:3,edu:0,stageCandidates:['만남1','센터수강']}]};
 old.home.targets=clone(targets);old.home.monthlyActRes={overview:clone(overview)};vm.runInContext(part('    const erKey =','    const erSent ='),old);
 const expected=clone(vm.runInContext('erPeople()',old)).map(({t,...person})=>({...person,target:t}));assert.deepEqual(clone(activityPeople(overview,targets)),expected);assert.deepEqual(activityPeople(undefined,targets),[]);
});
